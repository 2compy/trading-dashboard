// ─────────────────────────────────────────────────────────────────────────────
// Backtest Engine
//   MGC1!  → HTF Bias + 4h/1h clean FVG check + 5m FVG + 5m BOS confirm
//   Others → Daily H/L Sweep + BOS (after sweep) + 5m entry
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)

const SYMBOL_MAP = {
  'MES1!': 'MES=F',
  'MNQ1!': 'MNQ=F',
  'MGC1!': 'MGC=F',
}

// Map symbols to CSV filenames in the data/ folder
const CSV_FILES = {
  'MES1!': 'MES1_5m.csv',
  'MNQ1!': 'MNQ1_5m.csv',
  'MGC1!': 'MGC1_5m.csv',
}

const CONTRACT_MULTIPLIER = { 'MES1!': 5, 'MNQ1!': 2, 'MGC1!': 10 }
// Units (contracts) per trade per symbol
const UNITS = { 'MES1!': 2, 'MNQ1!': 2, 'MGC1!': 2 }
const MIN_RR = 2

// ── CSV Import (TradingView data) ────────────────────────────────────────────
function loadCSVCandles(symbol) {
  const csvFile = CSV_FILES[symbol]
  if (!csvFile) return []

  // Try multiple possible paths (local dev vs Vercel deployment)
  const possiblePaths = [
    join(__dirname, '..', 'data', csvFile),
    join(process.cwd(), 'data', csvFile),
  ]

  for (const csvPath of possiblePaths) {
    if (!existsSync(csvPath)) continue
    try {
      const raw = readFileSync(csvPath, 'utf-8')
      const lines = raw.trim().split('\n')
      const candles = []
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',')
        if (parts.length < 5) continue
        const time  = parseInt(parts[0], 10)
        const open  = parseFloat(parts[1])
        const high  = parseFloat(parts[2])
        const low   = parseFloat(parts[3])
        const close = parseFloat(parts[4])
        if (isNaN(time) || isNaN(close)) continue
        candles.push({ time, open, high, low, close })
      }
      console.log(`[CSV] Loaded ${candles.length} candles for ${symbol} from ${csvPath}`)
      return candles
    } catch (e) {
      console.warn(`[CSV] Failed to read ${csvPath}:`, e.message)
    }
  }
  return []
}

// Merge CSV historical data with Yahoo Finance recent data (deduped, sorted)
function mergeCandles(csvCandles, yahooCandles) {
  const merged = [...csvCandles, ...yahooCandles]
  const seen = new Set()
  return merged
    .filter(c => { if (seen.has(c.time)) return false; seen.add(c.time); return true })
    .sort((a, b) => a.time - b.time)
}

// Generate synthetic 1m candles from 5m candles (for Strategy D when real 1m unavailable)
function synthesize1mFrom5m(candles5m) {
  const result = []
  for (const c of candles5m) {
    // Split each 5m candle into 5 synthetic 1m candles
    // Distribute the price movement across 5 intervals
    const range = c.high - c.low
    const isUp = c.close >= c.open
    for (let j = 0; j < 5; j++) {
      const t = c.time + j * 60
      let o, h, l, cl
      if (j === 0) {
        o = c.open; h = isUp ? c.open + range * 0.3 : c.open; l = isUp ? c.open : c.open - range * 0.3; cl = isUp ? o + range * 0.2 : o - range * 0.2
      } else if (j === 4) {
        o = result.length ? result[result.length - 1].close : c.open; cl = c.close; h = Math.max(o, cl, isUp ? c.high : cl); l = Math.min(o, cl, isUp ? cl : c.low)
      } else {
        const frac = j / 4
        o = result.length ? result[result.length - 1].close : c.open
        cl = isUp ? c.open + (c.close - c.open) * frac : c.open + (c.close - c.open) * frac
        h = Math.max(o, cl) + range * 0.05; l = Math.min(o, cl) - range * 0.05
      }
      // Clamp to parent candle bounds
      h = Math.min(h, c.high); l = Math.max(l, c.low)
      result.push({ time: t, open: parseFloat(o.toFixed(4)), high: parseFloat(h.toFixed(4)), low: parseFloat(l.toFixed(4)), close: parseFloat(cl.toFixed(4)) })
    }
  }
  return result
}

// ── Data fetching ─────────────────────────────────────────────────────────────
async function fetch5mChunked(ticker) {
  const now      = Math.floor(Date.now() / 1000)
  const chunkSec = 60 * 24 * 60 * 60
  const requests = Array.from({ length: 3 }, (_, i) => {
    const period2 = now - i * chunkSec
    const period1 = period2 - chunkSec
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=5m&period1=${period1}&period2=${period2}&includePrePost=false`
    return fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      .then(r => r.json()).then(d => parseCandles(d)).catch(() => [])
  })
  const results = await Promise.all(requests)
  const seen = new Set()
  return results.flat()
    .filter(c => { if (seen.has(c.time)) return false; seen.add(c.time); return true })
    .sort((a, b) => a.time - b.time)
}

async function fetch1mRecent(ticker) {
  const now     = Math.floor(Date.now() / 1000)
  const period1 = now - 7 * 24 * 60 * 60
  const url     = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1m&period1=${period1}&period2=${now}&includePrePost=false`
  try {
    const res  = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    const data = await res.json()
    return parseCandles(data)
  } catch { return [] }
}

function parseCandles(data) {
  const result = data?.chart?.result?.[0]
  if (!result) return []
  const timestamps = result.timestamp || []
  const q = result.indicators?.quote?.[0] || {}
  const candles = []
  for (let i = 0; i < timestamps.length; i++) {
    if (q.close[i] == null) continue
    candles.push({
      time:  timestamps[i],
      open:  parseFloat((q.open[i]  ?? q.close[i]).toFixed(4)),
      high:  parseFloat((q.high[i]  ?? q.close[i]).toFixed(4)),
      low:   parseFloat((q.low[i]   ?? q.close[i]).toFixed(4)),
      close: parseFloat(q.close[i].toFixed(4)),
    })
  }
  return candles
}

// ── Time helpers (cached formatters + memoized results) ──────────────────────
const _dateFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit',
})
const _timeFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric', minute: 'numeric', hour12: false,
})
const _dateCache = new Map()
const _minsCache = new Map()

function getETDateStr(ts) {
  // Round to 5-min boundary for cache efficiency (same day)
  const key = Math.floor(ts / 300) * 300
  let v = _dateCache.get(key)
  if (v !== undefined) return v
  v = _dateFmt.format(new Date(ts * 1000))
  _dateCache.set(key, v)
  return v
}

function getETMinutes(ts) {
  const key = Math.floor(ts / 60) * 60
  let v = _minsCache.get(key)
  if (v !== undefined) return v
  const parts = _timeFmt.formatToParts(new Date(ts * 1000))
  const h = parseInt(parts.find(p => p.type === 'hour').value)
  const m = parseInt(parts.find(p => p.type === 'minute').value)
  v = h * 60 + m
  _minsCache.set(key, v)
  return v
}

// Kill zones: Asia (8pm-midnight ET), London (3-5am ET), NY open (8:30am-12pm ET), NY PM (1:30-3pm ET)
function isKillZone(ts) {
  const mins = getETMinutes(ts)
  return (mins >= 1200) ||                // Asia: 8:00 PM – midnight ET
         (mins >= 180 && mins < 300) ||   // London: 3:00–5:00 AM ET
         (mins >= 510 && mins < 720) ||   // NY open: 8:30 AM–12:00 PM ET
         (mins >= 810 && mins < 900)      // NY PM: 1:30–3:00 PM ET
}

// MGC kill zones: Asia open (8pm-midnight ET), NY open (8am-noon ET)
function isMGCKillZone(ts) {
  const mins = getETMinutes(ts)
  return (mins >= 1200) ||             // Asia: 8:00 PM – midnight ET
         (mins >= 480 && mins < 720)   // NY:   8:00 AM – noon ET
}

// ── Strategy primitives ───────────────────────────────────────────────────────
function buildDailyHL(candles5m) {
  const byDay = {}
  for (const c of candles5m) {
    const d = getETDateStr(c.time)
    if (!byDay[d]) byDay[d] = { high: c.high, low: c.low }
    else {
      if (c.high > byDay[d].high) byDay[d].high = c.high
      if (c.low  < byDay[d].low)  byDay[d].low  = c.low
    }
  }
  return byDay
}

function getPrevDayHL(dailyHL, currentTs) {
  const today = getETDateStr(currentTs)
  const days  = Object.keys(dailyHL).sort()
  const idx   = days.indexOf(today)
  if (idx <= 0) return null
  return { ...dailyHL[days[idx - 1]], date: days[idx - 1] }
}

// Aggregate 5m candles into a higher timeframe (minutesPerBar = 60 for 1h, 240 for 4h)
function buildHTFCandles(candles5m, minutesPerBar) {
  const barSecs = minutesPerBar * 60
  const bars = {}
  for (const c of candles5m) {
    const t = Math.floor(c.time / barSecs) * barSecs
    if (!bars[t]) bars[t] = { time: t, open: c.open, high: c.high, low: c.low, close: c.close }
    else {
      bars[t].high  = Math.max(bars[t].high,  c.high)
      bars[t].low   = Math.min(bars[t].low,   c.low)
      bars[t].close = c.close
    }
  }
  return Object.values(bars).sort((a, b) => a.time - b.time)
}

function detectSwings(candles, lookback = 3) {
  const highs = [], lows = []
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c    = candles[i]
    const prev = candles.slice(i - lookback, i)
    const next = candles.slice(i + 1, i + lookback + 1)
    if (prev.every(x => x.high <= c.high) && next.every(x => x.high <= c.high))
      highs.push({ price: c.high, time: c.time })
    if (prev.every(x => x.low >= c.low) && next.every(x => x.low >= c.low))
      lows.push({ price: c.low, time: c.time })
  }
  return { highs, lows }
}

function detectFVGs(candles) {
  const fvgs = []
  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1], next = candles[i + 1]
    if (next.low > prev.high)
      fvgs.push({ type: 'bullish', top: next.low, bottom: prev.high, mid: (next.low + prev.high) / 2, time: candles[i].time })
    if (next.high < prev.low)
      fvgs.push({ type: 'bearish', top: prev.low, bottom: next.high, mid: (prev.low + next.high) / 2, time: candles[i].time })
  }
  return fvgs
}

function detectBOS(candles, highs, lows) {
  const bos = []
  let lastHigh = null, lastLow = null, hPtr = 0, lPtr = 0
  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i], prev = candles[i - 1]
    while (hPtr < highs.length && highs[hPtr].time < curr.time) { lastHigh = highs[hPtr]; hPtr++ }
    while (lPtr < lows.length  && lows[lPtr].time  < curr.time) { lastLow  = lows[lPtr];  lPtr++ }
    if (lastHigh && prev.close <= lastHigh.price && curr.close > lastHigh.price)
      bos.push({ type: 'bullish', price: lastHigh.price, time: curr.time })
    if (lastLow  && prev.close >= lastLow.price  && curr.close < lastLow.price)
      bos.push({ type: 'bearish', price: lastLow.price,  time: curr.time })
  }
  return bos
}

// ── Pre-build session H/L index (avoids O(n²) in main loop) ─────────────────
// Returns a Map: dayString → sorted array of {time, runningHigh, runningLow}
function buildSessionHLIndex(candles5m) {
  const byDay = {}
  for (const c of candles5m) {
    const d = getETDateStr(c.time)
    if (!byDay[d]) byDay[d] = []
    byDay[d].push(c)
  }
  const index = {}
  for (const [day, candles] of Object.entries(byDay)) {
    let high = -Infinity, low = Infinity
    const running = []
    for (const c of candles) {
      if (c.high > high) high = c.high
      if (c.low  < low)  low  = c.low
      running.push({ time: c.time, high, low })
    }
    index[day] = running
  }
  return index
}

// Look up session H/L from pre-built index (O(1) per call)
function getSessionHLFromIndex(sessionIndex, nowTs) {
  const todayStr = getETDateStr(nowTs)
  const dayData = sessionIndex[todayStr]
  if (!dayData || dayData.length <= 5) return null
  // Use H/L up to 3 candles before current to avoid self-reference
  const idx = dayData.length - 4  // exclude last 3
  if (idx < 0) return null
  return { high: dayData[idx].high, low: dayData[idx].low }
}

// Returns true if any open FVG on these candles overlaps the path from price → target
function hasFVGBlocking(candles, fromPrice, toPrice) {
  const lo = Math.min(fromPrice, toPrice)
  const hi = Math.max(fromPrice, toPrice)
  return detectFVGs(candles).some(f => f.bottom < hi && f.top > lo)
}

function findIFVGEntry(candles, fvg, bias) {
  let retraced = false
  for (const c of candles) {
    if (c.time <= fvg.time) continue
    if (bias === 'bullish') {
      if (!retraced && c.close < fvg.top)    retraced = true
      if (retraced  && c.close > fvg.top)    return c
    } else {
      if (!retraced && c.close > fvg.bottom) retraced = true
      if (retraced  && c.close < fvg.bottom) return c
    }
  }
  return null
}

