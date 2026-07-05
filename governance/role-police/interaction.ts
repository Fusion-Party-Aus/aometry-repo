/**
 * Role Police Discord glue. Thin by design — see types.ts's module docblock: exclusivity,
 * placeholder backfill, and cross-group grant triggers are handled natively by the Aometry
 * host's own `/roleset` feature, so this module doesn't compute or apply any of that. It
 * only grants/revokes the single role a caller asks for and logs it for ops visibility.
 * Not unit-tested, per this repo's convention for Discord.js-bound handlers.
 */

import { GuildMember, Role } from "discord.js";
import { BotClient } from "@/types/discord";
import { RolePoliceDatabaseManager } from "./database";

function resolveRoleByName(member: GuildMember, name: string): Role | undefined {
  return member.guild.roles.cache.find((r: Role) => r.name === name);
}

/**
 * Grant a single role and log it. Any exclusivity/placeholder/grant-trigger cascade this
 * causes is applied by the Aometry host's own roleset enforcement, not by this function.
 */
export async function grantRole(member: GuildMember, roleName: string, source: string, client: BotClient) {
  const role = resolveRoleByName(member, roleName);
  if (!role) return;

  await member.roles.add(role);

  const db = new RolePoliceDatabaseManager(client.databaseManager.getSqlite());
  db.addAuditLog({
    userId: member.id,
    roleName,
    action: "grant",
    source,
    timestamp: new Date(),
  });
}

/** Revoke a single role and log it. See grantRole's docblock for scope. */
export async function revokeRole(member: GuildMember, roleName: string, source: string, client: BotClient) {
  const role = resolveRoleByName(member, roleName);
  if (!role) return;

  await member.roles.remove(role);

  const db = new RolePoliceDatabaseManager(client.databaseManager.getSqlite());
  db.addAuditLog({
    userId: member.id,
    roleName,
    action: "revoke",
    source,
    timestamp: new Date(),
  });
}

/**
 * Call from the host's guildMemberAdd listener to apply the manual's "Initial Role-Setting":
 * grants "unverified". The Aometry host's own roleset GROUP trigger handles cascading
 * "no state" automatically (confirmed live-configured — see types.ts's module docblock).
 */
export async function handleGuildJoin(member: GuildMember, client: BotClient) {
  await grantRole(member, "unverified", "role-police:join", client);
}
