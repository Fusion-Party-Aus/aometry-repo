/**
 * Stub of the host bot's `@/utils/responses` module, for CI typechecking only.
 */
import { EmbedBuilder } from "discord.js";

export function errorEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder().setTitle(`❌ ${title}`).setDescription(description).setColor(0xff4444);
}

export function successEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder().setTitle(`✅ ${title}`).setDescription(description).setColor(0x00aa00);
}