// ── Fixed SL per symbol (null = use sweep wick) ─────────────────────────────
const FIXED_SL = { 'MES1!': null, 'MNQ1!': 20, 'MGC1!': 20 }
// ── Fixed TP distance per symbol (null = use R:R calculation) ───────────────
const FIXED_TP = { 'MES1!': null, 'MNQ1!': null, 'MGC1!': 40 }      // MGC: 40pt TP / 20pt SL = 2:1 R:R
const LONG_FIXED_TP = { 'MES1!': null, 'MNQ1!': null, 'MGC1!': 40 }
// ── Min R:R per symbol — 2:1 target
const SYMBOL_RR = { 'MES1!': 2, 'MNQ1!': 2, 'MGC1!': 2 }
// ── Min FVG width for IFVG detection, per symbol ────────────────────────────
// MGC ~3100 → 3pt, MES ~5500 → 7pt, MNQ ~19000 → 20pt, Silver ~32 → 0.10
const MIN_FVG_WIDTH = {
  'MES1!': 5,
  'MNQ1!': 16,
  'MGC1!': 4,
}
const DEFAULT_FVG_WIDTH = 5
// ── SL distance bounds per symbol ───────────────────────────────────────────
const SL_BOUNDS = {
  'MES1!': { min: 3, max: 30 },
  'MNQ1!': { min: 5, max: 50 },
  'MGC1!': { min: 2, max: 20 },
}
const DEFAULT_SL_BOUNDS = { min: 3, max: 30 }

// ── LONG-specific overrides ──────────────────────────────────────────────────
// Much tighter TP (1.2:1 RR) so longs actually reach target
const LONG_MAX_LOSS = 300  // max $300 loss per trade
// Min payout $300 = 1:1 RR with $300 SL. Trailing stop lets winners run to $1500+
const LONG_SYMBOL_RR = { 'MES1!': 2, 'MNQ1!': 2, 'MGC1!': 2 }
// Fixed SL in points = $300 / (multiplier × contracts)
const LONG_FIXED_SL  = { 'MES1!': 18, 'MNQ1!': 45, 'MGC1!': 20 }
const LONG_SL_BOUNDS = {
  'MES1!': { min: 3, max: 18 },
  'MNQ1!': { min: 5, max: 45 },
  'MGC1!': { min: 2, max: 10 },
}
// ATR-like volatility measure for dynamic SL sizing
function getAvgRange(candles, len = 14) {
  const slice = candles.slice(-len)
  if (!slice.length) return 10
  return slice.reduce((s, c) => s + (c.high - c.low), 0) / slice.length
}
// Cap SL distance so max loss never exceeds $300
function capLongSL(entryPrice, rawSLPrice, symbol) {
  const maxSLDist = LONG_FIXED_SL[symbol] || 20
  const rawDist = entryPrice - rawSLPrice
  if (rawDist > maxSLDist) return entryPrice - maxSLDist
  return rawSLPrice
}
// Kill zone for longs: NY session only (8:30am–12pm ET) — highest probability for bullish reversals
function isLongKillZone(ts) {
  const mins = getETMinutes(ts)
  return (mins >= 450 && mins < 780)   // Extended: 7:30 AM–1:00 PM ET
}
// MGC longs also get Asia session (8pm–midnight) + NY (8am–noon)
function isMGCLongKillZone(ts) {
  const mins = getETMinutes(ts)
  return (mins >= 1140) ||             // Asia: 7:00 PM – midnight ET
         (mins >= 420 && mins < 780)   // NY:   7:00 AM – 1:00 PM ET
}

const MAX_TRADE_DURATION = 43200  // 12 hours in seconds — enough time for trades to reach TP

// ── EMA trend filter ────────────────────────────────────────────────────────
const EMA_PERIOD = 50    // 50-period EMA on 5m candles for trend direction
function computeEMA(candles, period = EMA_PERIOD) {
  if (candles.length < period) return null
  const k = 2 / (period + 1)
  let ema = candles.slice(0, period).reduce((s, c) => s + c.close, 0) / period
  for (let i = period; i < candles.length; i++) {
    ema = candles[i].close * k + ema * (1 - k)
  }
  return ema
}
// Returns true if trend matches bias (bullish = price above EMA, bearish = price below)
// Requires price to be at least EMA_MIN_DIST away from EMA for strong trend confirmation
const EMA_MIN_DIST_PCT = 0.001  // 0.1% of price must be away from EMA
function trendAligned(candles, bias, period = EMA_PERIOD) {
  const ema = computeEMA(candles, period)
  if (ema === null) return true  // not enough data — allow trade
  const price = candles[candles.length - 1].close
  const minDist = price * EMA_MIN_DIST_PCT
  if (bias === 'bullish') return price > ema + minDist
  if (bias === 'bearish') return price < ema - minDist
  return true
}

// ── Multi-timeframe trend: also check 200-period EMA for HTF trend ──────────
const EMA_HTF_PERIOD = 200
function htfTrendAligned(candles, bias) {
  return trendAligned(candles, bias, EMA_HTF_PERIOD)
}

// ── Displacement filter — require a strong momentum candle before FVG entries ─
const DISPLACEMENT_MULT = 1.5  // candle body must be >= 1.5x average body size
function hasDisplacement(candles, lookback = 5) {
  if (candles.length < lookback + 1) return false
  const recent = candles.slice(-lookback - 1, -1)
  const avgBody = recent.reduce((s, c) => s + Math.abs(c.close - c.open), 0) / recent.length
  const last = candles[candles.length - 1]
  const lastBody = Math.abs(last.close - last.open)
  return lastBody >= avgBody * DISPLACEMENT_MULT
}

// ── ATR volatility filter — only trade when market is active enough ─────────
const MIN_ATR_MULT = 0.8  // ATR must be at least 80% of the 50-candle avg
function isVolatileEnough(candles, lookback = 14) {
  if (candles.length < 50) return true
  const recentATR = candles.slice(-lookback).reduce((s, c) => s + (c.high - c.low), 0) / lookback
  const avgATR = candles.slice(-50).reduce((s, c) => s + (c.high - c.low), 0) / 50
  return recentATR >= avgATR * MIN_ATR_MULT
}

// ── SHORT simulation — exit at TP, SL, or max duration (SL never moves) ─────
function simulateShortTrade(simCandles, entryPrice, slPrice, tpPrice, maxCandles = 300, entryTime = 0) {
  const tpDist = entryPrice - tpPrice
  if (tpDist <= 0) return null

  for (let k = 0; k < Math.min(simCandles.length, maxCandles); k++) {
    const fc = simCandles[k]

    // Max duration — force close
    if (entryTime > 0 && fc.time - entryTime >= MAX_TRADE_DURATION) {
      return { outcome: 'loss', exitPrice: fc.close, exitTime: fc.time, exitReason: 'timeout' }
    }

    // SL hit (price goes UP to hit short SL) — SL stays fixed
    if (fc.high >= slPrice) {
      return { outcome: 'loss', exitPrice: slPrice, exitTime: fc.time, exitReason: 'sl' }
    }

    // TP hit (price goes DOWN to hit short TP) — ONLY way to win
    if (fc.low <= tpPrice) {
      return { outcome: 'win', exitPrice: tpPrice, exitTime: fc.time, exitReason: 'tp' }
    }
  }

  if (simCandles.length > 0) {
    const lastCandle = simCandles[Math.min(simCandles.length - 1, maxCandles - 1)]
    return { outcome: 'loss', exitPrice: lastCandle.close, exitTime: lastCandle.time, exitReason: 'candle-limit' }
  }
  return null
}

// ── LONG simulation — exit at TP, SL, or max duration (SL never moves) ──────
function simulateLongTrade(simCandles, entryPrice, slPrice, tpPrice, maxCandles = 300, entryTime = 0) {
  const tpDist = tpPrice - entryPrice
  if (tpDist <= 0) return null

  for (let k = 0; k < Math.min(simCandles.length, maxCandles); k++) {
    const fc = simCandles[k]

    // Max duration — force close
    if (entryTime > 0 && fc.time - entryTime >= MAX_TRADE_DURATION) {
      return { outcome: 'loss', exitPrice: fc.close, exitTime: fc.time, exitReason: 'timeout' }
    }

    // SL hit (price goes DOWN to hit long SL) — SL stays fixed
    if (fc.low <= slPrice) {
      return { outcome: 'loss', exitPrice: slPrice, exitTime: fc.time, exitReason: 'sl' }
    }

    // TP hit (price goes UP to hit long TP) — ONLY way to win
    if (fc.high >= tpPrice) {
      return { outcome: 'win', exitPrice: tpPrice, exitTime: fc.time, exitReason: 'tp' }
    }
  }

  if (simCandles.length > 0) {
    const lastCandle = simCandles[Math.min(simCandles.length - 1, maxCandles - 1)]
    return { outcome: 'loss', exitPrice: lastCandle.close, exitTime: lastCandle.time, exitReason: 'candle-limit' }
  }
  return null
}

// ── SL/TP for LONG strategy (uses long-specific params) ──────────────────────
function getTPSLLong(bias, entryPrice, sweepWickExtreme, recent5m, symbol) {
  let slPrice, slDist
  const fixedSL = LONG_FIXED_SL[symbol]

  if (fixedSL != null) {
    slDist = fixedSL
    slPrice = entryPrice - slDist
  } else {
    // Sweep wick SL with buffer
    slPrice = sweepWickExtreme - 3
    const slBounds = LONG_SL_BOUNDS[symbol] || DEFAULT_SL_BOUNDS
    if (entryPrice - slPrice < slBounds.min) slPrice = entryPrice - slBounds.min
    slDist = Math.abs(entryPrice - slPrice)
    if (slDist > slBounds.max) return null
  }

  // Fixed TP override (e.g. MGC = 50pt)
  const fixedTP = LONG_FIXED_TP[symbol]
  if (fixedTP != null) {
    const tpPrice = entryPrice + fixedTP
    return { slPrice, tpPrice }
  }

  const rr = LONG_SYMBOL_RR[symbol] || 4
  const minTPDist = slDist * rr
  const maxTPDist = minTPDist + 30

  const { highs } = detectSwings(recent5m, 3)
  const c = highs.filter(h => h.price >= entryPrice + minTPDist && h.price <= entryPrice + maxTPDist).sort((a, b) => a.price - b.price)
  const tpPrice = c[0]?.price ?? entryPrice + minTPDist

  return { slPrice, tpPrice }
}

// ── SL/TP for default strategy ────────────────────────────────────────────────
function getTPSL(bias, entryPrice, sweepWickExtreme, recent5m, symbol) {
  let slPrice, slDist
  const fixedSL = FIXED_SL[symbol]

  if (fixedSL != null) {
    slDist = fixedSL
    slPrice = bias === 'bullish' ? entryPrice - slDist : entryPrice + slDist
  } else {
    // Sweep wick SL (ES style)
    slPrice = bias === 'bullish' ? sweepWickExtreme - 2 : sweepWickExtreme + 2
    if (bias === 'bullish' && entryPrice - slPrice < 10) slPrice = entryPrice - 10
    if (bias === 'bearish' && slPrice - entryPrice < 10) slPrice = entryPrice + 10
    slDist = Math.abs(entryPrice - slPrice)
    if (slDist > 60) return null
  }

  // Fixed TP override (e.g. MGC = 50pt)
  const fixedTP = FIXED_TP[symbol]
  if (fixedTP != null) {
    const tpPrice = bias === 'bullish' ? entryPrice + fixedTP : entryPrice - fixedTP
    return { slPrice, tpPrice }
  }

  const rr = SYMBOL_RR[symbol] || MIN_RR
  // Dynamic TP: minimum = SL * RR, search window extends 30pt beyond that
  const minTPDist = slDist * rr
  const maxTPDist = minTPDist + 30

  const { highs, lows } = detectSwings(recent5m, 3)
  let tpPrice
  if (bias === 'bullish') {
    const c = highs.filter(h => h.price >= entryPrice + minTPDist && h.price <= entryPrice + maxTPDist).sort((a, b) => a.price - b.price)
    tpPrice = c[0]?.price ?? entryPrice + minTPDist
  } else {
    const c = lows.filter(l => l.price <= entryPrice - minTPDist && l.price >= entryPrice - maxTPDist).sort((a, b) => b.price - a.price)
    tpPrice = c[0]?.price ?? entryPrice - minTPDist
  }
  return { slPrice, tpPrice }
}

