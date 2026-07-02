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
Social media post authorisation workflow for `#auth-socmed`: submit → vote → approve → publish to Fedica.

Mirrors ncap's timer/gantry model but parameterised by sensitivity tier (LOW/MEDIUM/HIGH). Submitter may self-approve on LOW sensitivity (`selfApprove: true`). Publish mode (auto/hold/manual) is determined by sensitivity + objection history + supermajority.

Key files:
- `calculator.ts` — dynamic timer, gantry, supermajority, `addVote`, `resolveEffectiveSensitivity`, `resolvePublishMode`, `isHoldPublishDue`
- `publish.ts` — Fedica integration; `composePostText` + `validatePostForDestinations` (Twitter/X 280-char limit, image warning for Facebook/Instagram). `nextWeekdayAt9amAest` uses `Australia/Sydney` via `Intl` (DST-aware). Set `FEDICA_API_KEY` to enable live calls; stub mode active without it.
- `database.ts` — `atomicVoteAndUpdate`, `atomicResolve`, `getSubmissionsInState`, `getConfigValue`/`setConfigValue` (stores standing queue message ID)
- `interaction.ts` — button/modal handlers: vote, edit (direct), send-back → IN_EDIT → resubmit, manual publish, withdraw, cancel-hold, retry publish
- `timer.ts` — gantry notifications, hold auto-publish (APPROVED + elapsed `holdUntil`, distinct from the Fedica `scheduledAt`), atomically claims `PUBLISHING` before calling Fedica, calls `refreshQueueMessage` each tick
- `queue.ts` — `buildQueueEmbed`, `initQueueMessage`, `refreshQueueMessage` for the standing `#auth-queue` channel message
- `llm-pipeline.ts` — **STUB**: AI risk assessment (agree/escalate/downgrade). Wire with `LLM_API_KEY` + `LLM_MODEL` (Anthropic) once available. Escalation is binding; downgrade is advisory. Also runs `checkAiWritingStyle` (free, local, no API key needed) unconditionally and folds its result into `flags` as an advisory `info`-severity signal.
- `ai-writing-style.ts` — wraps the vendored [avoid-ai-writing](https://github.com/conorbronsdon/avoid-ai-writing) detector (`vendor/ai-writing-detector.js`, MIT) to flag AI-sounding phrasing; advisory only, never critical, never drives escalation
- `submit.ts` — `/authpost` slash command with autocomplete for destinations and policy tags
- `types.ts` — all types, `SENSITIVITY_CONFIG`, `TIMER_CONSTANTS`, `DESTINATIONS`, `POLICY_TAGS`, `HASHTAGS_CORE/BRANCH`

### `governance/role-police/`
Replaces Gamer bot's role-management functions (per the Discord Bot Operations Manual): mutual-exclusion role groups (state/movement/verification), placeholder-role backfill (`@no state`, `@no movement`), and cross-group grant triggers (`@unverified` also grants `@no state`; `@Member` also grants `@no movement`).

**v1 scope is grant-triggered enforcement only** — the engine acts when a role is granted (vanity-reaction selection, join-time `@unverified`), and never auto-corrects a manually-edited role outside that flow. Manual changes are detected and logged to the audit trail for visibility, not reverted.

Key files:
- `calculator.ts` — pure functions: `resolveGroupChange` (single-role exclusivity), `resolveFullRoleChange` (chains grant triggers through the exclusivity engine), `classifyRoleDiff` (bot-applied vs. manual vs. no-change, used for audit logging)
- `config.ts` — the maintainability lever: `ROLE_GROUPS` and `GRANT_TRIGGERS` by role **name** (not snowflake ID, same convention as `ChannelUtils.ts`). Adding/removing a state or movement role is a one-line edit here, no logic touched. `STATE_GROUP`/`MOVEMENT_GROUP` member lists are TODO — the manual documents the mechanism but not the actual role names; fill in from the live `#tag-yourself` role list before wiring to a guild.
- `database.ts` — `RolePoliceDatabaseManager`: `addAuditLog`/`getAuditLog` (audit trail only — Discord itself is the source of truth for role state), `getRecentManualChanges` for an ops-visibility view
- `interaction.ts` — thin glue: `handleRoleGrant` (apply a resolved change + log as `bot_grant`), `handleGuildMemberUpdate` (classify any observed role diff; log `manual_change` if it wasn't the bot's own recent grant)
- `types.ts` — `RoleGroup`, `OnGrantTrigger`, `RoleChangeResult`, `RolePoliceAuditLog`

### `governance/ChannelUtils.ts`
Shared utility mapping Discord channel names to `ChannelCategory` enum values.

## Development

```bash
just check          # typecheck + tests (CI equivalent)
just test           # vitest run
just test-watch     # vitest watch mode
just test-file <path>  # single test file
just typecheck      # tsc --noEmit only
```

CI runs typecheck + tests on every push and pull request (`.github/workflows/typecheck.yml`).

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
- **LLM risk assessment**: set `LLM_API_KEY` + `LLM_MODEL` (Anthropic Claude) on the host bot to enable `assessRisk()`. Optionally set `POLICY_INDEX_URL` for policy RAG retrieval. Stub mode returns `agree` always.
- **Host-bot wiring**: see `README.md` for the three additions needed in the private Aometry host.
- **Role Police state/movement role names**: `governance/role-police/config.ts`'s `STATE_GROUP`/`MOVEMENT_GROUP` are placeholders (empty `memberRoleNames`) pending the real role list from `#tag-yourself`. `interaction.ts` also isn't wired to any Discord events yet (no `guildMemberAdd`/reaction-add/`guildMemberUpdate` listeners registered) — that's host-bot wiring, not yet documented in README.md.
