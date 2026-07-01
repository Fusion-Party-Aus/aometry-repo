/**
 * Stub of the host bot's `@/builders/EventBuilder` module, for CI typechecking only.
 */
import { ClientEvents, Client } from "discord.js";

export interface EventDefinition<E extends keyof ClientEvents> {
  execute: (ctx: { args: ClientEvents[E]; client: Client }) => Promise<unknown> | unknown;
}

export function createEvent<E extends keyof ClientEvents>(
  event: E,
  definition: EventDefinition<E>
): { event: E } & EventDefinition<E> {
  return { event, ...definition };
}
