# TradingAgents Research integration

This service invokes `TradingAgentsGraph.propagate(symbol, analysis_date, asset_type="stock")` from the user's TradingAgents checkout. It does not generate replacement research or place trades.

Reviewed checkout: https://github.com/faheeds/TradingAgents_TauricResearch

Reviewed commit: `01477f9afb7a47b849ed4c9259d3a9a4738d9fda`, package version 0.3.1. The checkout lives at `../../../repo-review/TradingAgents_TauricResearch` relative to this directory. The installed Python package must come from that configured checkout. Reports record the actual commit, working-tree state, provider, and model names at execution time.

## Local setup

Python 3.12 is used for this installation. Run `scripts/setup-research.ps1` from the app directory if recreating the environment. It installs the locked dependencies and the local repository as an editable package, then creates private `.env.research` and `.env.local` settings. Existing service credentials are preserved.

If the repository is absent, clone the repository into the location above and check out the reviewed commit. Updating the engine requires repeating compatibility and data-quality validation.

Add your provider key to `.env.research`. The generated local file selects OpenAI and uses the model names supplied by the repository's defaults. Confirm those models are available to your account or change them to models supported by your selected provider. No provider key is bundled with the app.

Start the service with `scripts/start-research.ps1`. It binds to 127.0.0.1:8001. Restart it after changing service settings. Restart Next.js after changing `.env.local`.

The service token is generated locally and never sent to the browser. The browser calls `/api/research`; Next.js authenticates the account and forwards the trusted user ID. A loopback-only development override allows the owner to exercise research from the local preview without setting up Clerk. The override requires `ENABLE_LOCAL_RESEARCH=true`, a localhost request host, and matching Origin for mutations. Keep the Next.js server bound to 127.0.0.1 while using it. Do not enable that override on a deployed or publicly forwarded server.

## Hosted configuration

Disable `ENABLE_LOCAL_RESEARCH`, configure Clerk, and use an HTTPS `RESEARCH_API_URL` pointing to this service's base URL. Supply the same private `RESEARCH_API_KEY` to Next.js and the research service. Never expose that key through a public environment variable.

The API service requires its bearer token and a trusted `X-Research-User` on job requests. Accounts can list, open, save, and cancel only their own jobs. Server settings control model choice, debate rounds, time limits, and daily job limits. Customers cannot change those settings.

SQLite stores the queue, job statuses, original reports, and saved-report flags. Use persistent encrypted storage with appropriate access controls and backups for hosting. This is a single-process service for a modest initial workload, not a distributed worker fleet. Define data-retention policy before accepting customer traffic. Private worker logs can contain upstream diagnostic information and must not be publicly served.

## Report behavior

Original fundamentals, technical, news, sentiment, investment conclusion, bull/bear debate, proposed trade plan, risk debate, and final risk review are preserved. Missing sections stay missing. Markdown is rendered without raw HTML. Source links are extracted from agent text and labeled unverified; they are not invented citations. Report metadata distinguishes requested analysis date from generation time and warns that the date does not guarantee point-in-time fidelity.

Runs use today's UTC date. Historical backtesting is deliberately not exposed through this customer flow. Each job receives isolated memory, cache, and result directories to avoid cross-customer research memory contamination. One worker runs at a time. Queued jobs survive service restart; interrupted jobs become failed and may be rerun. Active jobs can be cancelled. The default time limit is 20 minutes, the per-account daily limit is 20, and the global active queue cap is 20. These limits do not guarantee a maximum model bill.

The service never imports the app's broker clients or order routes. Trading proposals in research remain text. They do not activate Algo Trading.

## Validation

Run `.venv-research/Scripts/python.exe -m unittest discover -s services/research -v` and the app's typecheck, tests, and production build. Tests exercise report mapping, missing evidence, HTTP authentication, account isolation, concurrency limits, SQLite persistence, saved reports, restart recovery, subprocess cancellation, timeout, actual upstream graph construction, and the runner's invocation contract.

Upstream graph construction is tested without network calls. A mocked graph verifies the runner contract; fixture subprocesses verify worker lifecycle. A genuine Claude-backed AAPL report also completed on October 13, 2026, after the owner supplied a provider key. All nine sections were generated, but no source URLs were included in the agent text, and some optional sentiment and macro coverage was unavailable. See ../../research-qa.md for the evidence and boundaries. This verifies execution and delivery, not investment accuracy.
