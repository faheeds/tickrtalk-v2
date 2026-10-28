# Selective morning momentum research

Research only. No strategy in this directory is wired to paper or live order execution. The first experiment was rejected: no tested variant established a positive edge after modeled costs.

The protocol fixes the hypotheses, sample, chronological splits, cost assumptions and acceptance thresholds. The model uses completed bars, risk-based whole-share sizing, cash reservations, conservative stop handling and next-session availability of sale proceeds. Missing screening history prevents claiming performance for the app's halal strategy.

From the project directory, run these in order:

1. node scripts/fetch-strategy-research.mjs
2. node scripts/run-strategy-research.mjs
3. node scripts/report-strategy-research.mjs
4. npm test

The data fetch requires the existing private hosted configuration. It reads credentials in memory and makes historical-data GET requests only. Raw market data is cached in the ignored local-run directory. It cannot submit broker orders or change account settings.

The run freezes its development selection before calculating validation or test. An existing frozen experiment cannot silently acquire a different protocol, model or winner. Later hypotheses need a separately registered experiment, with an explicit record that these historical periods have already been inspected. Preserve failed experiments.

The report and complete trade logs are under reports/day-strategy-research-2026-10-15. A passing retrospective test would qualify only for further paper validation, never a guarantee of profit or automatic production promotion.