// ── MGC1! strategy: HTF bias + clean 4h/1h + 5m FVG + 5m BOS confirm ────────
function runBacktestMGC(candles5m) {
  const multiplier = CONTRACT_MULTIPLIER['MGC1!']
  const trades     = []
  if (!candles5m.length) return trades

  const candles1h  = buildHTFCandles(candles5m, 60)
  const candles4h  = buildHTFCandles(candles5m, 240)
  let lastExitTime = 0
  const usedFVGs       = new Set()  // one trade per FVG
  const usedEntryTimes = new Set()  // no duplicate timestamps

  for (let i = 20; i < candles5m.length - 1; i++) {
    const now5m    = candles5m[i]
    const recent5m = candles5m.slice(Math.max(0, i - 36), i + 1)  // ~3hrs of 5m

    if (!isMGCKillZone(now5m.time)) continue
    if (now5m.time <= lastExitTime) continue

    // ── EMA trend filter (50-period on 5m) ───────────────────────────────────
    const emaSlice = candles5m.slice(Math.max(0, i - EMA_HTF_PERIOD), i + 1)

    // ── 4h trend direction (required — only trade with the 4h trend) ──────────
    const now4hIdx = candles4h.findLastIndex(c => c.time <= now5m.time)
    if (now4hIdx < 5) continue
    const recent4h = candles4h.slice(Math.max(0, now4hIdx - 20), now4hIdx + 1)
    const { highs: h4h, lows: l4h } = detectSwings(recent4h, 2)
    const bos4h = detectBOS(recent4h, h4h, l4h)
    if (!bos4h.length) continue
    const trend4h = bos4h[bos4h.length - 1].type  // 4h tells us the only allowed direction

    // ── 1h bias must agree with 4h trend ─────────────────────────────────────
    const now1hIdx = candles1h.findLastIndex(c => c.time <= now5m.time)
    if (now1hIdx < 10) continue
    const recent1h = candles1h.slice(Math.max(0, now1hIdx - 20), now1hIdx + 1)
    const { highs: h1h, lows: l1h } = detectSwings(recent1h, 2)
    const bos1h = detectBOS(recent1h, h1h, l1h)
    if (!bos1h.length) continue
    const bias1h = bos1h[bos1h.length - 1].type

    // Both timeframes must agree — no counter-trend trades ever
    if (bias1h !== trend4h) continue
    const bias = trend4h

    // ── EMA must agree with bias ─────────────────────────────────────────────
    if (!trendAligned(emaSlice, bias)) continue
    if (!htfTrendAligned(emaSlice, bias)) continue

    // ── TP: fixed 50pt for MGC ─────────────────────────────────────────────────
    const mgcTP = FIXED_TP['MGC1!'] || 50
    const tpPrice = bias === 'bullish' ? now5m.close + mgcTP : now5m.close - mgcTP

    // ── 4h FVG check: no open FVG blocking path to TP ────────────────────────
    if (hasFVGBlocking(recent4h, now5m.close, tpPrice)) continue

    // ── 1h FVG check: no open FVG blocking path to TP ────────────────────────
    if (hasFVGBlocking(recent1h, now5m.close, tpPrice)) continue

    // ── 5m FVG: longs need 5pts wide, shorts need 7pts wide ─────────────────
    const minFVGWidth = bias === 'bearish' ? 7 : 5
    const fvgs5m = detectFVGs(recent5m).filter(f => f.type === bias && f.top - f.bottom >= minFVGWidth)
    if (!fvgs5m.length) continue
    const fvg5m = fvgs5m[fvgs5m.length - 1]

    // ── Entry: retrace to midpoint, but only if it hasn't been touched before ─
    // If price retraces to the midpoint more than once the FVG is weakened — skip
    const fvgStartIdx = candles5m.findIndex(c => c.time > fvg5m.time)
    if (fvgStartIdx < 0) continue
    const postFVG = candles5m.slice(fvgStartIdx, fvgStartIdx + 50)

    let touchCount = 0, inTouch = false, entryCandle = null
    for (const c of postFVG) {
      const touched = bias === 'bullish' ? c.low <= fvg5m.mid : c.high >= fvg5m.mid
      if (touched && !inTouch) {
        touchCount++
        inTouch = true
        if (touchCount === 1) entryCandle = c  // only enter on the very first touch
      } else if (!touched) {
        inTouch = false
      }
    }
    if (!entryCandle || touchCount > 1) continue  // skip if never touched or touched more than once
    if (usedFVGs.has(fvg5m.time)) continue        // this FVG already triggered a trade
    if (usedEntryTimes.has(entryCandle.time)) continue
    const entryPrice = fvg5m.mid

    // ── SL: fixed 20pt. TP: fixed 50pt ─────────────────────────────────────────
    const slPrice = bias === 'bullish' ? entryPrice - 20 : entryPrice + 20

    if (bias === 'bullish' && tpPrice <= entryPrice) continue
    if (bias === 'bearish' && tpPrice >= entryPrice) continue

    const slDist = 20
    const tpDist = Math.abs(tpPrice - entryPrice)

    // ── Simulate trade ─────────────────────────────────────────────────────────
    const entryIdx = candles5m.indexOf(entryCandle)
    const future5m = candles5m.slice(entryIdx + 1, entryIdx + 300)
    const units = UNITS['MGC1!'] || 1

    let simResult = null
    if (bias === 'bearish') {
      simResult = simulateShortTrade(future5m, entryPrice, slPrice, tpPrice, 300, entryCandle.time)
    } else {
      simResult = simulateLongTrade(future5m, entryPrice, slPrice, tpPrice, 300, entryCandle.time)
    }
    if (!simResult) continue

    const { outcome, exitPrice: simExit, exitTime } = simResult
    const pnlPoints  = bias === 'bearish'
      ? (outcome === 'win' ? entryPrice - simExit : -(simExit - entryPrice))
      : (outcome === 'win' ? simExit - entryPrice : -(entryPrice - simExit))
    const pnlDollars = parseFloat((pnlPoints * multiplier * units).toFixed(2))
    const rr         = parseFloat((tpDist / slDist).toFixed(2))

    trades.push({
      id: trades.length + 1, time: entryCandle.time, exitTime, bias,
      entryPrice:  parseFloat(entryPrice.toFixed(4)),
      stopPrice:   parseFloat(slPrice.toFixed(4)),
      targetPrice: parseFloat(tpPrice.toFixed(4)),
      exitPrice:   parseFloat(simExit.toFixed(4)),
      outcome, pnlDollars, rr, contracts: units,
      signal: 'HTFBias+4h/1hClean+5mFVG+MidRetrace',
    })

    usedFVGs.add(fvg5m.time)
    usedEntryTimes.add(entryCandle.time)
    lastExitTime = exitTime || now5m.time
  }

  return trades
}

// ── MGC1! strategy long: Sweep Asian lows, bullish displacement, FVG/OB retrace ──
function runBacktestMGCLong(candles5m) {
  const multiplier = CONTRACT_MULTIPLIER['MGC1!']
  const trades     = []
  if (!candles5m.length) return trades

  const candles4h  = buildHTFCandles(candles5m, 240)
  let lastExitTime = 0
  const usedSweeps     = new Set()
  const usedEntryTimes = new Set()

  for (let i = 30; i < candles5m.length - 1; i++) {
    const now5m    = candles5m[i]
    const recent5m = candles5m.slice(Math.max(0, i - 100), i + 1)  // ~8.3hrs of 5m

    if (!isMGCLongKillZone(now5m.time)) continue
    if (now5m.time <= lastExitTime) continue

    // ── 1. Soft bullish bias: recent 5m close > 20-candle SMA OR any 4H bullish BOS
    const smaSlice = recent5m.slice(-20)
    const smaAvg = smaSlice.reduce((s, c) => s + c.close, 0) / smaSlice.length
    let hasBullishBias = now5m.close > smaAvg
    if (!hasBullishBias) {
      const now4hIdx = candles4h.findLastIndex(c => c.time <= now5m.time)
      if (now4hIdx >= 3) {
        const recent4h = candles4h.slice(Math.max(0, now4hIdx - 20), now4hIdx + 1)
        const { highs: h4h, lows: l4h } = detectSwings(recent4h, 2)
        const bos4h = detectBOS(recent4h, h4h, l4h)
        hasBullishBias = bos4h.some(b => b.type === 'bullish')
      }
    }
    if (!hasBullishBias) continue

    // ── 2. Find swing lows on 5m, check if swept (wick below + close above) ────
    const { highs: h5m, lows: l5m } = detectSwings(recent5m, 2)
    if (!l5m.length) continue

    let sweepLow = null, sweepCandle = null, sweepWickLow = null
    // Check against any of the last 3 swing lows, not just the very last one
    const checkLows = l5m.slice(-3)
    for (let j = recent5m.length - 1; j >= 2; j--) {
      const c = recent5m[j]
      for (const sLow of checkLows) {
        if (c.low < sLow.price && c.close > sLow.price) {
          sweepLow = sLow.price
          sweepCandle = c
          sweepWickLow = c.low
          break
        }
      }
      if (sweepLow) break
    }
    if (!sweepLow || !sweepCandle) continue
    if (usedSweeps.has(sweepCandle.time)) continue

    // ── 3. Find bullish displacement candle after sweep ───────────────────────
    const postSweepIdx = recent5m.indexOf(sweepCandle) + 1
    const postSweep5m = recent5m.slice(postSweepIdx, Math.min(postSweepIdx + 30, recent5m.length))

    let displaceCandle = null
    for (const c of postSweep5m) {
      // Bullish displacement: close > open, body is 45%+ of range
      if (c.close > c.open) {
        const range = c.high - c.low
        const body = c.close - c.open
        if (range > 0 && body / range >= 0.30) {
          displaceCandle = c
          break
        }
      }
    }
    if (!displaceCandle) continue

    // ── 4. Find bullish FVG from displacement move ────────────────────────────
    const postDisplace5m = recent5m.slice(recent5m.indexOf(displaceCandle) + 1)
    const fvgs5m = detectFVGs(postDisplace5m).filter(f => f.type === 'bullish')
    if (!fvgs5m.length) continue
    const fvg5m = fvgs5m[0]

    // ── 5. Entry at 50% of FVG when price retraces back ───────────────────────
    const fvgEntryPrice = fvg5m.mid
    const fvgStartIdx = candles5m.findIndex(c => c.time > fvg5m.time)
    if (fvgStartIdx < 0) continue
    const postFVG = candles5m.slice(fvgStartIdx, fvgStartIdx + 150)

    let entryCandle = null
    for (const c of postFVG) {
      if (c.low <= fvgEntryPrice) {
        entryCandle = c
        break
      }
    }
    if (!entryCandle) continue
    if (usedEntryTimes.has(entryCandle.time)) continue

    const entryPrice = fvgEntryPrice

    // ── 6. SL below swept low wick - 3pt buffer, capped to $300 max loss ─────
    const slPrice = capLongSL(entryPrice, sweepWickLow - 3, 'MGC1!')

    // ── 7. TP: fixed 50pt for MGC ──────────────────────────────────────────────
    const mgcLongTP = LONG_FIXED_TP['MGC1!'] || 50
    const tpPrice = entryPrice + mgcLongTP

    const slDist = Math.abs(entryPrice - slPrice)
    const tpDist = mgcLongTP
    if (slDist === 0) continue

    // ── Simulate trade ────────────────────────────────────────────────────────
    const entryIdx = candles5m.findIndex(c => c.time >= entryCandle.time)
    const future5m = candles5m.slice(entryIdx + 1, entryIdx + 120)

    const simResult = simulateLongTrade(future5m, entryPrice, slPrice, tpPrice, 120, entryCandle.time)
    if (!simResult) continue

    const { outcome, exitPrice, exitTime } = simResult
    const units      = UNITS['MGC1!'] || 1
    const actualPnl  = (exitPrice - entryPrice) * multiplier * units
    const rr         = parseFloat((tpDist / slDist).toFixed(2))

    trades.push({
      id: trades.length + 1, time: entryCandle.time, exitTime, bias: 'bullish',
      entryPrice:  parseFloat(entryPrice.toFixed(4)),
      stopPrice:   parseFloat(slPrice.toFixed(4)),
      targetPrice: parseFloat(tpPrice.toFixed(4)),
      exitPrice:   parseFloat(exitPrice.toFixed(4)),
      outcome, pnlDollars: parseFloat(actualPnl.toFixed(2)), rr, contracts: units,
      signal: 'MGC+4hBullish+SweepLow+Displacement+FVG',
    })

    usedSweeps.add(sweepCandle.time)
    usedEntryTimes.add(entryCandle.time)
    lastExitTime = exitTime || now5m.time
  }

  return trades
}

// ── IFVG detection ───────────────────────────────────────────────────────────
// An FVG is "inversed" when price fully closes through it.
//   Bullish FVG inversed (close < bottom) → bearish IFVG → SHORT on retrace
//   Bearish FVG inversed (close > top)    → bullish IFVG → LONG on retrace
function detectIFVGs(candles, fvgs, minWidth = DEFAULT_FVG_WIDTH) {
  const ifvgs = []
  // Build a time→index map for fast lookup
  const timeIdx = {}
  for (let i = 0; i < candles.length; i++) timeIdx[candles[i].time] = i

  for (const fvg of fvgs) {
    if (fvg.top - fvg.bottom < minWidth) continue

    // Start scanning from the FVG's position, cap at 200 candles ahead
    const startIdx = (timeIdx[fvg.time] || 0) + 1
    const endIdx = Math.min(startIdx + 200, candles.length)
    for (let k = startIdx; k < endIdx; k++) {
      const c = candles[k]
      if (fvg.type === 'bullish' && c.close < fvg.bottom) {
        ifvgs.push({ ...fvg, ifvgBias: 'bearish', inversionTime: c.time, inversionIndex: k })
        break
      }
      if (fvg.type === 'bearish' && c.close > fvg.top) {
        ifvgs.push({ ...fvg, ifvgBias: 'bullish', inversionTime: c.time, inversionIndex: k })
        break
      }
    }
  }
  return ifvgs
}

// ── Find midpoint retrace entry after IFVG inversion ────────────────────────
function findMidRetrace(candles, ifvg) {
  let movedAway = false
  const startIdx = ifvg.inversionIndex + 1
  const endIdx = Math.min(startIdx + 200, candles.length)
  for (let k = startIdx; k < endIdx; k++) {
    const c = candles[k]
    if (ifvg.ifvgBias === 'bullish') {
      if (!movedAway && c.close > ifvg.mid) movedAway = true
      if (movedAway && c.low <= ifvg.mid) return c
    } else {
      if (!movedAway && c.close < ifvg.mid) movedAway = true
      if (movedAway && c.high >= ifvg.mid) return c
    }
  }
  return null
}

