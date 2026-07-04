# aometry-repo

Public Aometry module repository providing Fusion Party governance plugins for their Discord server. [Aometry](https://github.com/Axion-AU/Aometry) is a modular Discord bot architecture owned by Axion Ventures and not affiliated with Fusion Party. This repo extends the base Aometry bot with Fusion-specific governance workflows.

**This repo cannot run standalone — it is a content-only plugin package, not a bot.** The private Aometry host instance imports these modules at runtime; this repo exists so plugin code can be developed and typechecked independently of that host. Concretely:

- `package.json` has only `typecheck` and `test` scripts — nothing that boots a process. There's no `client.login()` anywhere in this repo.
- `tsconfig.json` sets `"noEmit": true` — TypeScript here is checked, never compiled to runnable JS.
- `host-stubs/` (see below) exists purely to give `tsc` something to resolve `@/*` imports against; those types are placeholders, not real Discord.js wiring.
- Every `interaction.ts`/`timer.ts` across every module is explicitly untested here and documented as "not yet wired to a Discord event listener" — that wiring (`client.on(...)`, command registration) can only happen in the private host, since this repo has no running process to attach a listener to.

Aometry's own docs ([`docs/SPEC_SHEET.md`](https://github.com/Axion-AU/Aometry/blob/main/docs/SPEC_SHEET.md)) describe this exact extension — titled "AOMETRY EXTENSION SPEC: FUSION GOVERNANCE MODULE" — confirming this repo is the intended "Fusion Governance Module" plugin for that host, not an unrelated or forked project.

**No Dockerfile / docker-compose here, deliberately.** A `docker-compose.yml` was removed earlier in this repo's history at a PR reviewer's request — containerization is the private host's concern (it's the thing that actually runs), not this content-only plugin package's. The same reasoning rules out a Dockerfile: there's no `npm start`, no server, no bot login to containerize — the only thing it could wrap is `npm ci && npm run typecheck && npm test`, which CI already does directly. If a reproducible-environment doc is ever wanted, prefer keeping it CI-equivalent-only and clearly labelled as verification, not "how to run the bot" — see `SETUP.md` for the actual step-by-step instead.

## Fusion Party's structure — a federated merger, not a unitary party

Fusion Party (Australia) is a **federated merger of five former microparties**: Science
Party, Pirate Party, Secular Party, Vote Planet, and Climate Change Justice Party. It
formed in 2021 after the Electoral Legislation Amendment (Party Registration Integrity)
Bill raised the non-parliamentary party membership threshold from 500 to 1,500 — merging
was a practical response to that, not an ideological unification. Per Wikipedia, the
merged parties **retain a degree of autonomy as formal branches**, not just historical
labels. This is a real structural fact worth keeping in mind for any governance-adjacent
feature, not just trivia: **this is why Fusion is a "uniparty" only nominally — its
member base is explicitly multi-affiliated by design, unlike most single-origin parties.**

