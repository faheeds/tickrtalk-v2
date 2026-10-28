# TickrTalk

A responsive implementation of the approved Concept 2 design: dark navy surfaces, jade actions, serif headings, and one shared customer workspace.

## Working interface

The sample workspace starts at `/preview/journal` and requires no credentials.

- Research: actual TradingAgents service integration, original analyst and debate sections, background analysis, cancellation, persistent history, saved reports, and Markdown export. A separately labeled sample walkthrough remains available.
- Journal: account and time filters, charts, open positions, transaction history, CSV exports, and browser-saved reflections.
- Algo Trading: three investing styles, separate Paper and Real views, filled activity, execution details, and sample activation and pause flows.
- AAOIFI Screening: portfolio screening, status filters, symbol lookup, original verdicts, qualifications, and neutral unavailable states.
- Accounts, plans, preferences, help, and a clearly labeled owner-console preview.
- Public marketing page at `/`.

Journal, AAOIFI, and the Research and Algo sample walkthroughs use illustrative preview data. The separate TradingAgents Research view calls the actual configured service and can incur model usage charges once credentials are supplied. The public hosted preview cannot create orders, brokerage connections, or subscriptions. Local loopback access can use the separately labeled TradingAgents and Alpaca paper services after explicit setup.

## Existing integrations

This project is based on `faheeds/tickrtalk`. Its broker, identity, billing, and strategy modules are retained. Authenticated `/dashboard` routes use the same shared interface with actual account data from `/api/workspace`.

The workspace adapter uses the existing SnapTrade and Alpaca clients. It matches FIFO cost basis per account, preserves unavailable cost basis, keeps paper activity out of the real Journal, avoids duplicate Alpaca journal ingestion, and preserves fractional quantities. Currency conversion, corporate-action reconciliation, short-position accounting, and completeness of broker-provided history still need validation before financial reporting is relied upon.

Screening connects to the separately deployed `faheeds/aaoifi` service through `AAOIFI_URL`. The frontend does not copy its screening rules. The service's original verdicts and incomplete income-test qualifications are preserved.

Research now includes a Python queue service that directly invokes the cloned TradingAgents package. See [research setup](services/research/README.md) for credentials, startup, provenance, testing, and hosting boundaries. The local Claude connection has generated and saved a genuine AAPL report. That run had no source URLs in its agent text and gaps in optional sentiment and macro coverage; those limitations are visible in the app. See [live verification](research-qa.md) for details.

## Configuration

Use the existing `.env.example` fields for Clerk, Supabase, SnapTrade, Alpaca, and Stripe. Additional fields:

- `AAOIFI_URL`: base URL of your deployed screening service. Production requires HTTPS.
- `RESEARCH_API_URL`: base URL of the supplied research service. HTTPS is required except for loopback service connections.
- `RESEARCH_API_KEY`: required private bearer credential shared by Next.js and the research service.
- `ENABLE_LOCAL_RESEARCH`: local-owner research access for a loopback-bound preview, disabled for hosted use.
- `OWNER_USER_IDS`: comma-separated Clerk user IDs allowed into the owner console and draft configuration API.
- `ENABLE_PAID_CHECKOUT`: disabled by default. Enable only after pricing, trial terms, and entitlement behavior are approved.
- `ENABLE_LIVE_EXECUTION`: disabled by default. The existing scheduler must remain disabled until execution, capital authorization, pause behavior, data integrity, and risk limits are validated.

Apply the supplied owner draft migration to store protected drafts. Customer sessions cannot read or write owner drafts directly through Supabase. Owner API access is checked on the server. Saving a draft does not publish strategy changes.

## Implementation boundaries

The interface is working locally. This is not a release of unattended live trading.

Real trading activation and pause currently have a sample workflow, not a completed production authorization service. Live protective-order behavior and owner release promotion need implementation and validation before execution is enabled.

Paid memberships show proposed packaging without invented prices. The original Stripe routes remain available behind an explicit checkout flag, but the new membership UI does not collect payments until the new tiers and entitlements are configured.

Reflections, sample saved selections, and preferences are currently browser-local. Actual research reports and saved flags persist per account in the research service. Notification delivery and cross-device persistence for reflections and preferences are not implemented.

The static sample research reports and screening results are never substituted for actual results on authenticated dashboard routes.

## Local checks

Run `scripts/start-local.ps1` to start the local website, research service and paper worker as independent hidden Windows processes. It uses Windows process management so temporary terminal cleanup does not stop the workers. Existing listening services are left running. Private startup logs are in the ignored `.local-run` directory. This does not install a Windows service or restart after a computer reboot. The computer must remain awake and connected while paper monitoring runs locally.