// ── Strategy A: Sweep + BOS backtest ─────────────────────────────────────────
function runBacktestSweepBOS(candles5m, candles1m, symbol, multiplier) {
  const trades = []
  if (!candles5m.length) return trades

  const dailyHL = buildDailyHL(candles5m)
  const sessionIndex = buildSessionHLIndex(candles5m)
  let lastExitTime = 0
  const usedSweeps     = new Set()
  const usedEntryTimes = new Set()

  for (let i = 20; i < candles5m.length - 1; i++) {
    const now5m    = candles5m[i]
    const recent5m = candles5m.slice(Math.max(0, i - 30), i + 1)

    if (!isKillZone(now5m.time)) continue
    if (now5m.time <= lastExitTime) continue

    const pdhl = getPrevDayHL(dailyHL, now5m.time)

    let sweepBias = null, sweepWickExtreme = null, sweepTime = null

    if (pdhl) {
      for (let j = recent5m.length - 1; j >= 0; j--) {
        const c = recent5m[j]
        if (c.low < pdhl.low && c.close > pdhl.low) {
          sweepBias = 'bullish'; sweepWickExtreme = c.low; sweepTime = c.time; break
        }
        if (c.high > pdhl.high && c.close < pdhl.high) {
          sweepBias = 'bearish'; sweepWickExtreme = c.high; sweepTime = c.time; break
        }
      }
    }

    if (!sweepBias) {
      const sessionHL = getSessionHLFromIndex(sessionIndex, now5m.time)
      if (sessionHL) {
        for (let j = recent5m.length - 1; j >= 0; j--) {
          const c = recent5m[j]
          if (c.low < sessionHL.low && c.close > sessionHL.low) {
            sweepBias = 'bullish'; sweepWickExtreme = c.low; sweepTime = c.time; break
          }
          if (c.high > sessionHL.high && c.close < sessionHL.high) {
            sweepBias = 'bearish'; sweepWickExtreme = c.high; sweepTime = c.time; break
          }
        }
      }
    }
    if (!sweepBias) continue
    if (usedSweeps.has(sweepTime)) continue

    // BOS
    const postSweep5m = recent5m.filter(c => c.time > sweepTime)
    if (postSweep5m.length < 3) continue
    const { highs: h5, lows: l5 } = detectSwings(postSweep5m, 2)
    const bosList = detectBOS(postSweep5m, h5, l5).filter(b => b.type === sweepBias)
    if (!bosList.length) continue
    const latestBOS = bosList[bosList.length - 1]

    const bias = sweepBias

    // ── EMA trend filter ─────────────────────────────────────────────────────
    const emaSliceSB = candles5m.slice(Math.max(0, i - EMA_HTF_PERIOD), i + 1)
    if (!trendAligned(emaSliceSB, bias)) continue
    if (!htfTrendAligned(emaSliceSB, bias)) continue

    // Entry: try 1M FVG + IFVG, fallback to next 5m candle after BOS
    let entryCandle = null, entryPrice = null, entrySignal = 'Sweep+BOS'

    const m1After = candles1m.filter(c => c.time >= latestBOS.time && c.time <= now5m.time + 300)
    if (m1After.length >= 5) {
      const fvgs1m = detectFVGs(m1After).filter(f => f.type === bias && f.top - f.bottom >= 3)
      if (fvgs1m.length) {
        const fvg1m     = fvgs1m[fvgs1m.length - 1]
        const m1PostFVG = m1After.filter(c => c.time > fvg1m.time)
        const ifvgEntry = findIFVGEntry(m1PostFVG, fvg1m, bias)
        if (ifvgEntry) {
          entryCandle = ifvgEntry
          entryPrice  = ifvgEntry.close
          entrySignal = 'Sweep+BOS+1mIFVG'
        }
      }
    }

    if (!entryCandle) {
      const bosIdx = candles5m.findIndex(c => c.time >= latestBOS.time)
      entryCandle  = bosIdx >= 0 ? candles5m[bosIdx + 1] : null
      if (!entryCandle) continue
      entryPrice = entryCandle.open
    }

    if (usedEntryTimes.has(entryCandle.time)) continue

    // SL/TP
    const tpsl = getTPSL(bias, entryPrice, sweepWickExtreme, recent5m, symbol)
    if (!tpsl) continue
    const { slPrice, tpPrice } = tpsl

    if (bias === 'bullish' && tpPrice <= entryPrice) continue
    if (bias === 'bearish' && tpPrice >= entryPrice) continue

    const slDist = Math.abs(entryPrice - slPrice)
    const tpDist = Math.abs(tpPrice - entryPrice)
    if (slDist === 0 || tpDist <= 0) continue
    if (FIXED_TP[symbol] == null && tpDist / slDist < (SYMBOL_RR[symbol] || MIN_RR)) continue

    const entryIdx1m = candles1m.findIndex(c => c.time >= entryCandle.time)
    const future1m   = candles1m.slice(entryIdx1m + 1, entryIdx1m + 400)
    const entryIdx5m = candles5m.findIndex(c => c.time >= entryCandle.time)
    const simCandles = future1m.length > 0 ? future1m : candles5m.slice(entryIdx5m + 1, entryIdx5m + 200)
    const units = UNITS[symbol] || 1

    let simResult = null
    if (bias === 'bearish') {
      simResult = simulateShortTrade(simCandles, entryPrice, slPrice, tpPrice, 300, entryCandle.time)
    } else {
      simResult = simulateLongTrade(simCandles, entryPrice, slPrice, tpPrice, 300, entryCandle.time)
    }
    if (!simResult) continue

    const { outcome, exitPrice: simExit, exitTime } = simResult
    const pnlPoints = bias === 'bearish'
      ? (outcome === 'win' ? entryPrice - simExit : -(simExit - entryPrice))
      : (outcome === 'win' ? simExit - entryPrice : -(entryPrice - simExit))
    const pnlDollars = parseFloat((pnlPoints * multiplier * units).toFixed(2))

    trades.push({
      time:        entryCandle.time,
      exitTime,
      bias,
      entryPrice:  parseFloat(entryPrice.toFixed(4)),
      stopPrice:   parseFloat(slPrice.toFixed(4)),
      targetPrice: parseFloat(tpPrice.toFixed(4)),
      exitPrice:   parseFloat(simExit.toFixed(4)),
      outcome, pnlDollars, contracts: units,
      rr:          parseFloat((tpDist / slDist).toFixed(2)),
      signal:      entrySignal,
    })

    usedSweeps.add(sweepTime)
    usedEntryTimes.add(entryCandle.time)
    lastExitTime = exitTime || now5m.time
  }

  return trades
}

