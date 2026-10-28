# TradingAgents integration verification

Result: integration plumbing, interface, and the first genuine Claude-backed AAPL report passed, with the evidence limitations described below. This does not certify the report's financial claims or production readiness.

Provider update: the owner selected Claude after the initial setup and supplied ANTHROPIC_API_KEY privately. The local service uses Anthropic with claude-sonnet-4-6 for both research roles. The pinned repository catalog emits an unknown-model warning but permits execution. Sonnet 5.5 was considered, but the installed library warns that the repo's default forced-tool structured-output path is unsupported for that model. Sonnet 4.6 avoids that incompatibility and successfully completed the genuine run.

## Genuine analysis verification, October 13, 2026

Job `5093f2d6-2ad7-4fbc-914f-f7047b72e43e` completed in approximately thirteen minutes with today's UTC analysis date. All nine original analyst, debate, and review sections contained content. The completed report survived a service restart, opened in the app, and was saved through the user interface. No order was placed.

The initial attempt failed because yfinance tried to open its cache outside the writable workspace. The runner now configures yfinance's timezone, cookie, and identifier caches inside each job directory. A subprocess regression test verifies actual cache writing without network access. The successful retry used that fix.

The completed run supplied zero source URLs in its agent text. Reddit sources were partially rate-limited, and optional FRED macro data was unavailable because a separate FRED key was not configured. Those facts are preserved in report warnings. Known provider-failure messages are mapped to customer-facing coverage notes without exposing private logs. The first completed report was backfilled with those notes from its own log after completion; its original section text was preserved. Report views now show an evidence-coverage notice before the original content.

Runtime inspection identified the final portfolio-manager call during the long run. Its actual observed stage was reflected in the first job. Future runs now forward callbacks into the graph invocation as well as the LLM clients so completed report stages can be published automatically.

Eleven Python tests passed after the fixes, alongside the eight existing JavaScript tests. The final frontend production build passed. Actual long-form report rendering was checked at desktop and mobile sizes; nine financial tables rendered without document overflow at 390 CSS pixels. Browser error and warning logs were empty. The stored report was checked against private credential values and contained none.

Evidence: `qa/research-live-report-desktop.jpg`, `qa/research-live-report-mobile.jpg`, and `qa/research-live-sources-desktop.jpg`. These are genuine generated-report screenshots, unlike the earlier fixture evidence below. The financial figures, source completeness, and historical data fidelity have not been independently certified.

During the final check, a separate CRWV job appeared while the earlier AAPL report was open. It was mistakenly treated as an extra verification run and cancelled. CRWV was restarted immediately under job `530c4d8d-37b1-4b24-b993-b89fa2194d2b`. Its processing outcome is not part of the completed AAPL verification. User-started analyses must be preserved during QA.

## What is connected

The Python environment installs the actual `faheeds/TradingAgents_TauricResearch` checkout as TradingAgents 0.3.1. The runner directly constructs `TradingAgentsGraph` and invokes its stock analysis workflow. The Next.js route proxies authenticated jobs to the token-protected Python service. The UI preserves original report sections instead of replacing them with a three-field summary.

During the initial credential-free checks, the actual service on port 8001 returned a healthy connection with `ready: false` and exactly one missing setting, OPENAI_API_KEY. The app on port 4173 returned HTTP 503 for an attempted analysis rather than returning a sample. A mutation from an unrelated Origin returned HTTP 401. No genuine model request or order was made during those checks.

## Automated checks

Nine Python tests passed: original report mapping and source extraction, missing evidence, service authentication and configuration failure, account isolation and concurrency, persistence and saved flags, restart recovery, worker completion and process cancellation, worker timeout, actual upstream graph construction, and the runner invocation contract. Some checks cover multiple behaviors in one test.

Eight JavaScript tests passed, including the existing finance tests and new local-access checks for opt-in, Next.js hostname normalization, matching Origin, missing mutation Origin, malicious host, and cross-site requests. The production build includes TypeScript verification and passed.

The real upstream graph was constructed without sending a model request. Its actual fundamentals and market analyst nodes were verified. The runner contract test mocked the graph response; subprocess lifecycle tests used isolated fixture runners. Python dependency consistency checking passed.

## Browser checks

The isolated fixture service on port 8002 used temporary storage and clearly identified its content as UI TEST FIXTURE. A separate app instance on port 4174 targeted that service. Its reports were never written into the actual research service database.

Verified starting a job, queued and running progress, completed report opening, analyst section switching, bull/bear sections, source qualifications, saving, saved-history filtering after reload, Markdown export, and cancellation before completion. A cancellation race initially produced a misleading toast when the job had already completed; the UI now uses the returned status to distinguish cancellation from an already finished analysis. Background progress now continues when a user opens an older report.

Markdown tables and links rendered. Raw script markup appeared as text, with zero script elements in the report DOM. Relevant browser error and warning logs were empty. Desktop at 1440 × 1024 and mobile at 390 × 844 had no document overflow. The dark navy, jade accents, shared typography, and four mobile navigation entries remained consistent with Concept 2.

Evidence: `qa/research-report-fixture-desktop.jpg`, `qa/research-report-fixture-mobile.jpg`, and `qa/research-connected-final.jpg`. Fixture screenshots are interface test evidence, not generated financial research.

## Corrections and limits

Corrected SQLite connection closure after Windows tests found locked files. Corrected local Origin comparison to use the browser's Host header because Next.js normalizes the internal request URL. Added tests for that behavior and for rejection of cross-site access. Neutralized sample screening badges in the actual-research preview to avoid mixing illustrative halal assessments with genuine research. Loaded the report renderer separately to avoid adding its full parser to every workspace screen.

Upgraded Next.js from 15.5.18 to 15.5.27 after the dependency audit identified critical advisories. The subsequent production dependency audit reports zero critical findings, seven high findings, and two moderate findings. Dependency hardening remains a release requirement; this work is a local research integration, not production security certification.

Additional analyses require valid provider credentials and available model choices. Hosted use also requires customer authentication, persistent protected storage, operational monitoring, retention policy, and data-quality validation beyond this successful execution check. The local-owner override must stay off on hosted or forwarded servers. See `services/research/README.md` for setup and boundaries.
