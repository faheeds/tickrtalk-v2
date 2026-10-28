# Paper beta readiness

Assessment: the app has working owner paper trading and per-user server data paths, but is not ready for unrestricted public signup. A sample preview can be shared now for interface feedback. A small invited group can test automated paper trading after authentication, onboarding and second-user validation are complete.

## Current implementation

- Signup and login routes use Clerk. Protected dashboard and API routes require a session.
- The deployed custom account menu lacked actual logout. Local code now includes current email, Sign out and Use another account through Clerk's SDK. The current session is explicitly selected; switch-account signs it out and opens sign-in. Public previews now link to sign-in as well as signup. These changes have not been published.
- Automatic paper trading uses the hardcoded Alpaca paper endpoint. Each app user connects their own encrypted paper credentials. The account store enforces unique broker account IDs, stores allocations by user, and returns activity by user. Owner strategy operations are restricted by the configured owner IDs.
- New paper accounts must pass the existing cash-only broker checks, including 1x buying power and no shorting. Clear setup instructions and a complete new-user trial are still needed.
- Paid checkout and live execution are disabled in the hosted configuration. Cloud paper execution is enabled. No execution settings changed during this assessment.
- Hosted authentication still uses development keys. SnapTrade still uses a test key. Vendor production setup and capacity must be resolved before real customer onboarding. Brokerage Journal connections can be omitted for an initial Algo-only paper test.
- Research has one active job per user, a 20-job shared active queue limit and 20 requests per user per UTC day in its migration. Those are not a dollar spending budget. Initial tester quotas and cost monitoring need explicit decisions.
- There is no implemented in-app feedback submission flow or beta invitation gate in the reviewed source.
- Multi-user storage paths and regression tests exist. A complete second-user signup, independent credentials, paper authorization, execution visibility and account-switch isolation journey has not been verified in production.
- Screening persistence migration is applied, with code ready locally. Publication remains blocked pending explicit approval from the user after the previous automatic-review rejection. Existing page-memory-only mobile assessments have not been restored into production storage.

## Proposed limited beta

Use separate accounts for every tester, with each tester's own Alpaca paper account. Keep live trading and paid checkout disabled. Start with an invited group, clear simulated-money labels, explicit strategy consent, pause controls, setup help and a working feedback route. Do not share the owner's credentials or trading account. Verify two independent users before invitations, including that logging out does not expose one user's data to another. Signing out does not pause active cloud paper strategies.

## Verification of account-menu change

Production build and TypeScript checks passed. The real AccountSessionActions component was rendered in an isolated local fixture with synthetic identity and mocked Clerk sign-out handlers. Both destinations and the explicit session ID were checked without signing out a real user. Desktop and mobile layout were checked; no fixture console errors. The actual sample workspace menu was also checked for the new sign-in links. Real authentication revocation and second-user login remain unverified.

Evidence: qa/account-session-controls.png and qa/account-session-controls-mobile.png.

## External references

- Clerk development instances are not intended for production workloads and are limited to 100 users: https://clerk.com/docs/guides/development/managing-environments
- Alpaca supports free Paper Only accounts and simulated orders: https://docs.alpaca.markets/us/v1.4.2/docs/paper-trading
- SnapTrade distinguishes Personal and Commercial end-user integrations: https://docs.snaptrade.com/docs/personal-vs-commercial
- SnapTrade production key approval steps: https://docs.snaptrade.com/docs/getting-started
- The current checkout disablement is an application decision, not a legal conclusion. US investment-adviser obligations depend on activities, compensation and applicable exclusions; paper-only is not blanket legal clearance: https://www.sec.gov/files/divisions/investment/iaregulation/memoia.htm
