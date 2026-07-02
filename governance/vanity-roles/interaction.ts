/**
 * Vanity Roles Discord glue. Thin by design — the only decision logic is
 * resolveVanityReaction() in calculator.ts, fully unit-tested there. Not unit-tested here,
 * per this repo's convention for Discord.js-bound handlers (see CLAUDE.md).
 *
 * Grants/revokes go through governance/role-police's grantRole/revokeRole purely for
 * centralised audit logging — exclusivity for grouped roles (state/movement) is handled
 * natively by the Aometry host's own roleset feature once the role is granted, not by
 * this repo (see role-police/types.ts's module docblock).
 */

import { MessageReaction, PartialMessageReaction, User, PartialUser } from "discord.js";
import { BotClient } from "@/types/discord";
import { resolveVanityReaction } from "./calculator";
import { VANITY_ROLE_MAPPINGS } from "./config";
import { grantRole, revokeRole } from "@installed/governance/role-police/interaction";

function emojiIdentifier(reaction: MessageReaction | PartialMessageReaction): string {
  // Custom emoji have a stable `name`; unicode emoji use the character itself as `name` too.
  return reaction.emoji.name ?? "";
}

/**
 * Call from the host's messageReactionAdd/Remove listeners (only for reactions in
 * #tag-yourself — filter by channel before calling this). `added` distinguishes add vs
 * remove events.
 */
export async function handleVanityReaction(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  added: boolean,
  client: BotClient
) {
  if (user.bot) return;

  const decision = resolveVanityReaction(emojiIdentifier(reaction), added, VANITY_ROLE_MAPPINGS);
  if (decision.action === "noop") return;

  const guild = reaction.message.guild;
  if (!guild) return;
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return;

  if (decision.action === "revoke-opt-in") {
    await revokeRole(member, decision.roleName, "vanity-roles", client);
  } else {
    // grant-grouped or grant-opt-in — same call either way; the host's roleset
    // enforcement (if any applies to this role) takes over from here.
    await grantRole(member, decision.roleName, "vanity-roles", client);
  }
}
