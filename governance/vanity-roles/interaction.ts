/**
 * Vanity Roles Discord glue. Thin by design — the only decision logic is
 * resolveVanityReaction() in calculator.ts, fully unit-tested there. Not unit-tested here,
 * per this repo's convention for Discord.js-bound handlers (see CLAUDE.md).
 *
 * Delegates grouped-role grants to governance/role-police's handleRoleGrant (which applies
 * exclusivity + placeholder backfill + audit log) rather than duplicating that logic — the
 * whole point of role-police's config-driven design is that other modules can reuse it.
 */

import { MessageReaction, PartialMessageReaction, User, PartialUser, GuildMember, Role } from "discord.js";
import { BotClient } from "@/types/discord";
import { resolveVanityReaction } from "./calculator";
import { VANITY_ROLE_MAPPINGS } from "./config";
import { handleRoleGrant } from "@installed/governance/role-police/interaction";
import { RolePoliceDatabaseManager } from "@installed/governance/role-police/database";

function emojiIdentifier(reaction: MessageReaction | PartialMessageReaction): string {
  // Custom emoji have a stable `name`; unicode emoji use the character itself as `name` too.
  return reaction.emoji.name ?? "";
}

function resolveRoleByName(member: GuildMember, name: string): Role | undefined {
  return member.guild.roles.cache.find((r: Role) => r.name === name);
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

  if (decision.action === "grant-grouped") {
    // role-police resolves exclusivity/backfill and logs the audit entry itself.
    await handleRoleGrant(member, decision.roleName, client);
    return;
  }

  const role = resolveRoleByName(member, decision.roleName);
  if (!role) return;

  const db = new RolePoliceDatabaseManager(client.databaseManager.getSqlite());
  if (decision.action === "grant-opt-in") {
    await member.roles.add(role);
    db.addAuditLog({
      userId: member.id,
      eventType: "bot_grant",
      rolesAdded: [decision.roleName],
      rolesRemoved: [],
      timestamp: new Date(),
      details: { source: "vanity-roles", kind: "opt-in" },
    });
  } else {
    await member.roles.remove(role);
    db.addAuditLog({
      userId: member.id,
      eventType: "bot_grant",
      rolesAdded: [],
      rolesRemoved: [decision.roleName],
      timestamp: new Date(),
      details: { source: "vanity-roles", kind: "opt-in" },
    });
  }
}
