/**
 * Stub of the host bot's `@/types/discord` module, for typechecking governance/
 * plugin files in this repo's CI. The real implementation lives in the private
 * host bot project - keep this in sync with its shape, not the other way round.
 */
import {
  Client,
  ChatInputCommandInteraction,
  MessageContextMenuCommandInteraction,
  Interaction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
  ContextMenuCommandBuilder,
} from "discord.js";
import type Database from "better-sqlite3";

export interface BotClient extends Client {
  databaseManager: {
    getSqlite: () => Database.Database;
  };
}

export interface Command {
  data:
    | SlashCommandBuilder
    | SlashCommandOptionsOnlyBuilder
    | SlashCommandSubcommandsOnlyBuilder
    | ContextMenuCommandBuilder;
  execute: (ctx: {
    interaction: ChatInputCommandInteraction | MessageContextMenuCommandInteraction | Interaction;
    client: BotClient;
  }) => Promise<unknown>;
}
