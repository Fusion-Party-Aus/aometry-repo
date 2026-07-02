/**
 * Role Police Discord glue. Thin by design — all rule logic lives in calculator.ts and is
 * fully unit-tested there; this file only translates Discord events into calls against it
 * and applies the result. Not unit-tested, per this repo's convention for Discord.js-bound
 * handlers (see CLAUDE.md).
 */

import { GuildMember, Role } from "discord.js";
import { BotClient } from "@/types/discord";
import { RolePoliceDatabaseManager } from "./database";
import { resolveFullRoleChange, classifyRoleDiff } from "./calculator";
import { ROLE_GROUPS, GRANT_TRIGGERS } from "./config";
import { RoleChangeResult } from "./types";

// Recently-applied bot changes, keyed by user ID, so the guildMemberUpdate handler that
// fires as a *result* of our own member.roles.set() call can recognise it as bot-applied
// rather than logging it a second time as a manual change. Short TTL — only needs to
// survive the round-trip to Discord's gateway echoing the update back to us.
const PENDING_BOT_CHANGES = new Map<string, { expected: RoleChangeResult; appliedAt: number }>();
const PENDING_TTL_MS = 10_000;

function roleNamesOf(member: GuildMember): Set<string> {
  return new Set(member.roles.cache.map((r: Role) => r.name));
}

function resolveRoleByName(member: GuildMember, name: string): Role | undefined {
  return member.guild.roles.cache.find((r: Role) => r.name === name);
}

/**
 * Call when a role is granted to a member (vanity-reaction selection, or the initial
 * "unverified" grant on join). Computes the full resolved change (including any chained
 * grant triggers), applies it, and logs it as a bot_grant audit entry.
 */
export async function handleRoleGrant(member: GuildMember, grantedRoleName: string, client: BotClient) {
  const db = new RolePoliceDatabaseManager(client.databaseManager.getSqlite());
  const currentRoleNames = roleNamesOf(member);
  const change = resolveFullRoleChange(currentRoleNames, grantedRoleName, ROLE_GROUPS, GRANT_TRIGGERS);

  const rolesToAdd = change.toAdd.map(name => resolveRoleByName(member, name)).filter((r): r is Role => !!r);
  const rolesToRemove = change.toRemove.map(name => resolveRoleByName(member, name)).filter((r): r is Role => !!r);

  if (rolesToAdd.length) await member.roles.add(rolesToAdd);
  if (rolesToRemove.length) await member.roles.remove(rolesToRemove);

  PENDING_BOT_CHANGES.set(member.id, { expected: change, appliedAt: Date.now() });

  db.addAuditLog({
    userId: member.id,
    eventType: "bot_grant",
    rolesAdded: change.toAdd,
    rolesRemoved: change.toRemove,
    timestamp: new Date(),
    details: { trigger: grantedRoleName },
  });
}

/**
 * Call from the host's guildMemberUpdate listener. Detects any role diff and classifies
 * it against the most recent bot-applied change for that user (if any, within TTL) —
 * bot-applied diffs are already logged by handleRoleGrant and skipped here; anything else
 * is logged as a manual change for audit visibility. v1 scope: log only, never correct.
 */
export async function handleGuildMemberUpdate(oldMember: GuildMember, newMember: GuildMember, client: BotClient) {
  const db = new RolePoliceDatabaseManager(client.databaseManager.getSqlite());
  const before = roleNamesOf(oldMember);
  const after = roleNamesOf(newMember);

  const pending = PENDING_BOT_CHANGES.get(newMember.id);
  const isPendingFresh = !!pending && Date.now() - pending.appliedAt <= PENDING_TTL_MS;
  const expected = isPendingFresh ? pending!.expected : { toAdd: [], toRemove: [] };

  const classification = classifyRoleDiff(before, after, expected);
  if (classification === "no-change") return;

  if (classification === "bot-applied") {
    PENDING_BOT_CHANGES.delete(newMember.id);
    return; // Already logged by handleRoleGrant.
  }

  const rolesAdded = [...after].filter(r => !before.has(r));
  const rolesRemoved = [...before].filter(r => !after.has(r));
  db.addAuditLog({
    userId: newMember.id,
    eventType: "manual_change",
    rolesAdded,
    rolesRemoved,
    timestamp: new Date(),
  });
}