// ── MNQ/MES Long: Sweep + Bullish Displacement + FVG/OB Entry ──────────────────
function runBacktestSweepBOSLong(candles5m, candles1m, symbol, multiplier) {
  const trades = []
  if (!candles5m.length) return trades

  const candles4h = buildHTFCandles(candles5m, 240)
  const dailyHL = buildDailyHL(candles5m)
  const sessionIndex = buildSessionHLIndex(candles5m)
  let lastExitTime = 0
  const usedSweeps     = new Set()
  const usedEntryTimes = new Set()

  for (let i = 30; i < candles5m.length - 1; i++) {
    const now5m    = candles5m[i]
    const nowMins  = getETMinutes(now5m.time)
    const recent5m = candles5m.slice(Math.max(0, i - 100), i + 1)  // ~8.3hrs

    // ═══════════════════════════════════════════════════════════════════════════
    // MNQ1! — Micro Nasdaq Longs
    // ═══════════════════════════════════════════════════════════════════════════
    if (symbol === 'MNQ1!') {
      // Kill zone: 7:30 AM - 1:00 PM for sweep detection + entries
      if (!(nowMins >= 450 && nowMins < 780)) continue
      if (now5m.time <= lastExitTime) continue

      // 1. Soft bullish bias: recent 5m close > 20-candle SMA OR any 4H bullish BOS
      const smaSlice = recent5m.slice(-20)
      const smaAvg = smaSlice.reduce((s, c) => s + c.close, 0) / smaSlice.length
      let hasBullishBias = now5m.close > smaAvg
      if (!hasBullishBias) {
        const now4hIdx = candles4h.findLastIndex(c => c.time <= now5m.time)
        if (now4hIdx >= 3) {
          const recent4h = candles4h.slice(Math.max(0, now4hIdx - 20), now4hIdx + 1)
          const { highs: h4h, lows: l4h } = detectSwings(recent4h, 2)
          const bos4h = detectBOS(recent4h, h4h, l4h)
          hasBullishBias = bos4h.some(b => b.type === 'bullish')
        }
      }
      if (!hasBullishBias) continue

      // ── EMA trend filter ───────────────────────────────────────────────────
      const emaSliceMNQ = candles5m.slice(Math.max(0, i - EMA_HTF_PERIOD), i + 1)
      if (!trendAligned(emaSliceMNQ, 'bullish')) continue
    if (!htfTrendAligned(emaSliceMNQ, 'bullish')) continue

      // 2. Find equal lows or swing lows, check if swept
      const { lows: l5m } = detectSwings(recent5m, 2)
      if (!l5m.length) continue

      let sweepLow = null, sweepCandle = null, sweepWickLow = null
      const checkLows = l5m.slice(-3)
      for (let j = recent5m.length - 1; j >= 2; j--) {
        const c = recent5m[j]
        for (const sLow of checkLows) {
          if (c.low < sLow.price && c.close > sLow.price) {
            sweepLow = sLow.price
            sweepCandle = c
            sweepWickLow = c.low
            break
          }
        }
        if (sweepLow) break
      }
      if (!sweepLow || !sweepCandle) continue
      if (usedSweeps.has(sweepCandle.time)) continue

      // 3. Find bullish displacement candle after sweep
      const postSweepIdx = recent5m.indexOf(sweepCandle) + 1
      const postSweep5m = recent5m.slice(postSweepIdx, Math.min(postSweepIdx + 30, recent5m.length))

      let displaceCandle = null
      for (const c of postSweep5m) {
        if (c.close > c.open) {
          const range = c.high - c.low
          const body = c.close - c.open
          if (range > 0 && body / range >= 0.30) {
            displaceCandle = c
            break
          }
        }
      }
      if (!displaceCandle) continue

      // 4. Find bullish FVG from displacement
      const postDisplace5m = recent5m.slice(recent5m.indexOf(displaceCandle) + 1)
      const fvgs5m = detectFVGs(postDisplace5m).filter(f => f.type === 'bullish')
      if (!fvgs5m.length) continue
      const fvg5m = fvgs5m[0]

      // 5. Entry at 50% FVG retrace
      const entryPrice = fvg5m.mid
      const fvgStartIdx = candles5m.findIndex(c => c.time > fvg5m.time)
      if (fvgStartIdx < 0) continue
      const postFVG = candles5m.slice(fvgStartIdx, fvgStartIdx + 150)

      let entryCandle = null
      for (const c of postFVG) {
        if (c.low <= entryPrice) {
          entryCandle = c
          break
        }
      }
      if (!entryCandle) continue
      if (usedEntryTimes.has(entryCandle.time)) continue

      // 6. SL below sweep wick - 3pt, capped to $300 max loss
      const slPrice = capLongSL(entryPrice, sweepWickLow - 3, symbol)

      // 7. TP: fixed override or swing high target
      let tpPrice
      const sweepFixedTP = LONG_FIXED_TP[symbol]
      if (sweepFixedTP != null) {
        tpPrice = entryPrice + sweepFixedTP
      } else {
        const { highs: h5m } = detectSwings(recent5m, 2)
        const tpCands = h5m.filter(h => h.price > entryPrice).sort((a, b) => a.price - b.price)
        if (!tpCands.length) continue
        tpPrice = tpCands[0].price
      }

      if (tpPrice <= entryPrice) continue

      const slDist = Math.abs(entryPrice - slPrice)
      const tpDist = Math.abs(tpPrice - entryPrice)
      if (slDist === 0 || tpDist <= 0) continue
      if (sweepFixedTP == null && tpDist / slDist < (LONG_SYMBOL_RR[symbol] || 4)) continue
      if (sweepFixedTP == null && tpDist / slDist > 16) continue

      // Simulate on 1m data if available
      const entryIdx1m = candles1m.findIndex(c => c.time >= entryCandle.time)
      const future1m = candles1m.slice(entryIdx1m + 1, entryIdx1m + 400)
      const entryIdx5m = candles5m.findIndex(c => c.time >= entryCandle.time)
      const simCandles = future1m.length > 0 ? future1m : candles5m.slice(entryIdx5m + 1, entryIdx5m + 200)

      const simResult = simulateLongTrade(simCandles, entryPrice, slPrice, tpPrice, 300, entryCandle.time)
      if (!simResult) continue

      const { outcome, exitPrice, exitTime } = simResult
      const actualPnl = (exitPrice - entryPrice) * multiplier * (UNITS[symbol] || 1)

      trades.push({
        time:        entryCandle.time,
        exitTime,
        bias:        'bullish',
        entryPrice:  parseFloat(entryPrice.toFixed(4)),
        stopPrice:   parseFloat(slPrice.toFixed(4)),
        targetPrice: parseFloat(tpPrice.toFixed(4)),
        exitPrice:   parseFloat(exitPrice.toFixed(4)),
        outcome,
        pnlDollars:  parseFloat(actualPnl.toFixed(2)),
        contracts:   UNITS[symbol] || 1,
        rr:          parseFloat((tpDist / slDist).toFixed(2)),
        signal:      'MNQ+4hBullish+Sweep+Displacement+FVG',
      })

      usedSweeps.add(sweepCandle.time)
      usedEntryTimes.add(entryCandle.time)
      lastExitTime = exitTime || now5m.time
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MES1! — Micro S&P Longs
    // ═══════════════════════════════════════════════════════════════════════════
    else if (symbol === 'MES1!') {
      // Kill zone: 7:30 AM - 1:00 PM (450-780 mins)
      if (!(nowMins >= 450 && nowMins < 780)) continue
      if (now5m.time <= lastExitTime) continue

      // ── EMA trend filter ─────────────────────────────────────────────────
      const emaSliceMES = candles5m.slice(Math.max(0, i - EMA_HTF_PERIOD), i + 1)
      if (!trendAligned(emaSliceMES, 'bullish')) continue
    if (!htfTrendAligned(emaSliceMES, 'bullish')) continue

      // 1. Bias check: 1H uptrend OR prev day closed bullish
      const now1hIdx = buildHTFCandles(candles5m, 60).findLastIndex(c => c.time <= now5m.time)
      let uptrend = false
      if (now1hIdx >= 5) {
        const recent1h = buildHTFCandles(candles5m, 60).slice(Math.max(0, now1hIdx - 10), now1hIdx + 1)
        const { highs: h1h, lows: l1h } = detectSwings(recent1h, 2)
        const bos1h = detectBOS(recent1h, h1h, l1h)
        if (bos1h.length && bos1h[bos1h.length - 1].type === 'bullish') uptrend = true
      }

      const pdhl = getPrevDayHL(dailyHL, now5m.time)
      let prevDayBullish = false
      if (pdhl) {
        // Find the prev day's open and close
        const prevDayDate = pdhl.date
        const prevDayCandles = recent5m.filter(c => getETDateStr(c.time) === prevDayDate)
        if (prevDayCandles.length > 0) {
          const pdOpen = prevDayCandles[0].open
          const pdClose = prevDayCandles[prevDayCandles.length - 1].close
          prevDayBullish = pdClose > pdOpen
        }
      }

      if (!uptrend && !prevDayBullish) continue

      // 2. Mark prev day low and Asian session low as liquidity targets
      let sweepLow = null, sweepCandle = null, sweepWickLow = null
      if (pdhl) {
        // Try to sweep prev day low
        for (let j = recent5m.length - 1; j >= 3; j--) {
          const c = recent5m[j]
          if (c.low < pdhl.low && c.close > pdhl.low) {
            sweepLow = pdhl.low
            sweepCandle = c
            sweepWickLow = c.low
            break
          }
        }
      }

      // If no prev day sweep, try session low (Asian low)
      if (!sweepLow) {
        const sessionHL = getSessionHLFromIndex(sessionIndex, now5m.time)
        if (sessionHL) {
          for (let j = recent5m.length - 1; j >= 3; j--) {
            const c = recent5m[j]
            if (c.low < sessionHL.low && c.close > sessionHL.low) {
              sweepLow = sessionHL.low
              sweepCandle = c
              sweepWickLow = c.low
              break
            }
          }
        }
      }

      if (!sweepLow || !sweepCandle) continue
      if (usedSweeps.has(sweepCandle.time)) continue

      // 3. Look for bullish market structure shift on 5m
      const postSweep5m = recent5m.filter(c => c.time > sweepCandle.time)
      if (postSweep5m.length < 2) continue
      const { highs: h5, lows: l5 } = detectSwings(postSweep5m, 2)
      const bosList = detectBOS(postSweep5m, h5, l5).filter(b => b.type === 'bullish')
      if (!bosList.length) continue

      // 4. Find last bearish candle before bullish push = Order Block
      const postSweepIdx = recent5m.indexOf(sweepCandle)
      let obCandle = null
      for (let j = postSweepIdx + 1; j < recent5m.length; j++) {
        const c = recent5m[j]
        if (c.close < c.open) {  // bearish (red) candle
          obCandle = c
        } else if (c.close > c.open && obCandle) {
          // Found bullish after bearish — OB is confirmed
          break
        }
      }
      if (!obCandle) continue

      // 5. Entry on retest of OB (when price comes back down near OB top)
      const obTop = Math.max(obCandle.open, obCandle.close)
      const obBot = Math.min(obCandle.open, obCandle.close)
      const entryPrice = obTop
      const obIdx = recent5m.indexOf(obCandle)
      const postOB = recent5m.slice(obIdx + 1)

      let entryCandle = null
      for (const c of postOB) {
        // Clean retest: wick into OB zone and close above
        if (c.low <= entryPrice && c.close > obBot) {
          entryCandle = c
          break
        }
      }

      // Fallback: search forward in full candles5m with wider window
      if (!entryCandle) {
        const entryOBIdx = candles5m.findIndex(c => c.time >= obCandle.time)
        const postOBFull = candles5m.slice(entryOBIdx + 1, entryOBIdx + 120)
        for (const c of postOBFull) {
          if (c.low <= entryPrice && c.close > obBot) {
            entryCandle = c
            break
          }
        }
      }

      if (!entryCandle) continue
      if (usedEntryTimes.has(entryCandle.time)) continue

      // 6. SL below sweep wick - 3pt, capped to $300 max loss
      const slPrice = capLongSL(entryPrice, sweepWickLow - 3, symbol)

      // 7. TP: fixed override or prev day high
      let tpPrice = null
      const pdFixedTP = LONG_FIXED_TP[symbol]
      if (pdFixedTP != null) {
        tpPrice = entryPrice + pdFixedTP
      } else if (pdhl) {
        tpPrice = pdhl.high
      } else {
        const { highs: h5m } = detectSwings(recent5m, 2)
        const tpCands = h5m.filter(h => h.price > entryPrice).sort((a, b) => a.price - b.price)
        tpPrice = tpCands[0]?.price
      }

      if (!tpPrice || tpPrice <= entryPrice) continue

      const slDist = Math.abs(entryPrice - slPrice)
      const tpDist = Math.abs(tpPrice - entryPrice)
      if (slDist === 0 || tpDist <= 0) continue
      if (pdFixedTP == null && tpDist / slDist < (LONG_SYMBOL_RR[symbol] || 4)) continue
      if (pdFixedTP == null && tpDist / slDist > 16) continue

      // Simulate trade
      const entryIdx1m = candles1m.findIndex(c => c.time >= entryCandle.time)
      const future1m = candles1m.slice(entryIdx1m + 1, entryIdx1m + 400)
      const entryIdx5m = candles5m.findIndex(c => c.time >= entryCandle.time)
      const simCandles = future1m.length > 0 ? future1m : candles5m.slice(entryIdx5m + 1, entryIdx5m + 200)

      const simResult = simulateLongTrade(simCandles, entryPrice, slPrice, tpPrice, 300, entryCandle.time)
      if (!simResult) continue

      const { outcome, exitPrice, exitTime } = simResult
      const actualPnl = (exitPrice - entryPrice) * multiplier * (UNITS[symbol] || 1)

      trades.push({
        time:        entryCandle.time,
        exitTime,
        bias:        'bullish',
        entryPrice:  parseFloat(entryPrice.toFixed(4)),
        stopPrice:   parseFloat(slPrice.toFixed(4)),
        targetPrice: parseFloat(tpPrice.toFixed(4)),
        exitPrice:   parseFloat(exitPrice.toFixed(4)),
        outcome,
        pnlDollars:  parseFloat(actualPnl.toFixed(2)),
        contracts:   UNITS[symbol] || 1,
        rr:          parseFloat((tpDist / slDist).toFixed(2)),
        signal:      'MES+BiasCheck+Sweep+OB+TP',
      })

      usedSweeps.add(sweepCandle.time)
      usedEntryTimes.add(entryCandle.time)
      lastExitTime = exitTime || now5m.time
    }
  }

  return trades
}

// ── Strategy B: IFVG Midpoint Retrace backtest ──────────────────────────────
function runBacktestIFVGMid(candles5m, candles1m, symbol, multiplier, killZoneFn = isKillZone) {
  const trades = []

  if (!candles5m.length) return trades

  // Find all FVGs, then all IFVGs across full dataset (symbol-aware width)
  const fvgWidth = MIN_FVG_WIDTH[symbol] || DEFAULT_FVG_WIDTH
  const allFVGs  = detectFVGs(candles5m)
  const allIFVGs = detectIFVGs(candles5m, allFVGs, fvgWidth)

  let lastExitTime    = 0
  const usedIFVGs      = new Set()
  const usedEntryTimes = new Set()

  for (const ifvg of allIFVGs) {
    // Must be in kill zone at inversion time
    if (!killZoneFn(ifvg.inversionTime)) continue

    // Find entry: midpoint retrace after inversion
    const entryCandle = findMidRetrace(candles5m, ifvg)
    if (!entryCandle) continue

    // Must be in kill zone at entry time
    if (!killZoneFn(entryCandle.time)) continue

    // Cooldown: 20 min between trades
    if (entryCandle.time <= lastExitTime) continue

    // Dedup
    if (usedIFVGs.has(ifvg.time)) continue
    if (usedEntryTimes.has(entryCandle.time)) continue

    const bias       = ifvg.ifvgBias
    const entryPrice = ifvg.mid

    // ── EMA trend filter ─────────────────────────────────────────────────────
    const entryIdx = candles5m.findIndex(c => c.time >= entryCandle.time)
    const emaSliceB = candles5m.slice(Math.max(0, entryIdx - EMA_HTF_PERIOD), entryIdx + 1)
    if (!trendAligned(emaSliceB, bias)) continue
    if (!htfTrendAligned(emaSliceB, bias)) continue

    // SL: fixed per symbol, or FVG-based for ES
    let slDist, slPrice
    const fixedSL = FIXED_SL[symbol]
    const slBounds = SL_BOUNDS[symbol] || DEFAULT_SL_BOUNDS
    if (fixedSL != null) {
      slDist = fixedSL
    } else {
      slDist = Math.abs(entryPrice - (bias === 'bullish' ? ifvg.bottom - 2 : ifvg.top + 2))
      if (slDist < slBounds.min || slDist > slBounds.max) continue
    }
    slPrice = bias === 'bullish' ? entryPrice - slDist : entryPrice + slDist

    // TP: fixed override or dynamic R:R
    let tpPrice
    const fixedTPVal = FIXED_TP[symbol]
    if (fixedTPVal != null) {
      tpPrice = bias === 'bullish' ? entryPrice + fixedTPVal : entryPrice - fixedTPVal
    } else {
      const minRR_sym = SYMBOL_RR[symbol] || MIN_RR
      const minTPDist = slDist * minRR_sym
      const maxTPDist = minTPDist + 30

      const entryIdx = candles5m.findIndex(c => c.time >= entryCandle.time)
      const recent5m = candles5m.slice(Math.max(0, entryIdx - 30), entryIdx + 1)
      const { highs, lows } = detectSwings(recent5m, 3)

      if (bias === 'bullish') {
        const targets = highs.filter(h => h.price >= entryPrice + minTPDist && h.price <= entryPrice + maxTPDist).sort((a, b) => a.price - b.price)
        tpPrice = targets[0]?.price ?? entryPrice + minTPDist
      } else {
        const targets = lows.filter(l => l.price <= entryPrice - minTPDist && l.price >= entryPrice - maxTPDist).sort((a, b) => b.price - a.price)
        tpPrice = targets[0]?.price ?? entryPrice - minTPDist
      }

      const tpDistCheck = Math.abs(tpPrice - entryPrice)
      if (tpDistCheck / slDist < minRR_sym) continue
    }

    if (bias === 'bullish' && tpPrice <= entryPrice) continue
    if (bias === 'bearish' && tpPrice >= entryPrice) continue

    const tpDist = Math.abs(tpPrice - entryPrice)

    // Simulate trade: use 1m candles if available, else 5m
    const entryIdx1m = candles1m?.length ? candles1m.findIndex(c => c.time >= entryCandle.time) : -1
    const simCandles = entryIdx1m >= 0 && entryIdx1m < candles1m.length - 1
      ? candles1m.slice(entryIdx1m + 1, entryIdx1m + 400)
      : candles5m.slice(entryIdx + 1, entryIdx + 200)
    const units = UNITS[symbol] || 1

    let simResult = null
    if (bias === 'bearish') {
      simResult = simulateShortTrade(simCandles, entryPrice, slPrice, tpPrice, 300, entryCandle.time)
    } else {
      simResult = simulateLongTrade(simCandles, entryPrice, slPrice, tpPrice, 300, entryCandle.time)
    }
    if (!simResult) continue

    const { outcome, exitPrice: simExit, exitTime } = simResult
    const pnlPoints = bias === 'bearish'
      ? (outcome === 'win' ? entryPrice - simExit : -(simExit - entryPrice))
      : (outcome === 'win' ? simExit - entryPrice : -(entryPrice - simExit))
    const pnlDollars = parseFloat((pnlPoints * multiplier * units).toFixed(2))
    const rrActual   = parseFloat((tpDist / slDist).toFixed(2))

    trades.push({
      id: trades.length + 1, time: entryCandle.time, exitTime, bias,
      entryPrice:  parseFloat(entryPrice.toFixed(4)),
      stopPrice:   parseFloat(slPrice.toFixed(4)),
      targetPrice: parseFloat(tpPrice.toFixed(4)),
      exitPrice:   parseFloat(simExit.toFixed(4)),
      outcome, pnlDollars, rr: rrActual, contracts: units,
      signal: 'IFVG-Mid-Retrace',
    })

    usedIFVGs.add(ifvg.time)
    usedEntryTimes.add(entryCandle.time)
    lastExitTime = exitTime || entryCandle.time
  }

  return trades
}

// ── Strategy B Long: IFVG Midpoint Retrace backtest (long version) ────────────
function runBacktestIFVGMidLong(candles5m, candles1m, symbol, multiplier, killZoneFn = isLongKillZone) {
  const trades = []

  if (!candles5m.length) return trades

  // Find all FVGs, then all IFVGs across full dataset (symbol-aware width)
  const fvgWidth = MIN_FVG_WIDTH[symbol] || DEFAULT_FVG_WIDTH
  const allFVGs  = detectFVGs(candles5m)
  const allIFVGs = detectIFVGs(candles5m, allFVGs, fvgWidth)

  let lastExitTime    = 0
  const usedIFVGs      = new Set()
  const usedEntryTimes = new Set()

  for (const ifvg of allIFVGs) {
    // Must be in kill zone at inversion time
    if (!killZoneFn(ifvg.inversionTime)) continue

    // Find entry: midpoint retrace after inversion
    const entryCandle = findMidRetrace(candles5m, ifvg)
    if (!entryCandle) continue

    // Must be in kill zone at entry time
    if (!killZoneFn(entryCandle.time)) continue

    // Cooldown: 20 min between trades
    if (entryCandle.time <= lastExitTime) continue

    // Dedup
    if (usedIFVGs.has(ifvg.time)) continue
    if (usedEntryTimes.has(entryCandle.time)) continue

    const bias       = ifvg.ifvgBias
    if (bias === 'bearish') continue
    const entryPrice = ifvg.mid

    // ── EMA trend filter ─────────────────────────────────────────────────────
    const entryIdxEma = candles5m.findIndex(c => c.time >= entryCandle.time)
    const emaSliceL = candles5m.slice(Math.max(0, entryIdxEma - EMA_HTF_PERIOD), entryIdxEma + 1)
    if (!trendAligned(emaSliceL, bias)) continue
    if (!htfTrendAligned(emaSliceL, bias)) continue

    // SL: long-specific — wider stops
    let slDist, slPrice
    const fixedSLLong = LONG_FIXED_SL[symbol]
    const slBoundsLong = LONG_SL_BOUNDS[symbol] || DEFAULT_SL_BOUNDS
    if (fixedSLLong != null) {
      slDist = fixedSLLong
    } else {
      slDist = Math.abs(entryPrice - (ifvg.bottom - 3))  // 3pt buffer for longs
      if (slDist < slBoundsLong.min || slDist > slBoundsLong.max) continue
    }
    slPrice = entryPrice - slDist

    // TP: fixed override or dynamic R:R
    let tpPrice
    const fixedTPLong = LONG_FIXED_TP[symbol]
    if (fixedTPLong != null) {
      tpPrice = entryPrice + fixedTPLong
    } else {
      const minRR_sym = LONG_SYMBOL_RR[symbol] || 4
      const minTPDist = slDist * minRR_sym
      const maxTPDist = minTPDist + 30

      const entryIdx = candles5m.findIndex(c => c.time >= entryCandle.time)
      const recent5m = candles5m.slice(Math.max(0, entryIdx - 30), entryIdx + 1)
      const { highs } = detectSwings(recent5m, 3)

      const targets = highs.filter(h => h.price >= entryPrice + minTPDist && h.price <= entryPrice + maxTPDist).sort((a, b) => a.price - b.price)
      tpPrice = targets[0]?.price ?? entryPrice + minTPDist

      const tpDistCheck = Math.abs(tpPrice - entryPrice)
      if (tpDistCheck / slDist < minRR_sym) continue
      if (tpDistCheck / slDist > 16) continue
    }

    if (tpPrice <= entryPrice) continue

    const tpDist = Math.abs(tpPrice - entryPrice)

    // Smart long simulation (TP-first, breakeven, time exit)
    const entryIdx1m = candles1m?.length ? candles1m.findIndex(c => c.time >= entryCandle.time) : -1
    const simCandles = entryIdx1m >= 0 && entryIdx1m < candles1m.length - 1
      ? candles1m.slice(entryIdx1m + 1, entryIdx1m + 400)
      : candles5m.slice(entryIdx + 1, entryIdx + 200)

    const simResult = simulateLongTrade(simCandles, entryPrice, slPrice, tpPrice, 300, entryCandle.time)
    if (!simResult) continue

    const { outcome, exitPrice, exitTime } = simResult
    const units      = UNITS[symbol] || 1
    const actualPnl  = (exitPrice - entryPrice) * multiplier * units
    const rrActual   = parseFloat((tpDist / slDist).toFixed(2))

    trades.push({
      id: trades.length + 1, time: entryCandle.time, exitTime, bias,
      entryPrice:  parseFloat(entryPrice.toFixed(4)),
      stopPrice:   parseFloat(slPrice.toFixed(4)),
      targetPrice: parseFloat(tpPrice.toFixed(4)),
      exitPrice:   parseFloat(exitPrice.toFixed(4)),
      outcome, pnlDollars: parseFloat(actualPnl.toFixed(2)), rr: rrActual, contracts: units,
      signal: 'IFVG-Mid-Retrace',
    })

    usedIFVGs.add(ifvg.time)
    usedEntryTimes.add(entryCandle.time)
    lastExitTime = exitTime || entryCandle.time
  }

  return trades
}

// ── Combined backtest: merge both strategies, dedup aggressively ─────────────
function runBacktest(candles5m, candles1m, symbol) {
  const multiplier = CONTRACT_MULTIPLIER[symbol] || 5

  // Run highest-WR strategies only (removed: Sweep+BOS, 1m-FVG-TapBack)
  const ifvgTrades     = runBacktestIFVGMid(candles5m, candles1m || [], symbol, multiplier)

  // Merge, filter to bearish (SHORT) only, sort by entry time
  const all = [...ifvgTrades]
    .filter(t => t.bias === 'bearish')
    .sort((a, b) => a.time - b.time)

  // No-overlap dedup: can't enter a new trade while the previous one is still active
  const final = []
  const usedTimes = new Set()
  let lastExitTime = 0
  for (const t of all) {
    // Exact time dedup
    if (usedTimes.has(t.time)) continue
    // No overlap — entry must be after previous trade's exit
    if (t.time <= lastExitTime) continue

    t.id = final.length + 1
    final.push(t)
    usedTimes.add(t.time)
    if (t.exitTime) lastExitTime = t.exitTime
  }

  return final
}

// ══════════════════════════════════════════════════════════════════════════════
// FVG RETRACE LONG — ICT Displacement + FVG Discount Entry
//
// The edge: Displacement candles (big body bullish candles) show smart money
// buying aggressively. The FVG left behind is the "discount zone" where
// institutions want to reload. When price retraces to this zone, we enter
// with momentum already confirmed in our direction.
//
// Confluences:
//   1. Bullish displacement (large body candle or 2+ consecutive green candles)
//   2. Bullish FVG created by the displacement (≥3pt gap)
//   3. Price retraces into FVG zone (wicks into or near it)
//   4. Entry on bounce (bullish candle at FVG zone)
//   5. SL below FVG with ATR-based buffer (wide enough for noise)
//   6. TP at displacement high or nearest swing high (price already went there)
// ══════════════════════════════════════════════════════════════════════════════
function runBacktestFVGRetraceLong(candles5m, candles1m, symbol, multiplier) {
  const trades = []
  if (!candles5m.length) return trades

  const units = UNITS[symbol] || 1
  let lastExitTime = 0
  const usedFVGs = new Set()

  // Pre-detect ALL bullish FVGs ≥ 4pt wide
  const allFVGs = detectFVGs(candles5m).filter(f => f.type === 'bullish' && (f.top - f.bottom) >= 4)

  for (const fvg of allFVGs) {
    if (usedFVGs.has(fvg.time)) continue

    const fvgIdx = candles5m.findIndex(c => c.time >= fvg.time)
    if (fvgIdx < 15 || fvgIdx >= candles5m.length - 5) continue

    // Kill zone: 7:00 AM – 3:00 PM ET
    const fvgMins = getETMinutes(fvg.time)
    if (!(fvgMins >= 420 && fvgMins < 900)) continue

    // ── EMA trend filter ─────────────────────────────────────────────────────
    const emaSliceFRL = candles5m.slice(Math.max(0, fvgIdx - EMA_HTF_PERIOD), fvgIdx + 1)
    if (!trendAligned(emaSliceFRL, 'bullish')) continue
    if (!htfTrendAligned(emaSliceFRL, 'bullish')) continue

    // ── CONFLUENCE 1: Displacement confirmation ──────────────────────────────
    // The candles around the FVG must show bullish displacement:
    //   - The FVG candle itself is bullish with body ≥ 30% of range, OR
    //   - 2 of the 3 candles around FVG are bullish
    const fvgCandle = candles5m[fvgIdx]
    const nearby3 = candles5m.slice(Math.max(0, fvgIdx - 1), fvgIdx + 2)
    const bullishCount = nearby3.filter(c => c.close > c.open).length
    const fvgBody = Math.abs(fvgCandle.close - fvgCandle.open)
    const fvgRange = fvgCandle.high - fvgCandle.low
    const hasDisplacement = (fvgCandle.close > fvgCandle.open && fvgRange > 0 && fvgBody / fvgRange >= 0.30) || bullishCount >= 2
    if (!hasDisplacement) continue

    // ── CONFLUENCE 2: Price context — recent price action trending up ────────
    // Simple: close of FVG candle > close from 5 candles ago
    const lb = Math.max(0, fvgIdx - 5)
    if (fvgCandle.close <= candles5m[lb].close) continue

    // ATR for dynamic SL sizing
    const atr = getAvgRange(candles5m.slice(Math.max(0, fvgIdx - 14), fvgIdx + 1))

    // ── CONFLUENCE 3: Price must RISE above FVG top first (confirms the gap) ──
    // Then retrace back into the FVG zone for entry
    const postFVG = candles5m.slice(fvgIdx + 1, Math.min(fvgIdx + 80, candles5m.length))
    let entryCandle = null
    let displacementHigh = fvgCandle.high  // highest point of displacement move
    let fvgConfirmed = false  // price must trade above FVG top first

    for (let k = 0; k < postFVG.length; k++) {
      const c = postFVG[k]
      if (c.high > displacementHigh) displacementHigh = c.high

      // FVG invalidated if candle closes below bottom by more than 1 ATR
      if (c.close < fvg.bottom - atr) break

      // Step 1: Price must push ABOVE the FVG top (confirming the gap is respected)
      if (!fvgConfirmed) {
        if (c.close > fvg.top && c.high > fvg.top + 2) {
          fvgConfirmed = true
        }
        continue  // don't look for retrace until FVG is confirmed higher
      }

      // Step 2: After confirming higher, price retraces BACK into FVG zone
      if (c.low <= fvg.top + 1 && c.low >= fvg.bottom - 1) {
        // Accept if this candle closes bullish (bounce off FVG)
        if (c.close > c.open && c.close > fvg.bottom) {
          entryCandle = c; break
        }
        // Or next candle closes bullish
        if (k + 1 < postFVG.length) {
          const n = postFVG[k + 1]
          if (n.close > n.open && n.close > fvg.bottom) { entryCandle = n; break }
        }
        // Or 2 candles later
        if (k + 2 < postFVG.length) {
          const n = postFVG[k + 2]
          if (n.close > n.open && n.close > fvg.bottom) { entryCandle = n; break }
        }
      }
    }
    if (!entryCandle) continue
    if (entryCandle.time <= lastExitTime) continue

    // ── ENTRY ────────────────────────────────────────────────────────────────
    const entryPrice = entryCandle.close

    // ── SL: below FVG with ATR-based buffer, capped to $300 max loss ────────
    const slBuffer = Math.max(3, atr * 0.8)
    const slPrice = capLongSL(entryPrice, fvg.bottom - slBuffer, symbol)

    // ── TP: displacement high (price already went there once) ────────────────
    // This is the key insight — we're targeting a level price ALREADY hit,
    // so the probability of reaching it again after a healthy retrace is high.
    let tpPrice = displacementHigh

    // Also consider nearest swing high if it's closer
    const entryIdx = candles5m.findIndex(c => c.time >= entryCandle.time)
    const lookback = candles5m.slice(Math.max(0, entryIdx - 40), entryIdx + 1)
    const { highs: swH } = detectSwings(lookback, 2)
    const nearestHigh = swH.filter(h => h.price > entryPrice).sort((a, b) => a.price - b.price)[0]
    if (nearestHigh && nearestHigh.price < tpPrice && nearestHigh.price > entryPrice) {
      tpPrice = nearestHigh.price  // take the closer, more achievable target
    }

    if (tpPrice <= entryPrice) continue

    const slDist = Math.abs(entryPrice - slPrice)
    const tpDist = Math.abs(tpPrice - entryPrice)
    if (slDist <= 0 || tpDist <= 0) continue
    if (tpDist / slDist > 16) continue

    // Fixed TP override or dynamic R:R floor
    const fvgFixedTP = LONG_FIXED_TP[symbol]
    if (fvgFixedTP != null) {
      tpPrice = entryPrice + fvgFixedTP
    } else {
      const fvgMinRR = LONG_SYMBOL_RR[symbol] || 4
      if (tpDist / slDist < fvgMinRR) tpPrice = entryPrice + slDist * fvgMinRR
    }

    const finalTPDist = Math.abs(tpPrice - entryPrice)

    // ── SIMULATE ─────────────────────────────────────────────────────────────
    const ei1m = candles1m.findIndex(c => c.time >= entryCandle.time)
    const fut1m = candles1m.slice(ei1m + 1, ei1m + 500)
    const ei5m = candles5m.findIndex(c => c.time >= entryCandle.time)
    const simCandles = fut1m.length > 0 ? fut1m : candles5m.slice(ei5m + 1, ei5m + 250)

    const simResult = simulateLongTrade(simCandles, entryPrice, slPrice, tpPrice, 300, entryCandle.time)
    if (!simResult) continue

    const { outcome, exitPrice, exitTime } = simResult
    const actualPnl = (exitPrice - entryPrice) * multiplier * units

    trades.push({
      time: entryCandle.time, exitTime, bias: 'bullish',
      entryPrice:  parseFloat(entryPrice.toFixed(4)),
      stopPrice:   parseFloat(slPrice.toFixed(4)),
      targetPrice: parseFloat(tpPrice.toFixed(4)),
      exitPrice:   parseFloat(exitPrice.toFixed(4)),
      outcome, pnlDollars: parseFloat(actualPnl.toFixed(2)),
      contracts: units,
      rr: parseFloat((finalTPDist / slDist).toFixed(2)),
      signal: 'FVG-Retrace-Long',
    })

    usedFVGs.add(fvg.time)
    lastExitTime = exitTime || entryCandle.time
  }

  return trades
}

// ══════════════════════════════════════════════════════════════════════════════
// BULLISH MOMENTUM CONTINUATION — Enter on pullback in strong uptrend
//
// When price shows clear bullish momentum (3+ green candles making higher
// highs), wait for a 1-2 candle pullback, then enter long targeting the
// most recent high. This is a high-probability trend continuation play.
// ══════════════════════════════════════════════════════════════════════════════
function runBacktestMomentumLong(candles5m, candles1m, symbol, multiplier) {
  const trades = []
  if (!candles5m.length) return trades

  const units = UNITS[symbol] || 1
  let lastExitTime = 0

  for (let i = 20; i < candles5m.length - 2; i++) {
    const now = candles5m[i]
    const mins = getETMinutes(now.time)
    if (!(mins >= 420 && mins < 900)) continue
    if (now.time <= lastExitTime) continue

    // 1. Find bullish momentum: 3+ of last 5 candles are bullish with higher highs
    const window5 = candles5m.slice(i - 4, i + 1)
    const greenCount = window5.filter(c => c.close > c.open).length
    if (greenCount < 3) continue

    // Higher highs check: at least 2 consecutive higher highs in window
    let hhCount = 0
    for (let j = 1; j < window5.length; j++) {
      if (window5[j].high > window5[j - 1].high) hhCount++
    }
    if (hhCount < 2) continue

    // 2. Current candle or previous is a pullback (red candle or lower close)
    const isPullback = (now.close < now.open) ||
                       (candles5m[i - 1].close < candles5m[i - 1].open)
    if (!isPullback) continue

    // 3. Pullback didn't break structure — current low is above the low of 3 candles ago
    if (now.low < candles5m[i - 3].low) continue

    // 4. Entry on the next bullish candle after pullback
    const next = candles5m[i + 1]
    if (next.close <= next.open) continue  // need green confirmation
    const entryCandle = next
    const entryPrice = entryCandle.close

    // 5. SL below the pullback low with ATR buffer
    const atr = getAvgRange(candles5m.slice(Math.max(0, i - 14), i + 1))
    const pullbackLow = Math.min(now.low, candles5m[i - 1].low)
    const slPrice = capLongSL(entryPrice, pullbackLow - Math.max(2, atr * 0.5), symbol)

    // 6. TP at the momentum high (price already reached this level)
    const momentumHigh = Math.max(...window5.map(c => c.high))
    let tpPrice = momentumHigh
    if (tpPrice <= entryPrice) tpPrice = entryPrice + atr  // fallback: 1 ATR target

    const slDist = Math.abs(entryPrice - slPrice)
    const tpDist = Math.abs(tpPrice - entryPrice)
    if (slDist <= 0 || tpDist <= 0) continue
    if (tpDist / slDist > 16) continue
    const momFixedTP = LONG_FIXED_TP[symbol]
    if (momFixedTP != null) {
      tpPrice = entryPrice + momFixedTP
    } else {
      const momMinRR = LONG_SYMBOL_RR[symbol] || 4
      if (tpDist / slDist < momMinRR) tpPrice = entryPrice + slDist * momMinRR
    }
    if (tpPrice <= entryPrice) continue

    // Simulate
    const ei5m = candles5m.findIndex(c => c.time >= entryCandle.time)
    const ei1m = candles1m.findIndex(c => c.time >= entryCandle.time)
    const fut1m = candles1m.slice(ei1m + 1, ei1m + 500)
    const simCandles = fut1m.length > 0 ? fut1m : candles5m.slice(ei5m + 1, ei5m + 250)

    const simResult = simulateLongTrade(simCandles, entryPrice, slPrice, tpPrice, 300, entryCandle.time)
    if (!simResult) continue

    const { outcome, exitPrice, exitTime } = simResult
    const actualPnl = (exitPrice - entryPrice) * multiplier * units

    trades.push({
      time: entryCandle.time, exitTime, bias: 'bullish',
      entryPrice:  parseFloat(entryPrice.toFixed(4)),
      stopPrice:   parseFloat(slPrice.toFixed(4)),
      targetPrice: parseFloat(tpPrice.toFixed(4)),
      exitPrice:   parseFloat(exitPrice.toFixed(4)),
      outcome, pnlDollars: parseFloat(actualPnl.toFixed(2)),
      contracts: units,
      rr: parseFloat((tpDist / slDist).toFixed(2)),
      signal: 'Momentum-Pullback-Long',
    })

    lastExitTime = exitTime || entryCandle.time
  }

  return trades
}

// ══════════════════════════════════════════════════════════════════════════════
// STRATEGY C: Uptrend FVG Tap-Back (LONG only)
//
// 1. Detect bullish FVG on 5M in an uptrend (≥2 higher highs + higher lows)
// 2. FVG must be ≥ 4pt wide
// 3. Wait for price to tap back into the FVG zone
// 4. Enter LONG at FVG midpoint on the tap-back candle
// 5. SL/TP are FIXED at entry — they never move once the trade starts
// ══════════════════════════════════════════════════════════════════════════════
const FVG_TAPBACK_MIN_WIDTH = 4

function isUptrendBT(candles, lookback = 6) {
  if (candles.length < lookback) return false
  const recent = candles.slice(-lookback)
  let hh = 0, hl = 0
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].high > recent[i - 1].high) hh++
    if (recent[i].low  > recent[i - 1].low)  hl++
  }
  return hh >= 2 && hl >= 2
}