This is already reflected live on the Discord server: the `/roleset list` screenshot
shared in PR #4 shows a **Movement** roleset (`@Science`, `@Pirate`, `@Secular`,
`@Vote Planet`, `@Climate Justice`, `@Progressive`) configured as `UNIQUE` — i.e.
single-choice/exclusive. A member can currently only hold one branch role at a time,
which is a *narrower* model than the party's actual federated structure technically
allows (nothing says a member can't care about both Science and Climate Justice).

**Why this matters for future feature work, and what's genuinely still open:**

- There's a standing desire (not yet a committed feature) to have the bot meaningfully
  support this multi-branch structure, rather than just modeling Fusion as a flat,
  single-identity party. Two distinct sub-questions, both currently unresolved — see
  **issue #7**:
  1. Should branch/movement role selection stop being exclusive (`UNIQUE` → multi-select),
     so members can formally affiliate with more than one microparty branch? This is a
     **host-level `/roleset` config change** — this repo's code doesn't control roleset
     exclusivity (see role-police section below), so this alone isn't something a PR here
     can implement; it needs the maintainers to reconfigure the host's roleset.
  2. *If* multi-affiliation becomes possible, should governance vote weight (`ncap` /
     `social-auth` approvals) reflect it at all? Current lean (not a decision): weighting
     by **area-of-concern** (topic-based engagement) is likely safer and less
     factionally-loaded than weighting by branch-of-origin directly, since formalizing
     microparty affiliation into vote power invites "stacking" optics in a party that
     explicitly merged to move past microparty silos — but this is the party's own
     governance-design call, not a technical one, and nothing here should be built
     against a guess.
- **Issue #8** (split off from #7, more tractable): `social-auth` already lets submitters
  tag posts with both `HASHTAGS_BRANCH` (7 microparty hashtags) and `POLICY_TAGS` (14
  topic/area-of-concern tags), persisted per submission. That data already supports a
  read-only fairness/coverage report (e.g. "which branch/topic hasn't been posted about
  recently") without touching voting logic at all — a much smaller, non-MVP-blocking win
  that doesn't depend on resolving the harder roleset/weighting questions above.

Neither of these is scoped for implementation yet. Recorded here so this context survives
between sessions/contributors rather than needing to be re-derived from PR discussion each
time it comes up.

## Repo philosophy: extensions/mods, not a fork — and not everything belongs here

Per maintainer guidance from finneh4249 (PR #4): **the right mental model for this repo is
"extensions/mods for the Aometry bot," specifically the customisations suited to Fusion
Party's own Discord.** Aometry itself is built to be guild-agnostic — any Discord server
could run it — and this repo's whole reason for existing is to hold the parts that are
*specifically* Fusion's, not general-purpose Discord functionality that happens to have
been built while working on this repo.

Concretely, this means:

- **Avoid hardcoding Fusion-specific implementation details directly in logic.** Prefer
  config (channel names, role names, emoji mappings, day-of-significance lists) over
  literals baked into control flow. `governance/ChannelUtils.ts` (pre-dating this PR, used
  by `governance/motions/` and `governance/events/`) is a known example of what *not* to
  do — Fusion's exact channel names hardcoded into a switch statement — flagged by
  finneh4249 as an "accidental violation" of Aometry's guild-agnostic design. Don't repeat
  that pattern in new modules; do fix it in old ones if you're touching that code anyway
  (but don't drive-by rewrite it as part of an unrelated PR).
- **Not every feature belongs in this repo, or under "governance."** Features that are
  genuinely reusable on any Discord server — general utility bots, not Fusion-specific
  voting/motion/authorisation workflows — should be evaluated for whether they belong in a
  *separate*, guild-agnostic repo instead of being bundled in here under the "governance"
  label just because that's where the work happened. `ncap` and `social-auth` are the clear
  "genuinely Fusion governance" cases (party-specific approval workflows, sensitivity
  tiers, supermajority rules tied to Fusion's own policy). The five bot-replacement modules
  added in PR #4 (`role-police`, `vanity-roles`, `comms-calendar`,
  `youtube-announcements`, `events-calendar`) plus `upvote-relay` are general Discord
  utilities with no inherent tie to Fusion or to governance — candidates for a split, per
  finneh4249's suggestion, though the final call on scope is the maintainer's, not
  something to unilaterally act on.
- **Keep PRs to one feature (or a closely related batch), not an ever-growing single PR.**
  PR #4 grew from a social-auth hardening pass into six additional modules built as a
  maintainability exercise — useful for that exercise, but exactly the kind of PR scope
  finneh4249 is asking future work to avoid. Default to smaller, single-purpose PRs going
  forward.

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

### Module manifest: `info.json` and `manifest.json`

Two root-level files, different purposes, not in conflict:

- **`info.json`** — module discovery: `{ name, version, modules: [{ name, path, description }] }`. **This is the one the host actually parses.** Confirmed by reading the host's real module installer: `src/modules/Core/commands/repo.ts` delegates to `src/utilities/RepositoryManager.ts`, which does `require(path.join(tempDir, 'info.json'))` on install and re-reads it on its periodic update check. That's the only file it reads from an installed module's repo.
- **`manifest.json`** — env var declaration: `{ env: [{ key, description, required }] }`. **`manifest.json` is never read or referenced anywhere in the host's code** — confirmed by tracing `RepositoryManager.ts` in full, not just skimming. It's a human-facing checklist for whoever deploys the host (added at a PR reviewer's request — "we handle env modifications like this at the repo level in the manifest.json" — meaning a person reads it when wiring up the host's `.env`, not that code parses it), not a machine-validated contract.

**Resolved, not just deferred**: because the host never parses `manifest.json`, there's no schema to get "wrong" — any reasonable `{ key, description, required }` shape is correct by construction, since nothing programmatically checks it against anything. Don't re-open this as an open question in future PR comments; if the maintainer's own module-loading code changes to read `manifest.json` at some point, that would need re-verifying, but as of this investigation it's settled.

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
**Scoped down from an original design that reimplemented Gamer bot's role-management logic.** Confirmed by reading the Aometry host's own source (`src/events/Member/guildMemberUpdate.ts` + `src/modules/Core/moderation/roleset.ts`) that exclusivity groups, placeholder-role backfill, and cross-group grant triggers are already natively enforced by the host's own `/roleset` feature (`UNIQUE` = exclusivity group, `GROUP` = paired grant-trigger) on every role change — the live server already has State/Movement/Verification role sets configured this way. Reimplementing that here would race the host's own enforcement and risk misclassifying its corrections as manual edits, so this module doesn't try.

**Current scope: a shared grant/revoke + audit-log helper only.** No exclusivity computation, no role-group config, no manual-change classification.

Key files:
- `database.ts` — `RolePoliceDatabaseManager`: `addAuditLog`/`getAuditLog` (audit trail of grants/revokes this repo's own code made), `getRecentGrants` for an ops-visibility view
- `interaction.ts` — `grantRole`/`revokeRole` (apply + log; any exclusivity/trigger cascade this causes is the host's own job), `handleGuildJoin` (join-time `@unverified` grant, per the manual's "Initial Role-Setting" — the host's own roleset GROUP trigger cascades to `@no state` automatically)
- `opt-out.ts` — `/rejectstates` replacement (`?rejectstates` in the manual): grants `@opt-out-states`, blocked in `#lobby-and-rules`. `opt-out-states` is a member of the host's own State (UNIQUE) roleset, so the host handles the exclusivity.
- `config.ts` — just `OPT_OUT_STATES_ROLE`, the one role name this repo's own code needs to reference
- `types.ts` — `RolePoliceAuditLog`

### `governance/vanity-roles/`
Replaces Fusion Brain's (YAGPDB) reaction-role granting in `#tag-yourself`: selecting an emoji grants the associated role. Decision-only module — calls `governance/role-police`'s `grantRole`/`revokeRole` purely for centralised audit logging; exclusivity for grouped roles (state/movement) is handled natively by the Aometry host once the role is granted (see role-police above), not by this repo.

Per the manual: grouped-role reactions only act on **add** (grant); unreacting does nothing ("extra selections must be manually removed"). Opt-in reactions act on both add (grant) and remove (revoke).

Key files:
- `calculator.ts` — pure function: `resolveVanityReaction(emoji, added, mappings)` → `{ action, roleName? }`
- `config.ts` — `VANITY_ROLE_MAPPINGS`: emoji → role name + `kind` (`grouped` | `opt-in`). Empty pending the real `#tag-yourself` emoji/role list.
- `interaction.ts` — thin glue: `handleVanityReaction`, called from the host's `messageReactionAdd`/`messageReactionRemove` listeners (filtered to `#tag-yourself`)
- `types.ts` — `VanityRoleMapping`, `VanityReactionAction`

### `governance/comms-calendar/`
Replaces Chronicle Bot's comms calendar function: a standing `#comms-cal` embed showing internationally recognised days of significance due in the next week.

Key files:
- `calculator.ts` — `getUpcomingSignificantDays(today, days, windowDays)`: pure date-window resolution over annually-recurring month/day entries, with year-end wraparound (a January day is found from late December).
- `embed.ts` — `buildCommsCalendarEmbed`, pure/testable.
- `config.ts` — `SIGNIFICANT_DAYS`: a starter set of real, fixed-date UN International Days, explicitly not comprehensive — add more as one-line entries. **v1 only supports fixed month/day observances**; movable dates (including the manual's own example, World Day of Remembrance for Road Traffic Victims, 3rd Sunday of November) are out of scope rather than approximated.
- `database.ts` — `CommsCalendarDatabaseManager`: config-KV store for the standing message ID, same pattern as social-auth's `bot_config`.
- `timer.ts` — thin glue, daily refresh loop.

### `governance/youtube-announcements/`
Replaces Fusion Brain's (YAGPDB) "new video → `#Announcements` post" integration. Polls the YouTube channel's public Atom feed (`youtube.com/feeds/videos.xml`) — no API key needed.

Key files:
- `calculator.ts` — `parseYoutubeFeedXml` (regex-based, not a full XML parser — the feed format is small/stable; skips malformed entries rather than throwing), `findNewVideos` (diffs against already-announced IDs, oldest-first)
- `database.ts` — `YoutubeAnnouncementsDatabaseManager`: tracks announced video IDs so a restart never re-announces
- `embed.ts` — `buildVideoAnnouncementEmbed`, pure/testable
- `timer.ts` — thin glue, 15-min poll loop. `YOUTUBE_CHANNEL_ID` + `ANNOUNCEMENTS_CHANNEL_ID` env vars.

### `governance/events-calendar/`
Replaces Chronicle Bot's Events Calendar: two-way sync between Discord scheduled events and the "Fusion Public & Member Events" Google Calendar, plus the standing "Upcoming Event Schedule" embed (Appendix A's "Detailed Event Summary Template" in the manual).

Google Calendar integration follows social-auth's Fedica pattern: stub mode (logs + synthetic success) when credentials aren't configured. **The write direction (Event Feed: Discord → Google) is a known gap** — a plain API key only grants read access; pushing events needs OAuth or a service account, not yet wired. See the TODO in `googleCalendar.ts`.

Simplification vs. the manual: refreshes every 5 minutes instead of once daily at 8:30am — cheap to rebuild, and more frequent only improves freshness.

Key files:
- `calculator.ts` — `getUpcomingEvents` (60-day window per the manual), `isEventReminderDue` (15-min-before check), `detectEventChanges` (created/changed diff by ID, drives the `@Tuned` ping)
- `embed.ts` — `formatEventEntry` (reproduces Appendix A's template structure), `buildUpcomingEventScheduleEmbed` ("Group By Day" style)
- `googleCalendar.ts` — `fetchGoogleCalendarEvents` (read, stub returns `[]`), `pushEventToGoogleCalendar` (write, **not implemented live** — see TODO)
- `database.ts` — `EventsCalendarDatabaseManager`: known-events snapshot (for change detection), reminder dedup, standing message ID
- `timer.ts` — thin glue: `startEventsCalendarService` (poll loop), `handleDiscordEventChange` (Event Feed direction, called from the host's `guildScheduledEventCreate`/`Update` listeners)

### `governance/upvote-relay/`
Replaces "Fusion News" bot's `#upvote-this` posting: relays new posts from the party's public Bluesky account into `#upvote-this` so members can boost them.

**Deliberately scoped to Bluesky only, and polls Bluesky's own public feed rather than hooking into `social-auth`'s publish event.** Reasoning: `social-auth`'s `PUBLISHED` status means "successfully scheduled with Fedica," not "currently live" — Fedica's `scheduledAt` is frequently hours or days in the future, and Fedica's own API doesn't yet expose a live post URL once it does go live (still stubbed, see `social-auth/publish.ts`). Hooking into `PUBLISHED` would relay dead or premature links. Bluesky's AT Protocol has a public, unauthenticated `getAuthorFeed` endpoint — no API key/OAuth/app review — so polling it directly after the fact sidesteps the timing and URL-availability problem entirely. Twitter/X, Facebook, and Instagram don't have an equivalent free/public read API, so they're out of scope for this module; `social-auth`'s `Destination` type is intentionally left unchanged.

Key files:
- `calculator.ts` — pure functions: `parseBlueskyFeed` (defensive Atom-style JSON parse, skips malformed entries), `findNewPosts` (diffs against already-relayed URIs, oldest-first)
- `database.ts` — `UpvoteRelayDatabaseManager`: tracks relayed post URIs so a restart never re-posts
- `bluesky.ts` — `fetchAuthorFeed`, thin wrapper around the public `getAuthorFeed` endpoint
- `timer.ts` — thin glue, 5-min poll loop; posts the raw `bsky.app` URL and lets Discord's native link unfurling render the card (no custom embed). Env vars `BLUESKY_HANDLE` + `UPVOTE_CHANNEL_ID`.

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

### Docstrings

CodeRabbit enforces a docstring-coverage pre-merge check on this repo (80% threshold). Every **exported** function, class, interface, and const config object needs a one-to-a-few-line `/** ... */` immediately above its declaration, stating what it does or the one non-obvious thing about it — not restating the signature. Internal/private helpers, `.test.ts` files, and vendored code (`vendor/`) are exempt; keep those comment-free per the usual "don't explain the obvious" rule. When adding a new exported symbol, add its docstring in the same commit — don't let coverage drift and get caught by CI later.

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

- **PR scope**: the bot-replacement modules (`role-police`, `vanity-roles`, `comms-calendar`, `youtube-announcements`, `events-calendar`) landed in the same PR as the original social-auth hardening. They're fully decoupled from social-auth's changes, so splitting them into a separate PR is straightforward if a smaller review surface is preferred — genuinely the maintainer's call, not a technical question, currently open on the PR thread with no other blockers behind it.
- **Fedica live calls**: set `FEDICA_API_KEY` (and optionally `FEDICA_API_URL`) on the host bot. Stub mode is active until then.
- **LLM risk assessment**: set `LLM_API_KEY` + `LLM_MODEL` (Anthropic Claude) on the host bot to enable `assessRisk()`. Optionally set `POLICY_INDEX_URL` for policy RAG retrieval. Stub mode returns `agree` always.
- **Host-bot wiring**: see `README.md` for the additions needed in the private Aometry host — none of `role-police`, `vanity-roles`, `comms-calendar`, `youtube-announcements`, or `events-calendar` are wired to a live Discord event yet (no `client.on(...)` registrations).
- **Vanity Roles emoji/role mappings**: `governance/vanity-roles/config.ts`'s `VANITY_ROLE_MAPPINGS` is empty pending the real emoji list from `#tag-yourself`.
- **Comms Calendar**: set `COMMS_CALENDAR_CHANNEL_ID` on the host bot. `SIGNIFICANT_DAYS` in `config.ts` is a starter set, not comprehensive.
- **YouTube Announcements**: set `YOUTUBE_CHANNEL_ID` + `ANNOUNCEMENTS_CHANNEL_ID` on the host bot.
- **Events Calendar**: set `EVENTS_CALENDAR_CHANNEL_ID`, `TUNED_ROLE_ID`, `GOOGLE_CALENDAR_ID` + `GOOGLE_CALENDAR_API_KEY` (read-only) on the host bot. The **write direction (Event Feed: Discord → Google) is not implemented** — needs OAuth or a service account, which a plain API key can't provide; see the TODO in `googleCalendar.ts`.
- **Authorisation reaction-threshold system** (manual: Fusion Brain custom command + Dyno reaction-attach, in `#authorisations-socmed`/`#authorisations-campaigns`, triggered at 3 approval reactions): **not built.** Working assumption, not a blocker: `governance/social-auth/` (slash command + button/modal workflow, `#auth-socmed`) is treated as the intended replacement for this manual-described feature, and the channel-name difference (`#auth-socmed` vs. `#authorisations-socmed`) as informal drift rather than two separate systems. `#authorisations-campaigns` isn't covered by `social-auth` — if that turns out to need its own flow, flag it and a `social-auth`-equivalent can be scoped for it specifically, rather than blocking on this now.
- **RelayBot (channel bridging)**: **not built — the manual itself says "(Details TBD)"** for this feature. Nothing to implement against yet; revisit once the actual bridging rules are documented.
