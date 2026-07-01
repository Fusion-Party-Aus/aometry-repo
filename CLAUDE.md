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
Social media post authorisation workflow for `#auth-socmed`: submit → approve → schedule on Fedica.

Mirrors ncap's timer/gantry model but parameterised by sensitivity tier (LOW/MEDIUM/HIGH). Key difference from ncap: submitter may self-approve on LOW sensitivity (`selfApprove: true`).

Key files:
- `calculator.ts` — same dynamic timer model as ncap; adds `checkApprovalThresholdMet`; `updateSubmissionTimer` detects wall-clock-based NATURAL_APPROVAL gantry (≤25% remaining)
- `publish.ts` — Fedica draft-to-schedule integration. Set `FEDICA_API_KEY` env var to enable live calls; without it, stub mode logs the payload. Supports `scheduledAt` (defaults to next weekday 09:00 AEST). Includes `parseScheduleFromText` to parse `schedule: YYYY-MM-DDTHH:MM` from submission notes.
- `database.ts` — `atomicVoteAndUpdate` and `atomicResolve` prevent race conditions from concurrent vote interactions; `hasNotifiedThreshold`/`setNotifiedThreshold` persist reminder state across restarts
- `timer.ts` — gantry-transition notifications (NATURAL_APPROVAL, VOTED_APPROVAL, OBJECTION); reminders deduped via DB
- `llm-pipeline.ts` — **STUB**: three-stage AI content pipeline (topic research → policy RAG retrieval → commentary generation). Wire up with `LLM_API_KEY`, `LLM_MODEL`, and `POLICY_INDEX_URL` once available.
- `types.ts` — includes `SENSITIVITY_CONFIG`, `FedicaPublishPayload.scheduledAt`, `SocialAuthSubmission.scheduledAt/fedicaScheduledAt`

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

- **Fedica live calls**: set `FEDICA_API_KEY` (and optionally `FEDICA_API_URL`) on the host bot. Stub mode is active until then.
- **LLM content pipeline**: wire up `governance/social-auth/llm-pipeline.ts` with `LLM_API_KEY`, `LLM_MODEL` (Anthropic), and `POLICY_INDEX_URL` (vector store for policy RAG). Currently all three stages are stubs.
- **AEDT support**: `nextWeekdayAt9amAest()` uses a fixed UTC+10 offset; it will be 1 hour off during Australian summer (AEDT = UTC+11). Use a timezone library or the `Australia/Sydney` locale once available.
