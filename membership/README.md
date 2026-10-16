# Fusion membership verification

This optional Fusion plugin connects Discord identities already linked through
Underground CRM's normal Discord login/account connection flow to a dedicated
membership role. Fusion-specific role policy lives here, not in the Aometry host.
The CRM remains the source of truth.

## Behaviour

- On bot startup, scan the configured guild's human members. Repeat five minutes
  **after each completed scan** by default. New guild members are checked on join.
- `/verify-membership` immediately checks only the person running the command and
  replies privately. It accepts no target account, guild or role arguments.
- Grant the dedicated role for `eligible: true`, remove it for `eligible: false`,
  and preserve all other roles. The role must be exclusively managed by this plugin;
  use a separate role for manual exceptions. A negative answer includes an account
  that is not linked to a CRM person, preventing stale access after unlinking.
- Authentication errors, timeouts, malformed responses and CRM outages preserve
  existing roles and are retried on a later scan. No eligibility data is persisted.

Polling deliberately avoids a public bot webhook, sharing Aometry's powerful
management API key, or changes to the host platform. There is no login-triggered
CRM worker: after connecting Discord or changing membership, the next successful
scan applies the change, or the person can run `/verify-membership` immediately.
The interval is not a strict maximum delay: scan duration, failed requests and
outages add latency. Each scan makes one sequential CRM request per human guild
member (five-second timeout per request); assess this cost for large servers.

## Enablement (operator approval required for deployment)

1. Deploy the companion CRM eligibility endpoint and configure its token and
   qualifying membership type UUID. The endpoint must be served over HTTPS.
2. Install this repository using the host's existing repository installer. It adds
   the `membership` module alongside `governance`. Review the new disabled settings.
3. Configure the host environment:

   ```dotenv
   FUSION_MEMBERSHIP_ENABLED=false
   FUSION_MEMBERSHIP_CRM_URL=https://your-crm.example.org/
   FUSION_MEMBERSHIP_TOKEN=<dedicated-random-secret-at-least-32-characters>
   FUSION_MEMBERSHIP_GUILD_ID=<approved-server-id>
   FUSION_MEMBERSHIP_ROLE_ID=<approved-member-role-id>
   FUSION_MEMBERSHIP_EXCLUSIVE_ROLE=true
   FUSION_MEMBERSHIP_INTERVAL_SECONDS=300
   ```

   The token must equal CRM's `DISCORD_MEMBERSHIP_INTEGRATION_TOKEN`; never use
   Aometry's management `API_KEY` or Discord `BOT_TOKEN`. Set the CRM's
   `DISCORD_MEMBERSHIP_TYPE_ID` to the approved MembershipType UUID. No defaults
   guess Fusion's live membership type, server or role. Optional URL path prefixes
   are supported; queries, fragments and embedded credentials are rejected.
4. Confirm the bot has `Manage Roles`, its highest role is above the dedicated
   membership role, and the role is neither integration-managed nor Administrator.
   Enable the Server Members privileged intent in the Developer Portal; the
   existing Aometry client already requests `GuildMembers`. Discord documents the
   [privileged intent requirements](https://docs.discord.com/developers/events/gateway#privileged-intents).
5. After approval, set `FUSION_MEMBERSHIP_ENABLED=true` and **restart the bot**.
   Startup reconciliation changes existing roles, including removing the dedicated
   role from unlinked/ineligible people. Test first in a non-production server with
   synthetic accounts and a test role.

Restart after installation, updates, configuration changes and removal. The host's
hot loader does not replay `ClientReady` for new plugins; a newly installed module
otherwise starts on its first join or verification command. Existing runtime
instances are replaced when an event/command observes updated code/configuration.
Pollers stop scheduling when disabled or their module files are removed. A request
already sent to Discord cannot be undone by uninstalling the module.

## Contract and testing

`GET <CRM base URL>/api/integrations/discord/membership/<Discord ID>/`
with `Authorization: Bearer <dedicated secret>` must return exactly
`{"eligible": true}` or `{"eligible": false}` on HTTP 200. No names, emails,
membership details or OAuth credentials cross this boundary. Redirects are rejected.
CRM eligibility requires a linked Discord social account and an unsuspended
membership of the configured type that has started and has no expiry or expires
today or later. A missing/invalid configuration is an error, not ineligibility.

Run `npm run typecheck` and `npm test`. Tests cover role isolation, revocation,
idempotency, duplicate requests, failed/malformed replies, unsafe configuration,
timeouts/redirect settings and disabling during verification. Discord network and
interaction handling still require the staging smoke test below; automated tests
use synthetic account adapters instead of live Discord or member records.

Staging smoke test: verify an eligible linked test account gains the test role;
unlink or expire its membership and verify it loses only that role; link before
joining the server and confirm join verification; interrupt CRM connectivity and
confirm roles remain; restart and confirm reconciliation resumes. Check private
command replies and generic failure logs for absence of personal data/secrets.

Rollback: disable the module and restart the bot before uninstalling. Existing roles
remain as last applied; an operator decides whether to retain or remove them. No
production deployment, live configuration, protected-branch merge or member-data
access is performed by this change.
