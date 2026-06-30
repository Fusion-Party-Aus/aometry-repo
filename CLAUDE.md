# aometry-repo

Public plugin module repository for the Fusion Party Discord bot. The private host-bot project imports these modules at runtime; this repo exists so they can be developed and typechecked independently.

## Architecture

```
host-bot (private)          aometry-repo (this repo, public)
├── @/ (host types)    ←──  host-stubs/  (stand-in types for tsc)
└── imports at runtime ←──  governance/  (plugin modules)
```

`host-stubs/` provides stub types for `@/types/discord`, `@/utils/responses`, etc. so `tsc --noEmit` works here without the private host-bot. The real types live in the host-bot; stubs only need to match the shape, not the implementation.

Path aliases in `tsconfig.json`:
- `@/*` → `host-stubs/*`
- `@installed/governance/*` → `governance/*`

## Modules

### `governance/ncap/`
Negative Consent Approval Protocol per Constitution Rule 49. Implements the full NCAP submission lifecycle: submit → vote → timer expiry / instant resolution → approve/block.

Key files:
- `calculator.ts` — pure functions: dynamic timer math (Rule 49(3)), gantry state, supermajority bypass, `addVote`
- `database.ts` — `NcapDatabaseManager` wrapping better-sqlite3
- `interaction.ts` — Discord button/modal handlers (approve, object, info)
- `timer.ts` — background service: polls every 60s, checks business hours (AEST), handles gantry transitions and expiration
- `submit.ts` — slash command / context menu to open the submit modal
- `types.ts` — all types + `TIMER_CONSTANTS`

### `governance/social-auth/`
Social media post authorisation workflow for `#auth-socmed`: submit → comment → approve → edit → publish (Fedica).

Mirrors ncap's timer/gantry model but parameterised by sensitivity tier (LOW/MEDIUM/HIGH) rather than NCAP category. Key difference from ncap: submitter may self-approve on LOW sensitivity (`selfApprove: true`).

Key files:
- `calculator.ts` — same dynamic timer model as ncap; adds `checkApprovalThresholdMet` (sensitivity tier gates publish, not just gantry)
- `publish.ts` — **STUB**: `publishToFedica` logs payload instead of calling Fedica API. Wire it up once credentials and API shape are confirmed; the call site (`interaction.ts`) and `FedicaPublishResult` contract are already in place.
- `types.ts` — includes `SENSITIVITY_CONFIG` mapping tier → `requiredApprovals`, `allowSelfApprove`, `initialTimerMinutes`

### `governance/ChannelUtils.ts`
Shared utility mapping Discord channel names to `ChannelCategory` enum values.

## Development

```bash
npm run typecheck   # tsc --noEmit across governance/ + host-stubs/
npm test            # vitest run (governance/**/*.test.ts)
```

CI runs both on every push and pull request (`.github/workflows/typecheck.yml`).

Tests live alongside source as `*.test.ts`. Currently cover both calculator modules (timer math, gantry logic, vote rules). Discord interaction handlers and the timer service are not unit-tested — they depend on Discord.js and the background scheduler.

## Pending

- **Fedica integration**: swap `publishToFedica` stub in `governance/social-auth/publish.ts` once API credentials are available.
