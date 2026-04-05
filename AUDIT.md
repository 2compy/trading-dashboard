# TradeDash — Full Project Audit
**Date:** April 4, 2026 | **Commits:** 54 | **Stack:** React 19 + Vite + Zustand + Lightweight Charts + Vercel Serverless

---

## What's Been Built

A full-stack futures trading dashboard covering:

- **Live Charts** — TradingView Lightweight Charts with 5 timeframes (1m/5m/15m/1h/1d), 4 symbols, real-time price ticks, ET timezone, ResizeObserver-based responsiveness.
- **Trade Manager** — Manual and auto trade entry with per-symbol ON/OFF toggles, independent LONG/SHORT bias per symbol, and configurable trade count (1–5 or infinite).
- **Trade Logs** — Open positions with real-time unrealized P&L, full closed trade history table.
- **Portfolio** — Win rate, avg win/loss, per-symbol unrealized/realized breakdown, combined P&L list with live updates.
- **Backtest Engine** — Full ICT strategy backtesting against Yahoo Finance data (5m 60d + 1m 7d), with MGC1! running a separate HTF-bias strategy.
- **Auto-Trading** — Master switch with 30s interval, per-symbol cooldowns, strategy-signal-gated entries.
- **ICT Strategy** — Kill zones (London/NY/PM), daily H/L liquidity sweeps, Break of Structure (BOS) detection, Fair Value Gap (FVG) detection, Inverted FVG (IFVG) entry logic.
- **API Layer** — 3 Vercel serverless functions: `quotes.js`, `candles.js`, `backtest.js`, all backed by Yahoo Finance.
- **Sim + Live modes** — Toggled via `VITE_USE_LIVE_API`, clean separation throughout.

---

## Bugs & Correctness Issues

### 🔴 High Priority

**1. ID skip bug in `runAutoTrade` (store.js ~line 263)**
In the per-trade loop, `id: get().nextId + i` is evaluated *after* the previous iteration's `set()` has already incremented `nextId`. For a count of 2 the IDs generated are `nextId` and `nextId+2`, skipping one. `enterTrade` handles this correctly (captures `state.nextId` once, updates by `count` at the end). `runAutoTrade` should do the same.

**2. `fetchMTFCandles` hits the backtest endpoint every 5 minutes per symbol (store.js ~line 84)**
The backtest API fetches ~3 days of chunked 5m data + 7d of 1m data on every call. Triggering it for all 4 symbols every 5 minutes means 8 expensive Yahoo Finance requests per cycle. For just extracting recent candles for the live signal, this is massively over-fetching. The MTF data needed for `getLiveSignal` is only the last ~30 5m candles and last ~100 1m candles — the `/api/candles` endpoint already supports this.

**3. Double `fetchCandles` call on timeframe change (LiveChart.jsx)**
When the user clicks a timeframe button, `handleTimeframe` calls `fetchCandles(selectedSymbol, tf)` directly, and the `useEffect` with `[selectedSymbol, timeframe]` dependency also fires a second fetch. Results in two simultaneous API requests on every TF switch.

### 🟡 Medium Priority

**4. TradeLogs uses local timezone, everything else uses ET (TradeLogs.jsx line 3)**
The `fmt` function uses `new Date(iso).toLocaleDateString()` + `toLocaleTimeString()`, which renders in the user's local system timezone. The chart, backtest, and strategy all use `America/New_York`. A user in London would see inconsistent times between the chart and the logs.

**5. Strategy logic duplicated between frontend and backend**
`src/utils/strategy.js` and `api/backtest.js` both implement `detectFVGs`, `detectBOS`, `detectSwings`, `buildDailyHL`, `findIFVGEntry`, etc. They're already diverged (backtest has the optimized pointer-based `detectBOS`, frontend has the filter-based version). Any future strategy change requires updating both files.

**6. `Sl1!` base price is unrealistic for backtesting context (store.js line 7)**
`base: 33.5` represents Silver at $33.50/oz which is the spot price, but the Mini Silver futures contract (SIL=F) has a different point value. The CONTRACT_MULTIPLIER has it at 5, which may not be correct for Mini Silver (the CBOT Mini Silver is 1000 oz, not 5). This affects simulated P&L accuracy.

**7. SL/TP never auto-triggers in simulation mode**
When `USE_LIVE` is false, open trades never automatically hit their stop loss or take profit — they sit open indefinitely until the user manually closes them. This makes the sim mode misleading for risk testing.

**8. `tradeCount` in `runAutoTrade` not parsed as integer**
`const count = settings.tradeCount === 'infinite' ? 1 : settings.tradeCount` — `settings.tradeCount` is stored as whatever `updateTradeSetting` receives (could be the number `3` but stored through React state updates). Should be `parseInt(settings.tradeCount)` to be safe.

