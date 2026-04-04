import { create } from 'zustand'

export const FUTURES = [
  { symbol: 'MES1!', name: 'Micro E-mini S&P 500', base: 5400 },
  { symbol: 'MNQ1!', name: 'Micro E-mini Nasdaq',  base: 18800 },
  { symbol: 'MGC1!', name: 'Micro Gold',            base: 4702.7 },
  { symbol: 'Sl1!',  name: 'Mini Silver',             base: 33.5 },
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

import { getLiveSignal } from './utils/strategy'

function runStrategy(candlesBySymbol, symbol) {
  const c5m = candlesBySymbol[symbol]?.['5m'] || []
  const c1m = candlesBySymbol[symbol]?.['1m'] || []
  return getLiveSignal(c5m, c1m)
}

const USE_LIVE = !!import.meta.env.VITE_USE_LIVE_API

export const useStore = create((set, get) => ({
  futures: FUTURES,
  selectedSymbol: 'MES1!',
  timeframe: '1m',
  candleData: Object.fromEntries(FUTURES.map(f => [f.symbol, generateCandles(f.base)])),
  // Multi-TF candles for strategy signals: { 'MES1!': { '1h': [...], '5m': [...], '1m': [...] } }
  mtfCandles: {},
  livePrice: Object.fromEntries(FUTURES.map(f => [f.symbol, f.base])),
  priceChange: Object.fromEntries(FUTURES.map(f => [f.symbol, 0])),
  apiError: null,
  marketOpen: isMarketOpen(),
  refreshMarketStatus: () => set({ marketOpen: isMarketOpen() }),

  setSelectedSymbol: (symbol) => set({ selectedSymbol: symbol }),
  setTimeframe: (tf) => set({ timeframe: tf }),

  // --- Live API ---
  fetchMTFCandles: async (symbol) => {
    try {
      const [res5m, res1m] = await Promise.all([
        fetch(`/api/candles?symbol=${encodeURIComponent(symbol)}&timeframe=5m`),
        fetch(`/api/candles?symbol=${encodeURIComponent(symbol)}&timeframe=1m`),
      ])
      const [data5m, data1m] = await Promise.all([res5m.json(), res1m.json()])
      if (data5m.error || data1m.error) return
      // 300 5m candles (~25 hrs) ensures prev-day H/L is available; 100 1m for entry detection
      const candles5m = (data5m.candles || []).slice(-300)
      const candles1m = (data1m.candles || []).slice(-100)
      set(state => ({
        mtfCandles: {
          ...state.mtfCandles,
          [symbol]: { '5m': candles5m, '1m': candles1m },
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
    } catch (err) {
      set({ apiError: err.message })
    }
  },

  // --- Simulated ticks (used when VITE_USE_LIVE_API not set) ---
  tickPrice: () => {
    if (USE_LIVE) return
    if (!isMarketOpen()) return
    const state = get()
    const updatedData    = { ...state.candleData }
    const updatedPrice   = { ...state.livePrice }
    const updatedChange  = { ...state.priceChange }

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
    get().checkSimSLTP()
  },

  // Auto-close open sim trades when price hits SL or TP
  checkSimSLTP: () => {
    if (USE_LIVE) return
    const state = get()
    const hasOpen = state.trades.some(
      t => t.status === 'OPEN' && (t.stopLoss != null || t.takeProfit != null)
    )
    if (!hasOpen) return

    const now = new Date().toISOString()
    set(s => ({
      trades: s.trades.map(t => {
        if (t.status !== 'OPEN') return t
        if (t.stopLoss == null && t.takeProfit == null) return t
        const price = s.livePrice[t.symbol]
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

        const multiplier = isLong ? 1 : -1
        const pnl = parseFloat(((exitPrice - t.entryPrice) / t.entryPrice * t.amount * multiplier).toFixed(2))
        return { ...t, status: 'CLOSED', exitPrice, exitTime: now, pnl }
      })
    }))
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
  // Global settings shared across all symbols
  tradeSettings: {
    amount: 1000,
    stopLoss: '',
    takeProfit: '',
    side: 'LONG',
    tradeCount: 1,
  },
  // Per-symbol ON/OFF and side
  symbolEnabled: Object.fromEntries(FUTURES.map(f => [f.symbol, true])),
  symbolSide:    Object.fromEntries(FUTURES.map(f => [f.symbol, 'LONG'])),

  updateTradeSetting: (field, value) => set(state => ({
    tradeSettings: { ...state.tradeSettings, [field]: value },
  })),

  toggleSymbol: (symbol) => set(state => ({
    symbolEnabled: { ...state.symbolEnabled, [symbol]: !state.symbolEnabled[symbol] },
  })),

  setSymbolSide: (symbol, side) => set(state => ({
    symbolSide: { ...state.symbolSide, [symbol]: side },
  })),

  // --- Master switch ---
  masterSwitch: false,
  toggleMasterSwitch: () => set(state => ({ masterSwitch: !state.masterSwitch })),

  // Tracks when the last auto trade fired per symbol (unix seconds)
  lastAutoTradeTime: {},

  // Called by the auto-trade interval when master switch is ON
  runAutoTrade: () => {
    const state = get()
    if (!state.masterSwitch) return

    const settings = state.tradeSettings
    const count = settings.tradeCount === 'infinite' ? 1 : settings.tradeCount
    const nowSec = Math.floor(Date.now() / 1000)
    const COOLDOWN = 60 // 1 minute between trades per symbol

    FUTURES.forEach(f => {
      if (!state.symbolEnabled[f.symbol]) return

      // Skip if a trade already fired for this symbol within the cooldown window
      const lastTime = state.lastAutoTradeTime[f.symbol] || 0
      if (nowSec - lastTime < COOLDOWN) return

      const signal = runStrategy(state.mtfCandles, f.symbol)
      if (!signal) return

      const price = state.livePrice[f.symbol]
      const side = state.symbolSide[f.symbol] || signal
      const startId = get().nextId
      for (let i = 0; i < count; i++) {
        const trade = {
          id: startId + i,
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
        }
        set(s => ({ trades: [trade, ...s.trades], nextId: s.nextId + 1 }))
      }
      set(s => ({
        lastAutoTradeTime: { ...s.lastAutoTradeTime, [f.symbol]: nowSec },
      }))
    })
  },

  // --- Trades ---
  trades: [],
  nextId: 1,

  enterTrade: (symbol) => {
    const state = get()
    const price    = state.livePrice[symbol]
    const settings = state.tradeSettings
    const count    = settings.tradeCount === 'infinite' ? 1 : settings.tradeCount
    const side     = state.symbolSide[symbol] || 'LONG'

    const newTrades = []
    for (let i = 0; i < count; i++) {
      newTrades.push({
        id: state.nextId + i,
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
        const exitPrice  = state.livePrice[t.symbol]
        const multiplier = t.side === 'LONG' ? 1 : -1
        const pnl = parseFloat(((exitPrice - t.entryPrice) / t.entryPrice * t.amount * multiplier).toFixed(2))
        return { ...t, status: 'CLOSED', exitPrice, exitTime: new Date().toISOString(), pnl }
      })
    })
  },
}))
