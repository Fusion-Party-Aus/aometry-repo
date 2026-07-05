# Setup

Step-by-step install and orientation for this repo — written for anyone (human or LLM
agent) stumbling on it for the first time with no prior Discord bot context.

## 0. First, understand what this repo is (and isn't)

**This repo is plugin *source code* only. It cannot run, log in to Discord, or do
anything by itself.** There is no bot process here — no `client.login()`, no `npm start`,
no Dockerfile. Running `npm install && npm start` will not produce a working bot, because
`npm start` doesn't exist.

The actual bot is the private **Aometry host** (github.com/Axion-AU/Aometry), which:
- Owns the real Discord bot token and logs in to Discord
- Registers slash commands, listens for Discord events (`interactionCreate`,
  `guildMemberAdd`, etc.)
- At runtime, imports the plugin code in this repo's `governance/` folder via the
  `@installed/governance/*` path alias and calls into it

So: **this repo = the governance logic. The Aometry host = the runtime that executes it.**
You need both to have a working bot. This repo alone gets you a typechecked, unit-tested
codebase you can develop against — nothing more, nothing less.

If your goal is "get a bot running in my Discord server," you need access to the private
Aometry host repo and its own setup docs — that's outside this repo's scope entirely.

If your goal is "develop/fix/extend the governance plugin logic" (submit workflows, vote
math, timers, embeds, etc.), this repo is all you need. Continue below.

## 1. Prerequisites

- **Node.js 18 or newer** (this repo is developed against Node 22; anything 18+ should work)
- **npm** (ships with Node)
- **[`just`](https://github.com/casey/just)** (optional but recommended — a thin wrapper
  around the npm scripts below; every `just` command has an npm/npx equivalent if you'd
  rather not install it)
- Git

No Discord bot token, no Discord server, no `.env` file is required for anything in this
section. Nothing in this repo makes network calls during development or testing — every
external integration (Fedica, Google Calendar, Bluesky, YouTube's feed, the LLM risk
assessor) either has a stub mode that's used unless real credentials are set, or (Bluesky/
YouTube feed fetches) is only ever called from `timer.ts` files, which nothing in the test
suite invokes.

## 2. Clone and install

```bash
git clone https://github.com/Fusion-Party-Aus/aometry-repo.git
cd aometry-repo
npm install
```

## 3. Verify it works

```bash
just check
# or, without just:
npm run typecheck && npm test
```

You should see `tsc --noEmit` complete with no output (no errors = success) and vitest
report all test files passing. As of writing: 21 test files, 300+ tests.

If either command fails on a fresh clone, that's a real problem worth investigating (wrong
Node version is the most common cause) — this is the exact command CI runs on every push.

## 4. Everyday commands

```bash
just check              # typecheck + full test run — same as CI
just test                # tests only
just test-watch          # vitest watch mode, reruns on file save
just test-file <path>    # run a single test file, e.g.:
                          #   just test-file governance/social-auth/calculator.test.ts
just typecheck           # tsc --noEmit only, no tests
just coverage             # test coverage summary
```

Without `just` installed, drop the `just` prefix and use the npm/npx form shown in the
[`Justfile`](Justfile) — e.g. `npm test` for `just test`, `npx vitest` for `just test-watch`.

## 5. Repo layout, at a glance

```
aometry-repo/
├── governance/          ← the actual plugin code (this is what the Aometry host imports)
│   ├── ncap/
│   ├── social-auth/
│   ├── role-police/
│   ├── vanity-roles/
│   ├── comms-calendar/
│   ├── youtube-announcements/
│   ├── events-calendar/
│   ├── upvote-relay/
│   └── ChannelUtils.ts
├── host-stubs/           ← placeholder types standing in for the private host's real
│                            types, so `tsc` can typecheck here without that repo
├── info.json              ← module discovery manifest (name/path/description per module)
├── manifest.json           ← declares every env var the modules read, for the host to wire up
├── .env.example             ← same env vars as manifest.json, in dotenv form, for local reference
├── package.json               ← only `typecheck` and `test` scripts — no start script, deliberately
├── tsconfig.json                ← `noEmit: true` — this repo is checked, never compiled/run
└── Justfile                       ← dev task shortcuts (see §4)
```

