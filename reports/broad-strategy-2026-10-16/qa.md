# Strategy research verification

The completed research report is visible in the real Strategy Lab component. Desktop and mobile interaction checks passed. The strategy remains disconnected from order execution and has not been published to Vercel.

## Environment

- Local fixture: http://127.0.0.1:4190, with the actual generated owner report and real React components.
- Browser: Codex in-app Chromium through CUA browser automation. A separate Browser skill was not listed; the available browser automation was used without external Playwright.
- Desktop: normal browser viewport, approximately 1026 by 875.
- Mobile: explicit 390 by 844 viewport, restored after verification.
- The fixture provides a local report response. It does not bypass authentication in the application or make broker calls.

## Checks

- Page identity and meaningful content: passed. The fixture title is Owner Strategy Lab verification, with the real completed report, six comparisons and a dated twenty-stock shortlist.
- Framework overlay: none observed.
- Console: no relevant React/runtime warnings or errors observed. Intentional fixture service failures were exercised separately.
- Strategy selection: switching from VWAP reclaim to Morning momentum changed the comparison to the correct development figures, including 223, 262 and 28 trades for the three universes.
- Period selection: switching Development and Later test changed the displayed return and trade figures.
- Risk details: expansion exposed the $2,000 research allocation, $5 initial risk per trade, two-trade daily cap and $15 daily entry-pause threshold.
- Failed refresh: an intentional report failure retained the existing report and showed the failure. A subsequent refresh recovered.
- Worker unavailable: the real PaperOwnerView was mounted against an intentional execution-service failure. Strategy Lab remained visible and usable. No execution action was available.
- Mobile layout: no horizontal page overflow. Document width was 375 pixels in a 390-pixel viewport, accounting for the scrollbar. Period controls were 44 pixels tall.
- Mobile table: a 530-pixel comparison table stayed within its 289-pixel scroll region. Keyboard scrolling moved the region by 40 pixels; it was returned to zero before the final mobile screenshot.
- Read-only status: the panel showed Research only, explicitly stated that the active paper release was unchanged, and did not expose an activation action.

## Engineering checks

- All 107 project tests passed, including cash-only sizing, signal timing, historical eligibility, split-aware affordability, adverse gap handling, news timestamp filtering, semantic fingerprints and owner-role access.
- TypeScript checks passed.
- The final production build passed after the worker-independent research panel change. The owner research endpoint is a dynamic server route.
- Unauthenticated local API access returned 503 while local account services were unconfigured, with no research snapshot in the response. The configured-owner role check was tested separately, including null, non-owner and partial-match identities.
- The experiment selected its diagnostic candidate using development data only. No combination met development qualification. Later comparisons did not change the selection.
- The additional zero-selling-fee sensitivity is explicitly labeled post-hoc, applies only to the frozen candidate, and does not alter the original experiment or promote it.

## Limits

The authenticated hosted owner journey was not tested because these changes are not deployed. The local UI fixture is not proof of production sign-in or broker execution. Historical screening, verified catalysts throughout the test period, point-in-time membership, feed entitlement and prospective paper reconciliation remain unverified. The four disclosed stock-session price-audit exclusions are retained in the results.

Key verification sequence: local component build, browser DOM and screenshot inspection, setup and period selection, risk disclosure, failed-refresh recovery, execution-worker failure, mobile keyboard scrolling, viewport restoration, TypeScript, project tests and production build.

## Evidence

Desktop comparison:

![Completed local owner research panel](<C:/Users/Faheed Subhani/.codex/visualizations/2026/10/13/01a136e7-e446-7100-a3a8-218db025257b/strategy-lab-desktop.png>)

Mobile comparison:

![Mobile owner research comparison](<C:/Users/Faheed Subhani/.codex/visualizations/2026/10/13/01a136e7-e446-7100-a3a8-218db025257b/strategy-lab-mobile.png>)

Execution-worker failure with research still available:

![Research available during simulated execution-service failure](<C:/Users/Faheed Subhani/.codex/visualizations/2026/10/13/01a136e7-e446-7100-a3a8-218db025257b/strategy-lab-worker-unavailable.png>)
