# Journal: Your money. Your progress.

final result: passed

Scope: local implementation and visual QA. Live historical-data access is pending the SnapTrade Account Value History add-on. This is not a production deployment or a claim that broker history is available.

## Source and evidence

Selected visual: Capital & Gains, the third displayed generated concept, identified by the user through its headline. Source: C:/Users/Faheed Subhani/.codex/generated_images/01a136e7-e446-7100-a3a8-218db025257b/exec-47cc806e-a8a4-4bb3-8bd5-fee7a642512a.png (1536 by 1024 presentation with desktop and mobile regions).

Rendered page: http://127.0.0.1:4186/preview/journal

Desktop: qa/capital-desktop.png, 1440 by 1024 CSS viewport, device scale 1. Full page: qa/capital-desktop-full.png. Mobile: qa/capital-mobile.png, 390 by 844 CSS viewport, device scale 1, full-page capture. Additional data-state evidence: qa/capital-inr-empty.png, isolated component fixture.

The source and rendered images were opened together in comparison inputs for both desktop and mobile. Comparison concerns the Journal module, excluding the concept presentation heading, existing app navigation and subsequent transaction table. Different sample values are intentional. The source has a separate mobile companion rather than one continuous full-page capture. The full-page mobile screenshot captures the fixed navigation at its viewport location; scrolling makes the content underneath accessible.

## Findings and fidelity surfaces

No unresolved P0, P1 or P2 findings in the local UI.

- Typography: retained the existing app serif heading and sans-serif interface to keep all four features consistent. Large jade figures preserve the selected hierarchy. Mobile figures with long native-currency formatting stack instead of overflowing. The concept presentation title is omitted from the app.
- Spacing and layout: wide chart and horizontal capital equation on desktop; touch controls, chart and vertical equation on mobile. Existing sidebar and bottom navigation remain. Added a separate P&L view and accessible chart-data disclosure, which intentionally increase vertical space relative to the static concept.
- Colors and tokens: existing navy surfaces, jade account value, pale blue dashed contributions, muted labels and established loss color. The chart shades the difference between value and contributed capital, with a loss fill below the baseline.
- Image and asset fidelity: this module has no photographic or decorative image assets. Existing Phosphor icons are retained. Chart.js renders data as a chart, not as an image approximation or decorative asset. The source's presentation frame and labels are not product branding.
- Copy and content: selected headline retained. Investment result replaces investment gain so losses read naturally. Ending value is distinguished from the latest reported account balance. Clear estimated-history, missing-history, incomplete-contribution and illustrative states replace unsupported values. USD and INR remain separate.
- Resolved during QA: corrected text-file encoding; fixed optional chart layout type; corrected category-axis dates after custom tick selection; added large-balance responsive stacking; avoided a fictitious zero portfolio when no accounts are selected.
- P3 follow-up: the concept's permanent gain bracket and individual deposit annotations are represented by endpoint labels, the dashed baseline, hover details and the capital equation. No decorative bracket is needed for the current implementation.

## Verified interactions

- Date-range buttons and dropdown switch the chart period; the realized P&L view displays its own chart.
- Account filtering changes values and preserves selection after reload. Empty selection shows an unavailable balance and selection guidance.
- Chart data opens and closes; its 25 demo observations include the starting value, net contributions and investment result.
- A no-history fixture retains the current account value and offers realized P&L.
- An incomplete-contribution fixture shows account values while suppressing both the gain estimate and comparison baseline.
- Native INR fixture shows a large Indian-formatted amount without USD conversion or horizontal overflow. USD data and trades are excluded when INR is selected.
- Main page and fixture contain meaningful content, correct page titles and no framework overlay. No new console errors after the final corrected reload; fixture console was clean. Earlier development encoding errors were fixed and are excluded by the final reload timestamp.
- Desktop and mobile have no horizontal document overflow.

## Calculations and broker integration

Account value uses the broker-reported total, not buying power and not the sum of visible equity positions. Native slices of a multi-currency account do not receive a converted account total. Missing balances are not silently dropped from a selected combined total.

History is aggregated only for dates observed across every selected account. Investment result equals ending value minus starting value minus net external contributions within that actual history window. Contributions and withdrawals are separate from trades, income and fees. Ambiguous transfers, unvalued security movements, unknown cash-flow types, incomplete imports and unsynced ledgers suppress gain calculations. History is labeled estimated where supplied by SnapTrade. No account-value history is reconstructed from realized P&L.

Activity pagination is bounded and time-limited; incomplete imports are flagged. Existing API authentication and encrypted credentials remain in place. No new trading instructions, account registrations, subscription changes or live orders were made.

Read-only broker verification: all eight current accounts report a total value; seven USD and one INR. All eight historical-value requests returned 403. SnapTrade documents the history add-on as free, experimental, disabled by default and limited to one year. Two years remains a selectable maximum; actual available dates are displayed without inventing earlier observations. No SnapTrade add-on setting was changed.

Authenticated local dashboard verification was not performed; the local public preview, isolated state fixtures, provider reads, unit tests and production build were verified. The live Vercel deployment still has its earlier UI.

## Checks

- Production build: passed after final chart correction.
- Automated tests: 77 passed, zero failed.
- Desktop and mobile browser verification: passed using the Codex in-app browser.
- Existing calculation regression checks: passed.
- Preview server remains running on 4186. Temporary fixture server is stopped after verification.

## Implementation checklist

- [x] Selected concept implemented within the existing Journal.
- [x] Accurate total-value data path and separate native currencies.
- [x] Honest history coverage and unavailable states.
- [x] Contribution reconciliation and tests.
- [x] Desktop, mobile, persistence and accessible data checks.
- [ ] Enable the SnapTrade history add-on to make live historical data available.
- [ ] Publish this revision if requested.

## Production publication and signed-in verification

Published the approved revision to https://tickrtalk-lime.vercel.app/dashboard/journal. Final deployment: dpl_CEEG3moAUFLALhYYg7i9fRsLTzTk. Vercel production build and TypeScript checks passed. Existing production environment variables were preserved.

Signed-in live verification uncovered that Zerodha returns cash alone in its balance.total field. Added a provider-specific calculation using separately reported cash plus fully priced holdings, excluding cash-equivalent positions to avoid double counting. Missing cash, unknown prices, failed position fetches and multi-currency slices do not produce a calculated value. Both Journal and Accounts label this calculated value estimated. Other brokers retain their reported totals. This correction was tested and published in the final deployment.

80 tests passed. Verified the authenticated production Journal loads its new headline, preserves the INR selection, shows the corrected estimated balance, exposes the unavailable historical-value state and switches to its realized P&L chart with 162 observations. No app errors appeared in the final browser log. Existing Clerk development-key warnings remain; credentials were not changed by this deployment.

Production screenshot: qa/journal-published.png. Historical account values still require the SnapTrade add-on. No trading settings, account authorizations, brokerage registrations or order actions were changed.