function detectUptrendFVGsBT(candles, minWidth = FVG_TAPBACK_MIN_WIDTH) {
  const fvgs = []
  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1], next = candles[i + 1]
    if (next.low > prev.high) {
      const width = next.low - prev.high
      if (width < minWidth) continue
      const priorCandles = candles.slice(0, i + 1)
      if (!isUptrendBT(priorCandles, 6)) continue
      fvgs.push({
        type: 'bullish',
        top: next.low,
        bottom: prev.high,
        mid: (next.low + prev.high) / 2,
        width,
        time: candles[i].time,
        index: i,
      })
    }
  }
  return fvgs
}

function findFVGTapBackBT(candles, fvg) {
  for (const c of candles) {
    if (c.time <= fvg.time) continue
    if (c.low <= fvg.top && c.low >= fvg.bottom) return c
    if (c.close < fvg.bottom) return null
  }
  return null
}

function runBacktestFVGTapBack(candles5m, candles1m, symbol, multiplier) {
  const trades = []
  if (!candles5m.length) return trades

  const units = UNITS[symbol] || 1
  let lastExitTime = 0
  const usedFVGs = new Set()
  const usedEntryTimes = new Set()
  const slBounds = LONG_SL_BOUNDS[symbol] || DEFAULT_SL_BOUNDS

  const uptrendFVGs = detectUptrendFVGsBT(candles5m, FVG_TAPBACK_MIN_WIDTH)

  for (const fvg of uptrendFVGs) {
    if (!isKillZone(fvg.time)) continue

    const entryCandle = findFVGTapBackBT(candles5m, fvg)
    if (!entryCandle) continue
    if (!isKillZone(entryCandle.time)) continue
    if (entryCandle.time <= lastExitTime) continue
    if (usedFVGs.has(fvg.time)) continue
    if (usedEntryTimes.has(entryCandle.time)) continue

    const entryPrice = fvg.mid

    // ── EMA trend filter ─────────────────────────────────────────────────────
    const tapEntryIdx = candles5m.findIndex(c => c.time >= entryCandle.time)
    const emaSliceTB = candles5m.slice(Math.max(0, tapEntryIdx - EMA_HTF_PERIOD), tapEntryIdx + 1)
    if (!trendAligned(emaSliceTB, 'bullish')) continue
    if (!htfTrendAligned(emaSliceTB, 'bullish')) continue

    // SL below FVG bottom + buffer — FIXED, never moves
    let slDist, slPrice
    const fixedSL = LONG_FIXED_SL[symbol]
    if (fixedSL != null) {
      slDist = fixedSL
    } else {
      slDist = Math.abs(entryPrice - (fvg.bottom - 2))
      if (slDist < slBounds.min || slDist > slBounds.max) continue
    }
    slPrice = entryPrice - slDist

    // TP: fixed override or dynamic R:R — FIXED at entry, never moves
    let tpPrice
    const tapFixedTP = LONG_FIXED_TP[symbol]
    if (tapFixedTP != null) {
      tpPrice = entryPrice + tapFixedTP
    } else {
      const rr = LONG_SYMBOL_RR[symbol] || 4
      const minTPDist = slDist * rr
      const maxTPDist = minTPDist + 30

      const entryIdx = candles5m.findIndex(c => c.time >= entryCandle.time)
      const recent5m = candles5m.slice(Math.max(0, entryIdx - 30), entryIdx + 1)
      const { highs } = detectSwings(recent5m, 3)

      const targets = highs.filter(h => h.price >= entryPrice + minTPDist && h.price <= entryPrice + maxTPDist).sort((a, b) => a.price - b.price)
      tpPrice = targets[0]?.price ?? entryPrice + minTPDist

      const tpDistCheck = Math.abs(tpPrice - entryPrice)
      if (tpDistCheck / slDist < rr) continue
      if (tpDistCheck / slDist > 16) continue
    }

    if (tpPrice <= entryPrice) continue
    const tpDist = Math.abs(tpPrice - entryPrice)

    // Simulate with FIXED SL/TP — no trailing, no adjustment
    const ei1m = candles1m.findIndex(c => c.time >= entryCandle.time)
    const fut1m = candles1m.slice(ei1m + 1, ei1m + 500)
    const ei5m = candles5m.findIndex(c => c.time >= entryCandle.time)
    const simCandles = fut1m.length > 0 ? fut1m : candles5m.slice(ei5m + 1, ei5m + 250)

    const simResult = simulateLongTrade(simCandles, entryPrice, slPrice, tpPrice, 300, entryCandle.time)
    if (!simResult) continue

    const { outcome, exitPrice, exitTime } = simResult
    const actualPnl = (exitPrice - entryPrice) * multiplier * units

    trades.push({
      time: entryCandle.time, exitTime, bias: 'bullish',
      entryPrice:  parseFloat(entryPrice.toFixed(4)),
      stopPrice:   parseFloat(slPrice.toFixed(4)),
      targetPrice: parseFloat(tpPrice.toFixed(4)),
      exitPrice:   parseFloat(exitPrice.toFixed(4)),
      outcome, pnlDollars: parseFloat(actualPnl.toFixed(2)),
      contracts: units,
      rr: parseFloat((tpDist / slDist).toFixed(2)),
      signal: 'Uptrend-FVG-TapBack',
    })

    usedFVGs.add(fvg.time)
    usedEntryTimes.add(entryCandle.time)
    lastExitTime = exitTime || entryCandle.time
  }

  return trades
}

