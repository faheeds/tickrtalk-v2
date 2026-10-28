# Point-in-time S&P 500 membership

`sp500_ticker_start_end.csv` is copied from https://github.com/fja05680/sp500 (MIT license), commit dated 2026-09-07.
Each row is one membership interval for a ticker (`end_date` empty = still a member). The momentum backtest uses it
to allow a symbol only on rebalance dates when it was actually in the index, which removes the pre-inclusion
lookahead of a current-constituent universe. It cannot restore names that left the index and no longer have
Alpaca price history, so some survivorship bias remains. Tickers follow the dataset's spellings (e.g. `BRK.B`).