Every module under `governance/` follows the same internal shape:
- `calculator.ts` — pure functions (no Discord.js, no I/O), fully unit-tested
- `types.ts` — TypeScript types for that module
- `database.ts` — SQLite persistence (via `better-sqlite3`), usually unit-tested against
  an in-memory database
- `interaction.ts` / `timer.ts` — the Discord.js-facing glue (button handlers, background
  polling loops). **Not unit-tested** — see §7. These are what the private host registers.
- `config.ts` (where present) — committed constants (role names, channel-name mappings)
  as opposed to env vars, for values that are stable across environments

## 6. Glossary (repo-specific jargon)

If you're new to this codebase, these terms come up constantly and aren't self-explanatory:

| Term | Meaning |
|---|---|
| **NCAP** | Negative Consent Approval Protocol — the party's motion-approval workflow: submit → vote → approve/block. See `governance/ncap/`. |
| **Gantry state** | The dynamic-timer state machine used by both `ncap` and `social-auth` (`NATURAL_APPROVAL` / `VOTED_APPROVAL` / `OBJECTION`) — approve votes shrink the countdown, object votes extend it; hitting a threshold can resolve the vote instantly. |
| **Supermajority bypass** | A vote can resolve immediately, skipping the timer entirely, if enough approve/object votes are cast to make the outcome mathematically certain. |
| **Hold / manual / auto publish** | Three ways an approved `social-auth` post reaches Fedica: `auto` = immediate, `hold` = 15-min cancellable window then auto-publishes, `manual` = a human must click Publish. |
| **Stub mode** | The behaviour of an integration (Fedica, Google Calendar, LLM risk assessment) when its API key/credentials env var is unset — it logs what it *would* do and returns a synthetic success, so the rest of the pipeline still runs and is testable without real credentials. |
| **The private Aometry host** | The actual running Discord bot (separate, private repo) that imports this repo's `governance/*` code and executes it. See §0. |
| **Wired / not yet wired** | Whether a module's `interaction.ts`/`timer.ts` has actually been registered against a live Discord event (`client.on(...)`) in the private host. As of writing, only `social-auth` is wired — everything else is built and tested but inert until the host registers it. See `README.md`'s Host-bot wiring section. |

## 7. What you *can't* verify from this repo alone

Because nothing here runs as a live process, some things are structurally impossible to
test from this repo:

- **Discord interaction handlers** (`interaction.ts` files — button clicks, modal
  submissions, slash commands) require a live `discord.js` `Client` connected to a real
  guild. They're exercised by calling the pure functions they delegate to
  (`calculator.ts`), not directly.
- **Timer/polling services** (`timer.ts` files — background loops, `setInterval`) same
  story: the scheduling glue itself isn't tested, only the pure logic it calls.
- **Whether a module is actually reachable in the live Discord server** — that depends
  entirely on the private host's wiring, which lives in a different repo. `just check`
  passing tells you the *logic* is correct; it says nothing about whether Discord users
  can currently trigger it.

If you need to verify end-to-end behaviour in a real server, that requires access to the
private Aometry host and its own deployment — outside what this repo can do alone.

## 8. Where to go next

- [`README.md`](README.md) — module reference, workflow diagrams, host-wiring code samples
- [`CLAUDE.md`](CLAUDE.md) — the most detailed per-module doc (key files, TODOs, design
  rationale for every non-obvious decision)
- [Aometry's own SPEC_SHEET.md](https://github.com/Axion-AU/Aometry/blob/main/docs/SPEC_SHEET.md) —
  the host project's own description of this exact extension
