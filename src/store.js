import { create } from 'zustand'

export const FUTURES = [
  { symbol: 'MES1!', name: 'Micro E-mini S&P 500', base: 5400 },
  { symbol: 'MNQ1!', name: 'Micro E-mini Nasdaq',  base: 18800 },
  { symbol: 'MGC1!', name: 'Micro Gold',            base: 4702.7 },
  { symbol: 'MSL1!', name: 'Micro Silver',          base: 33.5 },
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

// Simple placeholder strategy — replace with your own logic
// Returns 'LONG', 'SHORT', or null
function runStrategy(candles) {
  if (candles.length < 5) return null
  const last = candles.slice(-5)
  const bullish = last.every(c => c.close >= c.open)
  const bearish = last.every(c => c.close <= c.open)
  if (bullish) return 'LONG'
  if (bearish) return 'SHORT'
  return null
}

const USE_LIVE = !!import.meta.env.VITE_USE_LIVE_API

export const useStore = create((set, get) => ({
  futures: FUTURES,
  selectedSymbol: 'ES',
  timeframe: '1m',
  candleData: Object.fromEntries(FUTURES.map(f => [f.symbol, generateCandles(f.base)])),
  livePrice: Object.fromEntries(FUTURES.map(f => [f.symbol, f.base])),
  priceChange: Object.fromEntries(FUTURES.map(f => [f.symbol, 0])),
  apiError: null,
  marketOpen: isMarketOpen(),
  refreshMarketStatus: () => set({ marketOpen: isMarketOpen() }),

  setSelectedSymbol: (symbol) => set({ selectedSymbol: symbol }),
  setTimeframe: (tf) => set({ timeframe: tf }),

  // --- Live API ---
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
  tradeSettings: Object.fromEntries(FUTURES.map(f => [f.symbol, {
    amount: 1000,
    stopLoss: '',
    takeProfit: '',
    side: 'LONG',
    tradeCount: 1,   // 1-5 or 'infinite'
  }])),

  updateTradeSetting: (symbol, field, value) => set(state => ({
    tradeSettings: {
      ...state.tradeSettings,
      [symbol]: { ...state.tradeSettings[symbol], [field]: value },
    }
  })),

  // --- Master switch ---
  masterSwitch: false,
  toggleMasterSwitch: () => set(state => ({ masterSwitch: !state.masterSwitch })),

  // Called by the auto-trade interval when master switch is ON
  runAutoTrade: () => {
    const state = get()
    if (!state.masterSwitch) return

    FUTURES.forEach(f => {
      const candles = state.candleData[f.symbol]
      const signal = runStrategy(candles)
      if (!signal) return

      const settings = state.tradeSettings[f.symbol]
      const count = settings.tradeCount === 'infinite' ? 1 : settings.tradeCount

      for (let i = 0; i < count; i++) {
        // Temporarily override side with strategy signal
        const price = state.livePrice[f.symbol]
        const trade = {
          id: get().nextId + i,
          symbol: f.symbol,
          side: signal,
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
    })
  },

  // --- Trades ---
  trades: [],
  nextId: 1,

  enterTrade: (symbol) => {
    const state = get()
    const price    = state.livePrice[symbol]
    const settings = state.tradeSettings[symbol]
    const count    = settings.tradeCount === 'infinite' ? 1 : settings.tradeCount

    const newTrades = []
    for (let i = 0; i < count; i++) {
      newTrades.push({
        id: state.nextId + i,
        symbol,
        side: settings.side,
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
