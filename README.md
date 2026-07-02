# aometry-repo

Fusion Party governance plugins for the [Aometry](https://github.com/Axion-AU/Aometry) Discord bot (owned by Axion Ventures, not affiliated with Fusion Party). This repo is public so plugins can be developed and typechecked independently; the private Aometry host imports them at runtime.

**This is not a runnable bot on its own.** There's no `client.login()`, no start script — just plugin source, typechecked against stub types, that a separate private Aometry host loads and actually executes. See [Architecture](#architecture) below for how the two connect. Aometry's own docs (`docs/SPEC_SHEET.md`) describe this exact extension, confirming it's the intended "Fusion Governance Module" for that host.

## Plugins

| Plugin | Channel | Purpose |
|--------|---------|---------|
| `governance/ncap/` | `#ncap` | Negative Consent Approval Protocol — submit motions, vote, expire |
| `governance/social-auth/` | `#auth-socmed` | Social media post authorisation — submit, approve, publish to Fedica |
| `governance/role-police/` | — | Shared grant/revoke + audit-log helper; join-time grant, `/rejectstates` opt-out |
| `governance/vanity-roles/` | `#tag-yourself` | Reaction → role granting; exclusivity handled by the Aometry host itself |
| `governance/comms-calendar/` | `#comms-cal` | Standing embed of upcoming days of significance |
| `governance/youtube-announcements/` | `#Announcements` | Posts when the party's YouTube channel uploads |
| `governance/events-calendar/` | configurable | Two-way Discord ↔ Google Calendar sync + upcoming-events embed |

---

## Coverage vs. the Discord Bot Operations Manual

This repo is being built out to replace every bot on the Fusion Discord server, tracked against the internal Operations Manual. Status as of the modules above:

| Manual feature | Current bot | Repo module | Status |
|---|---|---|---|
| Initial `@unverified` grant on join | Fusion Brain (YAGPDB) | `role-police` (`handleGuildJoin`) | ✅ Built, not yet wired to `guildMemberAdd` |
| State/Movement/Verification exclusivity + placeholders | Gamer (Role Police) | *(none — handled by the Aometry host itself)* | ✅ **Already covered natively.** Confirmed via the host's `guildMemberUpdate.ts` + `/roleset` command — `role-police` no longer reimplements this, see `CLAUDE.md` |
| `#tag-yourself` reaction → role grant | Fusion Brain (YAGPDB) | `vanity-roles` | ✅ Built, not yet wired; real emoji/role mappings still TODO |
| `?rejectstates` opt-out | Dyno (Fusion Pinky) | `role-police/opt-out.ts` | ✅ Built |
| New YouTube video → `#Announcements` | Fusion Brain (YAGPDB) | `youtube-announcements` | ✅ Built, not yet wired to a startup call |
| `#comms-cal` days-of-significance embed | Chronicle Bot (A Big Cal) | `comms-calendar` | ✅ Built; day list is a starter set, not comprehensive |
| Events Calendar (Google ↔ Discord sync, Upcoming Event Schedule) | Chronicle Bot (A Big Cal) | `events-calendar` | ⚠️ Built, but the Discord → Google *write* direction is stubbed only — needs OAuth/service-account credentials a plain API key can't provide |
| Social media post authorisation (`#auth-socmed`) | — | `social-auth` | ✅ Built (predates this pass) |
| Reaction-threshold authorisation (3 approval reactions in `#authorisations-socmed`/`#authorisations-campaigns`) | Fusion Brain custom command + Dyno reaction-attach | — | 🟡 **Not built — working assumption in place, not blocking.** Treating `social-auth` as the intended replacement (channel-name difference assumed to be informal drift). `#authorisations-campaigns` isn't covered; flag if it needs its own flow. |
| Channel bridging | RelayBot | — | ❌ **Not built.** The manual itself says "(Details TBD)" — nothing to implement against. |

`CLAUDE.md` has the file-level detail (key functions, config shape, TODOs) for each module; this table is the "what's left" view.

---

## Quick start

```bash
npm install
just check        # typecheck + tests
just test-watch   # tests in watch mode during development
```

Requires Node 18+. No `.env` needed for local development — all integrations have stubs that activate automatically when API keys are absent.

---

## Social Auth pipeline (`governance/social-auth/`)

### Workflow

```
/authpost  →  #auth-socmed embed  →  votes  →  approved  →  Fedica
               ↑ standing queue in #auth-queue (auto-updated)
```

1. Member runs `/authpost` — picks sensitivity, destinations, fills modal
2. Bot posts an embed to `#auth-socmed` with Approve / Object / Edit / Send Back buttons
3. `@authnational` members vote; dynamic timer adjusts based on vote rates
4. Once required approvals are met, post is queued on Fedica (auto / hold / manual depending on risk)
5. `#auth-queue` embed is updated after every state change so the team always has a live view

### Sensitivity tiers

| Tier | Required approvals | Self-approve | Publish mode |
|------|--------------------|--------------|--------------|
| Low | 1 | ✅ allowed | auto (no objections) / hold (objections) |
| Medium | 2 | ❌ | hold (supermajority) / manual |
| High | 2 | ❌ | manual always |

### Publish modes

| Mode | Behaviour |
|------|-----------|
| `auto` | Publishes to Fedica immediately on approval |
| `hold` | 15-minute window shown in channel — cancel button available, auto-publishes when window elapses |
| `manual` | Publish button must be clicked explicitly |

### Gantry states

The timer is dynamic — approval votes shrink it, objection votes extend it.

| State | Trigger | Behaviour |
|-------|---------|-----------|
| `NATURAL_APPROVAL` | ≤25% time remaining (wall-clock) | Any further approve vote instantly resolves |
| `VOTED_APPROVAL` | Timer reaches floor (50% of initial) | Any further approve vote instantly resolves |
| `OBJECTION` | Timer reaches ceiling (200% of initial) | Any further object vote instantly blocks |

### Scheduling

Posts default to **next weekday 09:00 Sydney time** (AEST/AEDT, DST-aware). Override by including `schedule: YYYY-MM-DDTHH:MM` anywhere in the submission notes — parsed as Sydney local time.

### AI risk assessment (optional)

Set `LLM_API_KEY` and `LLM_MODEL` on the host bot to enable. The pipeline runs before the embed is posted and may:
- `agree` — no change
- `escalate` — bumps sensitivity tier (binding: increases required approvals)
- `downgrade` — advisory only, submitter's tier is kept

Without `LLM_API_KEY` the stub always returns `agree` and the pipeline proceeds normally.

---

## Host-bot wiring

> **Only `social-auth` is wired up below.** `role-police`, `vanity-roles`, `comms-calendar`,
> `youtube-announcements`, and `events-calendar` are built and tested but not yet connected
> to any Discord event listener in the host — see each module's entry in `CLAUDE.md`'s
> Pending section for what's outstanding (mostly: real role/emoji/channel config, plus the
> actual `client.on(...)` registration). Their wiring will look the same shape as below —
> import a handler, register it against an event or command — once that config is filled in.

