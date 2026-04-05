import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const FUTURES = [
  { symbol: 'MES1!', name: 'Micro E-mini S&P 500', base: 5400 },
  { symbol: 'MNQ1!', name: 'Micro E-mini Nasdaq',  base: 18800 },
  { symbol: 'MGC1!', name: 'Micro Gold',            base: 4702.7 },
]

export const TIMEFRAMES = ['1m', '5m', '15m', '1h', '1d']

// Futures: 24/7 weekdays, closes Friday 16:00 ET, reopens Sunday 18:00 ET
export function isMarketOpen() {
  const now = new Date()
  const etOffset = isDST(now) ? -4 : -5
  const et = new Date(now.getTime() + etOffset * 60 * 60 * 1000)
  const day  = et.getUTCDay()
  const hour = et.getUTCHours()
  const min  = et.getUTCMinutes()
  const timeInMins = hour * 60 + min

  if (day === 6) return false                              // Saturday: always closed
  if (day === 5 && timeInMins >= 16 * 60) return false    // Friday at/after 16:00: closed
  if (day === 0 && timeInMins < 18 * 60) return false     // Sunday before 18:00: closed
  return true
}

function isDST(date) {
  const jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset()
  const jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset()
  return Math.min(jan, jul) === date.getTimezoneOffset()
}

function generateCandles(base, count = 200) {
  const candles = []
  let price = base
  const now = Math.floor(Date.now() / 1000)
  for (let i = count; i >= 0; i--) {
    const v = base * 0.003
    const open = price
    const change = (Math.random() - 0.5) * v * 2
    const high = open + Math.random() * v
    const low = open - Math.random() * v
    const close = open + change
    price = close
    candles.push({
      time: now - i * 60,
      open:  parseFloat(open.toFixed(2)),
      high:  parseFloat(Math.max(open, close, high).toFixed(2)),
      low:   parseFloat(Math.min(open, close, low).toFixed(2)),
      close: parseFloat(close.toFixed(2)),
    })
  }
  return candles
}

import { getLiveSignal, calcFuturesPnl } from './utils/strategy'

function runStrategy(candlesBySymbol, symbol) {
  const c5m = candlesBySymbol[symbol]?.['5m'] || []
  const c1m = candlesBySymbol[symbol]?.['1m'] || []
  return getLiveSignal(c5m, c1m, symbol)
}

// Re-export for components
export { calcFuturesPnl }

const USE_LIVE = !!import.meta.env.VITE_USE_LIVE_API

// Shared SL/TP auto-close logic — works in both sim and live mode
function checkSLTP(state) {
  const hasOpen = state.trades.some(
    t => t.status === 'OPEN' && (t.stopLoss != null || t.takeProfit != null)
  )
  if (!hasOpen) return null

  const now = new Date().toISOString()
  const updated = state.trades.map(t => {
    if (t.status !== 'OPEN') return t
    if (t.stopLoss == null && t.takeProfit == null) return t
    const price = state.livePrice[t.symbol]
    if (price == null) return t

    const isLong = t.side === 'LONG'
    let exitPrice = null

    if (isLong) {
      if (t.stopLoss   != null && price <= t.stopLoss)   exitPrice = t.stopLoss
      else if (t.takeProfit != null && price >= t.takeProfit) exitPrice = t.takeProfit
    } else {
      if (t.stopLoss   != null && price >= t.stopLoss)   exitPrice = t.stopLoss
      else if (t.takeProfit != null && price <= t.takeProfit) exitPrice = t.takeProfit
    }

    if (exitPrice == null) return t

    const pnl = calcFuturesPnl(t.entryPrice, exitPrice, t.symbol, t.side)
    return { ...t, status: 'CLOSED', exitPrice, exitTime: now, pnl }
  })

  // Only return if something changed
  return updated.some((t, i) => t !== state.trades[i]) ? updated : null
}