### 🟢 Low Priority

**9. `App.css` is empty (/* unused */)**
The file exists but has no content. It's still imported in `App.jsx` unnecessarily.

**10. `findLastIndex` used in backtest (api/backtest.js line 238)**
`candles4h.findLastIndex(...)` requires Node 18+. Vercel's default runtime should be fine, but worth documenting.

**11. Backtest response sends full candle arrays (api/backtest.js line 506)**
The response JSON includes `candles5m` and `candles1m` (potentially thousands of data points) for every backtest call. This is used by `store.fetchMTFCandles` to populate the strategy state, but sends large payloads even when the user is just viewing results in the Backtest tab.

---

## Architecture / Code Quality

**12. Store is doing too much**
`store.js` handles data fetching, tick simulation, trade lifecycle, market hours, auto-trading, and all state. It's ~330 lines and growing. Splitting into domain slices (e.g., `useMarketStore`, `useTradeStore`, `usePriceStore`) via Zustand's `create` with slices pattern would make this much more maintainable.

**13. No trade persistence**
All trades are in-memory only. A page refresh loses everything. Even basic localStorage persistence for the `trades` array would prevent frustrating data loss.

**14. No error boundaries**
If `LiveChart`, `Backtest`, or any component throws, the entire app crashes. Adding React error boundaries per tab would isolate failures.

**15. Inline styles everywhere**
The codebase mixes inline `style={{...}}` objects with CSS classes. Every render creates new style objects. Extracting to CSS classes or a utility approach (even minimal Tailwind or CSS modules) would reduce noise and improve render performance.

---

## Feature Gaps & UX Improvements

### High Impact

**16. No equity curve in Backtest**
The backtest returns a trade list but there's no cumulative P&L chart over time. An equity curve is the single most important visual for evaluating a strategy — max drawdown, drawdown duration, and consistency are invisible without it.

**17. No chart overlays for strategy signals**
The live chart shows raw candlesticks but no FVG zones, kill zone shading, sweep levels, or BOS markers. Users have no visual confirmation that the strategy is reading the chart correctly.

**18. No trade entry/exit markers on the chart**
There's no visual showing where open or closed trades were entered/exited on the chart. This is table-stakes for any trading UI.

### Medium Impact

**19. Backtest missing key statistics**
Currently shows: win rate, total trades, wins, losses, net P&L.
Missing: Max drawdown, profit factor (gross wins / gross losses), average RR, Sharpe ratio, longest win/loss streak, best/worst trade.

**20. Portfolio PnlBar only shows last 6 trades**
`closed.slice(0, 6)` — this should either be configurable or show all trades in a scrollable container.

**21. No alert/notification when auto-trade fires**
When the master switch fires a trade, nothing draws the user's attention. A small toast or badge flash would help a lot.

**22. No way to see *why* no signal was generated**
The live signal returns `null` if any condition fails (no kill zone, no sweep, no BOS, no FVG, no IFVG). There's no debug output to tell the user which condition is blocking a signal, which makes it hard to tune the strategy.

**23. Backtest has no date range control**
The backtest always runs against the full available data range (Yahoo's 60d of 5m). A date range picker would let users compare performance across different market regimes.

**24. Win Rate in header badge doesn't distinguish sim vs live trades**
The header win rate badge mixes auto trades (which may fire on simulated data) with manual trades, making it a misleading metric.

---

## Prioritized Fix List

| Priority | Item | Effort |
|----------|------|--------|
| 🔴 | Fix ID skip bug in `runAutoTrade` | 5 min |
| 🔴 | Fix double `fetchCandles` on TF change | 10 min |
| 🔴 | Add SL/TP auto-close in sim mode | 30 min |
| 🔴 | Fix `TradeLogs` timezone to ET | 5 min |
| 🟡 | Add equity curve to Backtest | 2–3 hrs |
| 🟡 | Add trade markers to live chart | 2 hrs |
| 🟡 | Add chart overlays (FVG zones, kill zones) | 3–4 hrs |
| 🟡 | Replace `fetchMTFCandles` with lightweight `/api/candles` calls | 1 hr |
| 🟡 | Trade persistence via localStorage | 1 hr |
| 🟡 | Add Backtest stats: max drawdown, profit factor, streaks | 1–2 hrs |
| 🟢 | Merge strategy logic into shared module | 1–2 hrs |
| 🟢 | Split store into domain slices | 2 hrs |
| 🟢 | Add React error boundaries per tab | 30 min |
| 🟢 | Signal debug panel ("why no signal?") | 1 hr |
| 🟢 | Remove unused `App.css` import | 2 min |