Private production settings can be supplied in the ignored `.env.hosted` file. `node scripts/check-hosted.mjs` reports missing setting names without revealing values. Add its verify option to check configured database tables and owner identities. The original paper history has been transferred to the cloud; do not start a second worker against the same account.

The project includes TypeScript checking, a production build, and tests for account-isolated cost basis, missing basis, screening coverage, execution mode separation, and screening batch limits.

Development and production can use separate output directories with `NEXT_BUILD_DIR`, so a build does not overwrite files used by the running preview. See `design-qa.md` for browser evidence and visual comparisons.

## Vercel deployment

Hosted app: https://tickrtalk-lime.vercel.app, project tickrtalk in faheedsubhani-7502s-projects. The original project in faheeds-projects-2d751c90 was not replaced.

The website, API routes, durable paper monitoring and isolated TradingAgents research run through Vercel. Supabase stores private state and reports. Clerk protects customer and owner routes. AAOIFI uses the existing owner-supplied screening provider, and SnapTrade remains the broker-history provider.

The original Day Trading paper authorization and $1,000 allocation were transferred without resetting the ledger. The local paper worker was paused, stopped and guarded against restart with .paper-data/cloud-cutover.json. The cloud workflow verified the broker connection and original $1,006.61 allocated value. Cloud checks sleep until the next session when the market is closed. Review heartbeat and next scheduled check in the owner console. Trades still require a qualifying signal and all risk and cash checks.

Clerk currently uses development keys, paid checkout and real-money execution remain disabled, and operational alert delivery is not implemented. Existing Journal broker connections with rejected credentials need reconnection; their records were preserved. This is a validated personal paper deployment, not a commercial customer release.

The clean .vercel-staging package excludes private environment files, local databases, CLI credentials, saved reports and local worker servers. Production settings are supplied privately from .env.hosted. The deployment helper preserves the configured cloud execution flag, and refuses to publish enabled execution if the local retirement marker is missing or port 8003 is still listening. Never remove that guard while cloud execution is active.

## Vercel-only worker migration

The hosted deployment uses PAPER_RUNTIME=cloud and RESEARCH_RUNTIME=cloud. Cloud order placement additionally requires CLOUD_PAPER_EXECUTION=true and an active customer paper authorization. Initial validation used observation mode before local retirement and cloud activation.

Paper checks run as bounded Vercel Workflow steps, with a one-minute interval during an open market and durable sleep until the next session when closed. PostgreSQL stores the encrypted account state and complete ledger. A single-writer lease and revision checks fence competing requests. Broker submit and cancel calls require a successful durable checkpoint first. Interrupted submissions become uncertain and reconcile by their original broker IDs. Existing broker protective orders remain in place. This checkpoint design is intended for the initial small deployment; a multi-customer commercial rollout needs capacity, quota and failure-alert validation.

Research runs the original pinned TradingAgents commit in an isolated Vercel Sandbox. The source archive includes the upstream license and a SHA-256 integrity check. The sandbox uses a complete uv-managed Python environment because the lightweight runtime omits SQLite. Each job has an exclusive execution marker, saved progress and a deadline. Exhausted workflow retries mark the job failed and attempt to release its sandbox without changing cancelled or completed reports. A fresh hosted AAPL analysis completed, was saved, and its sandbox stopped. The run had no source URLs and had incomplete optional Reddit and macro coverage; those qualifications are displayed prominently. PostgreSQL preserves reports, saved flags and account ownership; duplicate active jobs and customer access to private worker tables are blocked. Provider keys are read inside worker steps and are never returned in report metadata or Workflow inputs.

Apply supabase/migrations/20261015_cloud_workers.sql to the existing Supabase project. The apply-cloud-schema script can apply it transactionally when DATABASE_URL is supplied privately; otherwise use the Supabase SQL editor. Existing broker and Journal tables are not replaced.

The stage-cloud-history script defaults to inspection. Its stage option verifies the Clerk owner, preserves the paper encryption key, stages a paused copy of the original allocation and imports finished research records. It leaves local execution unchanged. Before final cutover: verify cloud observation against Alpaca, pause and retire the local paper worker, refresh the staged history, confirm broker reconciliation and original allocation totals, then enable cloud execution and start a new monitoring generation from the owner console. Never run local and cloud execution concurrently for one broker account. If cutover validation fails, keep cloud execution disabled and restore local monitoring.

The prepare-cloud-deployment script packages only application source, workflows and the pinned research engine. It excludes private environment files, local databases and reports. The deploy-cloud script checks credentials, owner identity and database availability before saving encrypted production variables and publishing to the existing Vercel project. DATABASE_URL is never sent to Vercel. Clerk test keys are suitable for validation, not a customer production release. Paid checkout and real-money execution remain disabled. Vercel Workflow, Sandbox, database and provider usage must be monitored against the selected plan’s limits.
