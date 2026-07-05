/**
 * Role Police config. Exclusivity groups (state/movement/verification) and grant triggers
 * are configured directly in the Aometry host via `/roleset` — see types.ts's module
 * docblock. Nothing to duplicate here; this file only holds the one role name this repo's
 * own code needs to reference directly.
 */

/** Opt-out role: applied by the "?rejectstates" custom command (currently on Dyno). */
export const OPT_OUT_STATES_ROLE = 'opt-out-states';

/** Channel where "/rejectstates" is disallowed. Manual: "may be used anywhere in the server (other than #lobby-and-rules)." */
export const OPT_OUT_DISALLOWED_CHANNEL_NAME = 'lobby-and-rules';