// ══════════════════════════════════════════════════════════════════════════════
// STRATEGY D — 1m FVG Tap-Back (Both Directions)
//
// The edge: Large FVGs on the 1-minute chart (≥4 units wide) represent
// aggressive institutional moves. When price retraces away from the FVG
// and then taps back into it, that's the institution reloading at their
// preferred price level.
//
// Logic:
//   1. Detect FVGs on 1m candles ≥ 4 units wide (bullish or bearish)
//   2. Bearish FVG: wait for price to retrace UP past the FVG top,
//      then tap back DOWN into the FVG zone → SHORT at FVG midpoint
//   3. Bullish FVG: wait for price to retrace DOWN past the FVG bottom,
//      then tap back UP into the FVG zone → LONG at FVG midpoint
//   4. Fixed SL/TP at entry — never moves
// ══════════════════════════════════════════════════════════════════════════════

// Min 1m FVG width per symbol — MGC = 4pt, MES = 4pt, MNQ = 10pt
const MIN_1M_FVG_WIDTH = { 'MES1!': 4, 'MNQ1!': 10, 'MGC1!': 4 }

function runBacktest1mFVGTapBack(candles5m, candles1m, symbol, multiplier) {
  const trades = []
  if (!candles1m || !candles1m.length) return trades

  const units = UNITS[symbol] || 1
  const minWidth = MIN_1M_FVG_WIDTH[symbol] || 4
  let lastExitTime = 0
  const usedFVGs = new Set()
  const usedEntryTimes = new Set()

  // Detect all 1m FVGs ≥ min width for this symbol
  const allFVGs = detectFVGs(candles1m).filter(f => (f.top - f.bottom) >= minWidth)

  for (const fvg of allFVGs) {
    if (usedFVGs.has(fvg.time)) continue
    if (!isKillZone(fvg.time)) continue

    const fvgIdx = candles1m.findIndex(c => c.time >= fvg.time)
    if (fvgIdx < 5 || fvgIdx >= candles1m.length - 5) continue

    // Look for tap-back: price must first move AWAY from FVG, then come back
    const postFVG = candles1m.slice(fvgIdx + 1, Math.min(fvgIdx + 120, candles1m.length))  // ~2hrs of 1m
    if (!postFVG.length) continue

    let movedAway = false
    let entryCandle = null
    const bias = fvg.type  // bullish FVG → long, bearish FVG → short

    for (const c of postFVG) {
      if (bias === 'bearish') {
        // Bearish FVG: price must retrace UP past FVG top first
        if (c.high > fvg.top) movedAway = true
        // Then tap back DOWN into the FVG zone (high dips into or through)
        if (movedAway && c.low <= fvg.top && c.low >= fvg.bottom) {
          entryCandle = c
          break
        }
      } else {
        // Bullish FVG: price must retrace DOWN past FVG bottom first
        if (c.low < fvg.bottom) movedAway = true
        // Then tap back UP into the FVG zone (low rises into or through)
        if (movedAway && c.high >= fvg.bottom && c.high <= fvg.top) {
          entryCandle = c
          break
        }
      }
    }

    if (!entryCandle) continue
    if (!isKillZone(entryCandle.time)) continue
    if (entryCandle.time <= lastExitTime) continue
    if (usedEntryTimes.has(entryCandle.time)) continue

    const entryPrice = fvg.mid

    // ── EMA trend filter ─────────────────────────────────────────────────────
    // Find nearest 5m candle for EMA calculation
    const nearest5mIdx = candles5m.findLastIndex(c => c.time <= entryCandle.time)
    if (nearest5mIdx >= 0) {
      const emaSlice1m = candles5m.slice(Math.max(0, nearest5mIdx - EMA_HTF_PERIOD), nearest5mIdx + 1)
      if (!trendAligned(emaSlice1m, bias)) continue
    if (!htfTrendAligned(emaSlice1m, bias)) continue
    }

    // SL: use fixed SL per symbol or FVG-based
    let slDist, slPrice
    if (bias === 'bearish') {
      const fixedSLVal = FIXED_SL[symbol]
      if (fixedSLVal != null) {
        slDist = fixedSLVal
      } else {
        slDist = Math.abs(fvg.top - entryPrice) + 2  // above FVG top + buffer
        const slB = SL_BOUNDS[symbol] || DEFAULT_SL_BOUNDS
        if (slDist < slB.min) slDist = slB.min
        if (slDist > slB.max) continue
      }
      slPrice = entryPrice + slDist
    } else {
      const fixedSLVal = LONG_FIXED_SL[symbol]
      if (fixedSLVal != null) {
        slDist = fixedSLVal
      } else {
        slDist = Math.abs(entryPrice - fvg.bottom) + 2  // below FVG bottom + buffer
        const slB = LONG_SL_BOUNDS[symbol] || DEFAULT_SL_BOUNDS
        if (slDist < slB.min) slDist = slB.min
        if (slDist > slB.max) continue
      }
      slPrice = entryPrice - slDist
    }

    // TP: fixed override or dynamic R:R with swing-level targeting
    let tpPrice
    if (bias === 'bearish') {
      const fixedTPVal = FIXED_TP[symbol]
      if (fixedTPVal != null) {
        tpPrice = entryPrice - fixedTPVal
      } else {
        const rr = SYMBOL_RR[symbol] || MIN_RR
        const minTPDist = slDist * rr
        const maxTPDist = minTPDist + 30
        // Find nearest swing low in the TP search window
        const ei5m = candles5m.findIndex(c => c.time >= entryCandle.time)
        const recent5m = candles5m.slice(Math.max(0, ei5m - 30), ei5m + 1)
        const { lows } = detectSwings(recent5m, 3)
        const targets = lows.filter(l => l.price <= entryPrice - minTPDist && l.price >= entryPrice - maxTPDist).sort((a, b) => b.price - a.price)
        tpPrice = targets[0]?.price ?? entryPrice - minTPDist
        const tpDistCheck = Math.abs(tpPrice - entryPrice)
        if (tpDistCheck / slDist < rr) continue
      }
    } else {
      const fixedTPVal = LONG_FIXED_TP[symbol]
      if (fixedTPVal != null) {
        tpPrice = entryPrice + fixedTPVal
      } else {
        const rr = LONG_SYMBOL_RR[symbol] || 4
        const minTPDist = slDist * rr
        const maxTPDist = minTPDist + 30
        // Find nearest swing high in the TP search window
        const ei5m = candles5m.findIndex(c => c.time >= entryCandle.time)
        const recent5m = candles5m.slice(Math.max(0, ei5m - 30), ei5m + 1)
        const { highs } = detectSwings(recent5m, 3)
        const targets = highs.filter(h => h.price >= entryPrice + minTPDist && h.price <= entryPrice + maxTPDist).sort((a, b) => a.price - b.price)
        tpPrice = targets[0]?.price ?? entryPrice + minTPDist
        const tpDistCheck = Math.abs(tpPrice - entryPrice)
        if (tpDistCheck / slDist < rr) continue
      }
    }

    if (bias === 'bullish' && tpPrice <= entryPrice) continue
    if (bias === 'bearish' && tpPrice >= entryPrice) continue

    const tpDist = Math.abs(tpPrice - entryPrice)
    if (slDist === 0 || tpDist <= 0) continue

    // Simulate trade on 1m candles
    const simStart = candles1m.findIndex(c => c.time >= entryCandle.time)
    const simCandles = candles1m.slice(simStart + 1, simStart + 500)

    let simResult
    if (bias === 'bearish') {
      simResult = simulateShortTrade(simCandles, entryPrice, slPrice, tpPrice, 300, entryCandle.time)
    } else {
      simResult = simulateLongTrade(simCandles, entryPrice, slPrice, tpPrice, 300, entryCandle.time)
    }
    if (!simResult) continue

    const { outcome, exitPrice, exitTime } = simResult
    const pnlPoints = bias === 'bearish'
      ? (outcome === 'win' ? entryPrice - exitPrice : -(exitPrice - entryPrice))
      : (outcome === 'win' ? exitPrice - entryPrice : -(entryPrice - exitPrice))
    const pnlDollars = parseFloat((pnlPoints * multiplier * units).toFixed(2))

    trades.push({
      time: entryCandle.time, exitTime, bias,
      entryPrice:  parseFloat(entryPrice.toFixed(4)),
      stopPrice:   parseFloat(slPrice.toFixed(4)),
      targetPrice: parseFloat(tpPrice.toFixed(4)),
      exitPrice:   parseFloat(exitPrice.toFixed(4)),
      outcome, pnlDollars, contracts: units,
      rr: parseFloat((tpDist / slDist).toFixed(2)),
      signal: '1m-FVG-TapBack',
    })

    usedFVGs.add(fvg.time)
    usedEntryTimes.add(entryCandle.time)
    lastExitTime = exitTime || entryCandle.time
  }

  return trades
}

