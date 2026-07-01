# aometry-repo

Public Aometry module repository providing Fusion Party governance plugins for their Discord server. [Aometry](https://github.com/Axion-Au/Aometry) is a modular Discord bot architecture owned by Axion Ventures and not affiliated with Fusion Party. This repo extends the base Aometry bot with Fusion-specific governance workflows.

The private Aometry host instance imports these modules at runtime; this repo exists so they can be developed and typechecked independently.

## Architecture

```
Aometry host (private)      aometry-repo (this repo, public)
├── @/ (host types)    ←──  host-stubs/  (stand-in types for tsc)
└── imports at runtime ←──  governance/  (Fusion governance plugins)
```

`host-stubs/` provides stub types for `@/types/discord`, `@/utils/responses`, etc. so `tsc --noEmit` works here without the private Aometry host. The real types live in the host; stubs only need to match the shape, not the implementation.

Path aliases in `tsconfig.json`:
- `@/*` → `host-stubs/*`
- `@installed/governance/*` → `governance/*`

## Modules

### `governance/ncap/`
Negative Consent Approval Protocol (NCAP). Implements the full NCAP submission lifecycle: submit → vote → timer expiry / instant resolution → approve/block.

Key files:
- `calculator.ts` — pure functions: dynamic timer math, gantry state, supermajority bypass, `addVote`
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

### Test-Driven Development

**All new features must follow red-green TDD:**

1. **Red** — write a failing test that specifies the desired behaviour before writing any implementation code. Run `npm test` and confirm the new test fails.
2. **Green** — write the minimum implementation needed to make the test pass. Run `npm test` and confirm it passes.
3. **Refactor** — clean up the implementation without breaking the tests.

Do not write implementation code first and tests after. If a piece of behaviour cannot be unit-tested (e.g. a Discord interaction handler), note that explicitly and cover the testable logic it delegates to instead.

**Test the sad path, not just the happy path.** Assume the software will fail and write tests that force it to. For every feature, explicitly cover:
- **Invalid inputs** — malformed data, wrong types, empty/null/zero values
- **Boundary conditions** — off-by-one, exactly at a threshold vs. one below/above
- **Failure modes** — API errors, DB constraint violations, concurrent access, expired state
- **Rejection cases** — unauthorised users, duplicate votes, self-approve when disabled, past dates

A test suite that only passes sunny-day scenarios gives false confidence. If a test cannot be made to fail by breaking the thing it tests, it is not a useful test.

## Pending

- **Fedica live calls**: set `FEDICA_API_KEY` (and optionally `FEDICA_API_URL`) on the host bot. Stub mode is active until then.
- **LLM content pipeline**: wire up `governance/social-auth/llm-pipeline.ts` with `LLM_API_KEY`, `LLM_MODEL` (Anthropic), and `POLICY_INDEX_URL` (vector store for policy RAG). Currently all three stages are stubs.
- **AEDT support**: `nextWeekdayAt9amAest()` uses a fixed UTC+10 offset; it will be 1 hour off during Australian summer (AEDT = UTC+11). Use a timezone library or the `Australia/Sydney` locale once available.