export const useStore = create(
  persist(
    (set, get) => ({
      futures: FUTURES,
      selectedSymbol: 'MES1!',
      timeframe: '1m',
      candleData: Object.fromEntries(FUTURES.map(f => [f.symbol, generateCandles(f.base)])),
      // Multi-TF candles for strategy signals: { 'MES1!': { '5m': [...], '1m': [...] } }
      mtfCandles: {},
      livePrice: Object.fromEntries(FUTURES.map(f => [f.symbol, f.base])),
      priceChange: Object.fromEntries(FUTURES.map(f => [f.symbol, 0])),
      apiError: null,
      marketOpen: isMarketOpen(),
      refreshMarketStatus: () => set({ marketOpen: isMarketOpen() }),

      setSelectedSymbol: (symbol) => set({ selectedSymbol: symbol }),
      setTimeframe: (tf) => set({ timeframe: tf }),

      // --- Live API ---
      // Fetch multi-timeframe candles using the lightweight /api/candles endpoint
      fetchMTFCandles: async (symbol) => {
        if (!USE_LIVE) return   // no-op in sim mode
        try {
          const [r5m, r1m] = await Promise.all([
            fetch(`/api/candles?symbol=${encodeURIComponent(symbol)}&timeframe=5m`),
            fetch(`/api/candles?symbol=${encodeURIComponent(symbol)}&timeframe=1m`),
          ])
          const [d5m, d1m] = await Promise.all([r5m.json(), r1m.json()])
          if (!d5m.candles?.length) return
          set(state => ({
            mtfCandles: {
              ...state.mtfCandles,
              [symbol]: { '5m': d5m.candles, '1m': (d1m.candles || []) },
            }
          }))
        } catch (_) {}
      },

      fetchCandles: async (symbol, timeframe) => {
        if (!USE_LIVE) return
        try {
          const tf = timeframe || get().timeframe
          const res = await fetch(`/api/candles?symbol=${symbol}&timeframe=${tf}`)
          const data = await res.json()
          if (data.candles?.length) {
            set(state => ({
              candleData: { ...state.candleData, [symbol]: data.candles },
              apiError: null,
            }))
          }
        } catch (err) {
          set({ apiError: err.message })
        }
      },

      pollQuotes: async (forceUpdate = false) => {
        if (!USE_LIVE) return
        set({ marketOpen: isMarketOpen() })
        // Always fetch on forceUpdate (initial load), skip interval polls when closed
        if (!forceUpdate && !isMarketOpen()) return
        try {
          const res = await fetch('/api/quotes')
          const quotes = await res.json()
          if (quotes.error) { set({ apiError: quotes.error }); return }

          const state = get()
          const updatedPrice = { ...state.livePrice }
          const updatedChange = { ...state.priceChange }
          const updatedData = { ...state.candleData }

          FUTURES.forEach(f => {
            const q = quotes[f.symbol]
            if (!q?.price) return
            updatedPrice[f.symbol] = q.price
            updatedChange[f.symbol] = parseFloat((q.change ?? 0).toFixed(2))
            const candles = updatedData[f.symbol]
            if (candles?.length) {
              const last = candles[candles.length - 1]
              candles[candles.length - 1] = {
                ...last,
                close: q.price,
                high: Math.max(last.high, q.price),
                low:  Math.min(last.low,  q.price),
              }
            }
          })

          set({ livePrice: updatedPrice, priceChange: updatedChange, candleData: updatedData, apiError: null })

          // Check SL/TP on live price updates
          const updatedState = get()
          const closedTrades = checkSLTP(updatedState)
          if (closedTrades) set({ trades: closedTrades })
        } catch (err) {
          set({ apiError: err.message })
        }
      },

      // --- Simulated ticks (used when VITE_USE_LIVE_API not set) ---
      tickPrice: () => {
        if (USE_LIVE) return
        if (!isMarketOpen()) return
        const state = get()
        const updatedData   = { ...state.candleData }
        const updatedPrice  = { ...state.livePrice }
        const updatedChange = { ...state.priceChange }

        FUTURES.forEach(f => {
          const candles = updatedData[f.symbol]
          const last = candles[candles.length - 1]
          const v = f.base * 0.0008
          const newClose = parseFloat((last.close + (Math.random() - 0.5) * v * 2).toFixed(2))
          candles[candles.length - 1] = {
            ...last,
            close: newClose,
            high: parseFloat(Math.max(last.high, newClose).toFixed(2)),
            low:  parseFloat(Math.min(last.low,  newClose).toFixed(2)),
          }
          updatedPrice[f.symbol]  = newClose
          updatedChange[f.symbol] = parseFloat((newClose - f.base).toFixed(2))
        })

        set({ candleData: updatedData, livePrice: updatedPrice, priceChange: updatedChange })

        // Check SL/TP on sim price updates
        const updatedState = get()
        const closedTrades = checkSLTP(updatedState)
        if (closedTrades) set({ trades: closedTrades })
      },

      advanceCandle: () => {
        if (USE_LIVE) return
        if (!isMarketOpen()) return
        const state = get()
        const updatedData = { ...state.candleData }
        const now = Math.floor(Date.now() / 1000)

        FUTURES.forEach(f => {
          const candles = updatedData[f.symbol]
          const last = candles[candles.length - 1]
          const v = f.base * 0.003
          const open  = last.close
          const close = parseFloat((open + (Math.random() - 0.5) * v * 2).toFixed(2))
          candles.push({
            time:  now,
            open,
            high:  parseFloat((Math.max(open, close) + Math.random() * v * 0.5).toFixed(2)),
            low:   parseFloat((Math.min(open, close) - Math.random() * v * 0.5).toFixed(2)),
            close,
          })
          if (candles.length > 500) candles.shift()
        })

        set({ candleData: updatedData })
      },

      // --- Trade settings ---
      tradeSettings: {
        amount: 1000,
        stopLoss: '',
        takeProfit: '',
        side: 'LONG',
        tradeCount: 1,
      },
      symbolEnabled: Object.fromEntries(FUTURES.map(f => [f.symbol, true])),
      symbolSide:    Object.fromEntries(FUTURES.map(f => [f.symbol, 'LONG'])),
      // Per-symbol paper trading config (units + amount)
      paperSymbolConfig: Object.fromEntries(FUTURES.map(f => [f.symbol, { units: 1, amount: 1000 }])),

      updateTradeSetting: (field, value) => set(state => ({
        tradeSettings: { ...state.tradeSettings, [field]: value },
      })),

      toggleSymbol: (symbol) => set(state => ({
        symbolEnabled: { ...state.symbolEnabled, [symbol]: !state.symbolEnabled[symbol] },
      })),

      setSymbolSide: (symbol, side) => set(state => ({
        symbolSide: { ...state.symbolSide, [symbol]: side },
      })),

      updatePaperSymbolConfig: (symbol, field, value) => set(state => ({
        paperSymbolConfig: {
          ...state.paperSymbolConfig,
          [symbol]: { ...state.paperSymbolConfig[symbol], [field]: value },
        },
      })),

      // --- Master switch (live) ---
      masterSwitch: false,
      toggleMasterSwitch: () => set(state => ({ masterSwitch: !state.masterSwitch })),

      // --- Paper switch ---
      paperSwitch: false,
      togglePaperSwitch: () => set(state => ({ paperSwitch: !state.paperSwitch })),
      paperTrades: [],
      paperNextId: 1,
      lastPaperAutoTradeTime: {},
      lastPaperFiredBosTime: {},

      // Tracks when the last auto trade fired per symbol (unix seconds)
      lastAutoTradeTime: {},
      // Tracks last fired BOS time per symbol for signal deduplication
      lastFiredBosTime: {},

      // Called by the auto-trade interval when master switch is ON
      runAutoTrade: () => {
        const state = get()
        if (!state.masterSwitch) return

        const settings = state.tradeSettings
        const count = settings.tradeCount === 'infinite' ? 1 : parseInt(settings.tradeCount, 10) || 1
        const nowSec = Math.floor(Date.now() / 1000)
        const COOLDOWN = 60 // 1 minute between trades per symbol

        let nextId = get().nextId
        const newTrades = []
        const lastAutoUpdate = {}
        const bosTimeUpdate = {}

        FUTURES.forEach(f => {
          if (!state.symbolEnabled[f.symbol]) return

          const lastTime = state.lastAutoTradeTime[f.symbol] || 0
          if (nowSec - lastTime < COOLDOWN) return

          const result = runStrategy(state.mtfCandles, f.symbol)
          if (!result) return

          // Signal deduplication: skip if this is the same BOS setup we already traded
          if (state.lastFiredBosTime[f.symbol] === result.bosTime) return

          const price = state.livePrice[f.symbol]
          // Use strategy direction, not symbolSide (fixes counter-signal bug)
          const side = result.direction

          for (let i = 0; i < count; i++) {
            newTrades.push({
              id: nextId++,
              symbol: f.symbol,
              side,
              entryPrice: price,
              amount: parseFloat(settings.amount) || 0,
              stopLoss:   settings.stopLoss   ? parseFloat(settings.stopLoss)   : null,
              takeProfit: settings.takeProfit ? parseFloat(settings.takeProfit) : null,
              entryTime: new Date().toISOString(),
              status: 'OPEN',
              exitPrice: null,
              exitTime: null,
              pnl: null,
              auto: true,
              signal: result.signal,
            })
          }
          lastAutoUpdate[f.symbol] = nowSec
          bosTimeUpdate[f.symbol] = result.bosTime
        })

        if (newTrades.length) {
          set(s => ({
            trades: [...newTrades, ...s.trades],
            nextId,
            lastAutoTradeTime: { ...s.lastAutoTradeTime, ...lastAutoUpdate },
            lastFiredBosTime: { ...s.lastFiredBosTime, ...bosTimeUpdate },
          }))
        }
      },

      // Called by the auto-trade interval when paper switch is ON
      runPaperAutoTrade: () => {
        const state = get()
        if (!state.paperSwitch) return

        const settings = state.tradeSettings
        const units = settings.paperUnits || 1
        const nowSec = Math.floor(Date.now() / 1000)
        const COOLDOWN = 60

        let nextId = state.paperNextId
        const newTrades = []
        const lastAutoUpdate = {}
        const bosTimeUpdate = {}

        FUTURES.forEach(f => {
          if (!state.symbolEnabled[f.symbol]) return

          const lastTime = state.lastPaperAutoTradeTime[f.symbol] || 0
          if (nowSec - lastTime < COOLDOWN) return

          const result = runStrategy(state.mtfCandles, f.symbol)
          if (!result) return

          if (state.lastPaperFiredBosTime[f.symbol] === result.bosTime) return

          const price = state.livePrice[f.symbol]
          const side = result.direction

          newTrades.push({
            id: nextId++,
            symbol: f.symbol,
            side,
            entryPrice: price,
            units,
            entryTime: new Date().toISOString(),
            status: 'OPEN',
            exitPrice: null,
            exitTime: null,
            pnl: null,
            auto: true,
            signal: result.signal,
            paper: true,
          })
          lastAutoUpdate[f.symbol] = nowSec
          bosTimeUpdate[f.symbol] = result.bosTime
        })

        if (newTrades.length) {
          set(s => ({
            paperTrades: [...newTrades, ...s.paperTrades],
            paperNextId: nextId,
            lastPaperAutoTradeTime: { ...s.lastPaperAutoTradeTime, ...lastAutoUpdate },
            lastPaperFiredBosTime: { ...s.lastPaperFiredBosTime, ...bosTimeUpdate },
          }))
        }
      },

      closePaperTrade: (id) => {
        const state = get()
        set({
          paperTrades: state.paperTrades.map(t => {
            if (t.id !== id || t.status !== 'OPEN') return t
            const exitPrice = state.livePrice[t.symbol]
            const pnl = calcFuturesPnl(t.entryPrice, exitPrice, t.symbol, t.side)
            return { ...t, status: 'CLOSED', exitPrice, exitTime: new Date().toISOString(), pnl: pnl * (t.units || 1) }
          })
        })
      },

      // --- Trades ---
      trades: [],
      nextId: 1,

      enterTrade: (symbol) => {
        const state = get()
        const price    = state.livePrice[symbol]
        const settings = state.tradeSettings
        const count    = settings.tradeCount === 'infinite' ? 1 : parseInt(settings.tradeCount, 10) || 1
        const side     = state.symbolSide[symbol] || 'LONG'
        const startId  = state.nextId

        const newTrades = []
        for (let i = 0; i < count; i++) {
          newTrades.push({
            id: startId + i,
            symbol,
            side,
            entryPrice: price,
            amount: parseFloat(settings.amount) || 0,
            stopLoss:   settings.stopLoss   ? parseFloat(settings.stopLoss)   : null,
            takeProfit: settings.takeProfit ? parseFloat(settings.takeProfit) : null,
            entryTime: new Date().toISOString(),
            status: 'OPEN',
            exitPrice: null,
            exitTime: null,
            pnl: null,
            auto: false,
          })
        }
        set(s => ({ trades: [...newTrades, ...s.trades], nextId: s.nextId + count }))
      },

      closeTrade: (id) => {
        const state = get()
        set({
          trades: state.trades.map(t => {
            if (t.id !== id || t.status !== 'OPEN') return t
            const exitPrice = state.livePrice[t.symbol]
            const pnl = calcFuturesPnl(t.entryPrice, exitPrice, t.symbol, t.side)
            return { ...t, status: 'CLOSED', exitPrice, exitTime: new Date().toISOString(), pnl }
          })
        })
      },
    }),
    {
      name: 'tradedash-v1',
      partialize: (state) => ({
        trades: state.trades,
        nextId: state.nextId,
        tradeSettings: state.tradeSettings,
        symbolEnabled: state.symbolEnabled,
        symbolSide: state.symbolSide,
        paperSymbolConfig: state.paperSymbolConfig,
        paperTrades: state.paperTrades,
        paperNextId: state.paperNextId,
        paperSwitch: state.paperSwitch,
      }),
    }
  )
)