// ── Combined backtest (long version): Sweep+BOS + IFVG + Uptrend FVG Tap-Back + 1m FVG Tap-Back
function runBacktestLong(candles5m, candles1m, symbol) {
  const multiplier = CONTRACT_MULTIPLIER[symbol] || 5

  // Run highest-WR strategies only (removed: Sweep+BOS, 1m-FVG-TapBack)
  const ifvgTrades     = runBacktestIFVGMid(candles5m, candles1m || [], symbol, multiplier)
  const tapBackTrades  = runBacktestFVGTapBack(candles5m, candles1m || [], symbol, multiplier)

  // Filter to only bullish (LONG) trades
  const allLong = [...ifvgTrades, ...tapBackTrades]
    .filter(t => t.bias === 'bullish')
    .sort((a, b) => a.time - b.time)

  // Dedup: no overlapping trades — new trade can't start until previous trade exits
  const final = []
  const usedTimes = new Set()
  let lastExitTime = 0

  for (const t of allLong) {
    if (usedTimes.has(t.time)) continue
    if (t.time <= lastExitTime) continue

    t.id = final.length + 1
    final.push(t)
    usedTimes.add(t.time)
    if (t.exitTime) lastExitTime = t.exitTime
  }

  return final
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Content-Type', 'application/json')

  const { symbol, side } = req.query
  const sideParam = (side || 'short').toLowerCase()
  const ticker = SYMBOL_MAP[symbol?.toUpperCase()] || SYMBOL_MAP[symbol]
  if (!ticker) return res.status(400).json({ error: `Unknown symbol: ${symbol}` })

  try {
    // Load CSV historical data + Yahoo Finance recent data, merge them
    const sym = symbol?.toUpperCase() || symbol
    const csvCandles = loadCSVCandles(sym)
    const [yahoo5m, yahoo1m] = await Promise.all([
      fetch5mChunked(ticker),
      fetch1mRecent(ticker),
    ])
    const candles5m = mergeCandles(csvCandles, yahoo5m)

    // For 1m data: use Yahoo 1m where available, synthesize from CSV 5m for older data
    // Only synthesize for the CSV date range that Yahoo 1m doesn't cover
    const yahoo1mStart = yahoo1m.length ? yahoo1m[0].time : Infinity
    const olderCSV = csvCandles.filter(c => c.time < yahoo1mStart)
    const synthetic1m = olderCSV.length ? synthesize1mFrom5m(olderCSV) : []
    const candles1m = mergeCandles(synthetic1m, yahoo1m)

    // Route to symbol-specific strategy
    let trades
    if (sideParam === 'long') {
      // Long backtest — mirrors SHORT strategy (Sweep+BOS + IFVG), filtered to bullish
      if (symbol === 'MGC1!') {
        // MGC Long: HTF Bias + IFVG Mid + Uptrend FVG Tap-Back + 1m FVG Tap-Back
        const htfTrades     = runBacktestMGC(candles5m)
        const ifvgTrades    = runBacktestIFVGMid(candles5m, candles1m, 'MGC1!', CONTRACT_MULTIPLIER['MGC1!'], isMGCKillZone)
        const tapBackTrades = runBacktestFVGTapBack(candles5m, candles1m || [], 'MGC1!', CONTRACT_MULTIPLIER['MGC1!'])
        const allMGC = [...htfTrades, ...ifvgTrades, ...tapBackTrades]
          .filter(t => t.bias === 'bullish')
          .sort((a, b) => a.time - b.time)
        // Dedup: no overlapping trades
        trades = []
        const usedTimesL = new Set()
        let mgcLastExit = 0
        for (const t of allMGC) {
          if (usedTimesL.has(t.time)) continue
          if (t.time <= mgcLastExit) continue
          t.id = trades.length + 1
          trades.push(t)
          usedTimesL.add(t.time)
          if (t.exitTime) mgcLastExit = t.exitTime
        }
      } else {
        trades = runBacktestLong(candles5m, candles1m, symbol)
      }
    } else {
      // Short backtest (default)
      if (symbol === 'MGC1!') {
        // MGC: HTF Bias + IFVG Mid Retrace, merged with dedup
        const htfTrades   = runBacktestMGC(candles5m)
        const ifvgTrades  = runBacktestIFVGMid(candles5m, candles1m, 'MGC1!', CONTRACT_MULTIPLIER['MGC1!'], isMGCKillZone)

        const all = [...htfTrades, ...ifvgTrades]
          .filter(t => t.bias === 'bearish')
          .sort((a, b) => a.time - b.time)
        trades = []
        const usedTimes = new Set()
        let mgcShortLastExit = 0
        for (const t of all) {
          if (usedTimes.has(t.time)) continue
          if (t.time <= mgcShortLastExit) continue
          t.id = trades.length + 1
          trades.push(t)
          usedTimes.add(t.time)
          if (t.exitTime) mgcShortLastExit = t.exitTime
        }
      } else {
        trades = runBacktest(candles5m, candles1m, symbol)
      }
    }

    const wins       = trades.filter(t => t.outcome === 'win').length
    const losses     = trades.filter(t => t.outcome === 'loss').length
    const breakevens = trades.filter(t => t.outcome === 'breakeven').length
    // Win rate excludes breakevens from both numerator and denominator
    const decided    = wins + losses
    const winRate    = decided ? ((wins / decided) * 100).toFixed(1) : '0.0'
    const totalPnl = trades.reduce((s, t) => s + t.pnlDollars, 0)

    const earliest = candles5m.length ? new Date(candles5m[0].time * 1000).toISOString().split('T')[0] : null
    const latest   = candles5m.length ? new Date(candles5m[candles5m.length - 1].time * 1000).toISOString().split('T')[0] : null
    const csvCount = csvCandles.length
    const dataNote = `5m: ${earliest} → ${latest} (${candles5m.length} candles${csvCount ? `, ${csvCount} from CSV` : ''}) | 1m: ${candles1m.length} candles${synthetic1m.length ? ` (${synthetic1m.length} synthetic)` : ''}`

    res.setHeader('Cache-Control', 's-maxage=60')
    return res.status(200).json({
      symbol, side: sideParam, trades, wins, losses, breakevens, winRate, totalPnl, dataNote,
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}