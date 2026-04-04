import { create } from 'zustand'

const FUTURES = [
  { symbol: 'ES', name: 'S&P 500 Futures', base: 5200 },
  { symbol: 'NQ', name: 'Nasdaq Futures', base: 18500 },
  { symbol: 'CL', name: 'Crude Oil Futures', base: 78.5 },
  { symbol: 'GC', name: 'Gold Futures', base: 2350 },
  { symbol: 'ZB', name: '30Y Treasury Bond', base: 118.5 },
  { symbol: 'SI', name: 'Silver Futures', base: 28.2 },
]

// Simulate candles as fallback when API key isn't set
function generateCandles(base, count = 200) {
  const candles = []
  let price = base
  const now = Math.floor(Date.now() / 1000)
  for (let i = count; i >= 0; i--) {
    const volatility = base * 0.003
    const open = price
    const change = (Math.random() - 0.5) * volatility * 2
    const high = open + Math.random() * volatility
    const low = open - Math.random() * volatility
    const close = open + change
    price = close
    candles.push({
      time: now - i * 60,
      open: parseFloat(open.toFixed(2)),
      high: parseFloat(Math.max(open, close, high).toFixed(2)),
      low: parseFloat(Math.min(open, close, low).toFixed(2)),
      close: parseFloat(close.toFixed(2)),
    })
  }
  return candles
}

const USE_LIVE_API = !!import.meta.env.VITE_USE_LIVE_API

export const useStore = create((set, get) => ({
  // Chart state
  futures: FUTURES,
  selectedSymbol: 'ES',
  candleData: Object.fromEntries(FUTURES.map(f => [f.symbol, generateCandles(f.base)])),
  livePrice: Object.fromEntries(FUTURES.map(f => [f.symbol, f.base])),
  priceChange: Object.fromEntries(FUTURES.map(f => [f.symbol, 0])),
  apiError: null,

  setSelectedSymbol: (symbol) => set({ selectedSymbol: symbol }),

  // Fetch real candle history for a symbol from /api/candles
  fetchCandles: async (symbol) => {
    if (!USE_LIVE_API) return
    try {
      const res = await fetch(`/api/candles?symbol=${symbol}`)
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

  // Poll /api/quotes for all symbols
  pollQuotes: async () => {
    if (!USE_LIVE_API) return
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
        updatedChange[f.symbol] = parseFloat((q.change ?? q.price - f.base).toFixed(2))

        // Update last candle with live price
        const candles = updatedData[f.symbol]
        if (candles?.length) {
          const last = candles[candles.length - 1]
          candles[candles.length - 1] = {
            ...last,
            close: q.price,
            high: Math.max(last.high, q.price),
            low: Math.min(last.low, q.price),
          }
        }
      })

      set({ livePrice: updatedPrice, priceChange: updatedChange, candleData: updatedData, apiError: null })
    } catch (err) {
      set({ apiError: err.message })
    }
  },

  // Simulated tick (used when VITE_USE_LIVE_API is not set)
  tickPrice: () => {
    if (USE_LIVE_API) return
    const state = get()
    const updatedData = { ...state.candleData }
    const updatedPrice = { ...state.livePrice }
    const updatedChange = { ...state.priceChange }

    FUTURES.forEach(f => {
      const candles = updatedData[f.symbol]
      const last = candles[candles.length - 1]
      const volatility = f.base * 0.0008
      const newClose = parseFloat((last.close + (Math.random() - 0.5) * volatility * 2).toFixed(2))
      const newHigh = parseFloat(Math.max(last.high, newClose).toFixed(2))
      const newLow = parseFloat(Math.min(last.low, newClose).toFixed(2))
      candles[candles.length - 1] = { ...last, close: newClose, high: newHigh, low: newLow }
      updatedPrice[f.symbol] = newClose
      updatedChange[f.symbol] = parseFloat((newClose - f.base).toFixed(2))
    })

    set({ candleData: updatedData, livePrice: updatedPrice, priceChange: updatedChange })
  },

  advanceCandle: () => {
    if (USE_LIVE_API) return
    const state = get()
    const updatedData = { ...state.candleData }
    const now = Math.floor(Date.now() / 1000)

    FUTURES.forEach(f => {
      const candles = updatedData[f.symbol]
      const last = candles[candles.length - 1]
      const volatility = f.base * 0.003
      const open = last.close
      const close = parseFloat((open + (Math.random() - 0.5) * volatility * 2).toFixed(2))
      candles.push({
        time: now,
        open,
        high: parseFloat(Math.max(open, close) + Math.random() * volatility * 0.5).toFixed(2),
        low: parseFloat(Math.min(open, close) - Math.random() * volatility * 0.5).toFixed(2),
        close,
      })
      if (candles.length > 500) candles.shift()
    })

    set({ candleData: updatedData })
  },

  // Trade settings per symbol
  tradeSettings: Object.fromEntries(FUTURES.map(f => [f.symbol, {
    amount: 1000,
    stopLoss: '',
    takeProfit: '',
    side: 'LONG',
  }])),

  updateTradeSetting: (symbol, field, value) => set(state => ({
    tradeSettings: {
      ...state.tradeSettings,
      [symbol]: { ...state.tradeSettings[symbol], [field]: value }
    }
  })),

  // Trade logs
  trades: [],
  nextId: 1,

  enterTrade: (symbol) => {
    const state = get()
    const price = state.livePrice[symbol]
    const settings = state.tradeSettings[symbol]
    const trade = {
      id: state.nextId,
      symbol,
      side: settings.side,
      entryPrice: price,
      amount: parseFloat(settings.amount) || 0,
      stopLoss: settings.stopLoss ? parseFloat(settings.stopLoss) : null,
      takeProfit: settings.takeProfit ? parseFloat(settings.takeProfit) : null,
      entryTime: new Date().toISOString(),
      status: 'OPEN',
      exitPrice: null,
      exitTime: null,
      pnl: null,
    }
    set(state => ({ trades: [trade, ...state.trades], nextId: state.nextId + 1 }))
  },

  closeTrade: (id) => {
    const state = get()
    set({
      trades: state.trades.map(t => {
        if (t.id !== id || t.status !== 'OPEN') return t
        const exitPrice = state.livePrice[t.symbol]
        const multiplier = t.side === 'LONG' ? 1 : -1
        const pnl = parseFloat(((exitPrice - t.entryPrice) / t.entryPrice * t.amount * multiplier).toFixed(2))
        return { ...t, status: 'CLOSED', exitPrice, exitTime: new Date().toISOString(), pnl }
      })
    })
  },
}))