Three additions needed in the private Aometry host for `social-auth`:

```ts
// 1. Register the slash command
import authpostCommand from '@installed/governance/social-auth/submit';
client.commands.set('authpost', authpostCommand);

// 2. Route interactions
import handleSocialAuthInteraction from '@installed/governance/social-auth/interaction';
import { handleAuthPostAutocomplete } from '@installed/governance/social-auth/submit';

// In your interactionCreate handler:
if (interaction.isAutocomplete() && interaction.commandName === 'authpost') {
  return handleAuthPostAutocomplete(interaction);
}
if (interaction.customId?.startsWith('authpost_')) {
  return handleSocialAuthInteraction(interaction, client);
}
if (interaction.isModalSubmit() && interaction.customId?.startsWith('authpost_submit_')) {
  return handleSocialAuthInteraction(interaction, client);
}

// 3. Start timer service on ready
import { startSocialAuthTimerService } from '@installed/governance/social-auth/timer';
client.once('ready', () => startSocialAuthTimerService(client));
```

### Environment variables

`social-auth`'s env vars only — see `manifest.json` or `.env.example` for the complete list across every module (including the not-yet-wired ones).

| Variable | Required | Purpose |
|----------|----------|---------|
| `QUEUE_CHANNEL_ID` | ✅ | Discord channel snowflake for the standing queue message |
| `FEDICA_API_KEY` | optional | Enables live Fedica publish (stub mode active without it) |
| `FEDICA_API_URL` | optional | Override Fedica base URL (default: `https://api.fedica.com/api`) |
| `LLM_API_KEY` | optional | Enables AI risk assessment (stub mode active without it) |
| `LLM_MODEL` | optional | Claude model ID for risk assessment |
| `POLICY_INDEX_URL` | optional | Vector store URL for policy RAG retrieval |

---

## Architecture

```
Aometry host (private)        aometry-repo (this repo, public)
├── @/ (host types)      ←──  host-stubs/   (stand-in types for tsc)
└── imports at runtime   ←──  governance/   (Fusion governance plugins)
```

`host-stubs/` provides stub types for `@/types/discord`, `@/utils/responses`, etc. so `tsc --noEmit` works without the private host. The real types live in the host; stubs only need to match the shape.

Path aliases in `tsconfig.json`:
- `@/*` → `host-stubs/*`
- `@installed/governance/*` → `governance/*`

Nothing in `governance/` is wired to a live Discord event from this repo — every `interaction.ts`/`timer.ts` has to be registered (`client.on(...)`, command registration) by the private host, since this repo has no running process of its own. That's why each module's docs note what's "not yet wired."

### Module manifest: `info.json` and `manifest.json`

Two root-level files, different purposes:
- **`info.json`** — module discovery: `{ name, version, modules: [...] }`, matching Aometry's documented third-party module contract.
- **`manifest.json`** — env var declaration: `{ env: [...] }`, added at a PR reviewer's request, kept current with every module's env vars.

---

## Development

```bash
just check          # typecheck + full test run (CI equivalent)
just test           # tests only
just typecheck      # tsc --noEmit only
just test-watch     # vitest watch mode
just test-file governance/social-auth/calculator.test.ts   # single file
```

Tests live alongside source as `*.test.ts`. Discord interaction handlers and the timer service are not unit-tested (depend on Discord.js); all logic they delegate to is covered instead.

### Adding a feature

Follow red-green TDD (required):

1. Write a failing test that specifies the behaviour
2. Run `just test` — confirm it fails
3. Write the minimum code to make it pass
4. Run `just test` — confirm it passes
5. Refactor if needed

Test the sad path too: invalid inputs, boundary conditions, failure modes, rejection cases.
