// ─────────────────────────────────────────────────────────────────────────────
// Backtest Engine: Daily H/L Liquidity Sweep + BOS + 1M IFVG Entry
// High-probability filter: kill zones only, BOTH confluences required in order
// ─────────────────────────────────────────────────────────────────────────────

const SYMBOL_MAP = {
  'MES1!': 'MES=F',
  'MNQ1!': 'MNQ=F',
  'MGC1!': 'MGC=F',
  'Sl1!':  'SIL=F',
}

const CONTRACT_MULTIPLIER = { 'MES1!': 5, 'MNQ1!': 2, 'MGC1!': 10, 'Sl1!': 5 }
const MIN_RR = 2

// ── Data fetching ─────────────────────────────────────────────────────────────
async function fetchTF(ticker, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=false`
  try {
    const res  = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    const data = await res.json()
    return parseCandles(data)
  } catch { return [] }
}

// Fetch 6 months of 5m data in 3 chunks (Yahoo Finance max is 60d per request)
async function fetch5mChunked(ticker) {
  const now      = Math.floor(Date.now() / 1000)
  const chunkSec = 60 * 24 * 60 * 60 // 60 days
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

// Fetch 7 days of 1m data from Yahoo Finance
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

// ── Time helpers ──────────────────────────────────────────────────────────────
function getETDateStr(ts) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ts * 1000))
}

// Returns minutes since midnight ET
function getETMinutes(ts) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(new Date(ts * 1000))
  const h = parseInt(parts.find(p => p.type === 'hour').value)
  const m = parseInt(parts.find(p => p.type === 'minute').value)
  return h * 60 + m
}

// Kill zones: London open (3-5am ET) and NY open (9:30-11:30am ET)
// These are the only times ICT setups have institutional backing
export function isKillZone(ts) {
  const mins = getETMinutes(ts)
  return (mins >= 180 && mins < 300) ||   // London: 3:00–5:00 AM ET
         (mins >= 570 && mins < 690)      // NY open: 9:30–11:30 AM ET
}

// ── Strategy primitives ───────────────────────────────────────────────────────

// Build daily H/L map from 5m candles
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
  const prev = days[idx - 1]
  return { ...dailyHL[prev], date: prev }
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

// IFVG entry: first candle that closes back through the FVG after retracing into it
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

function bsFloor(candles, t) {
  let lo = 0, hi = candles.length - 1, idx = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (candles[mid].time <= t) { idx = mid; lo = mid + 1 }
    else hi = mid - 1
  }
  return idx
}

// ── SL/TP ─────────────────────────────────────────────────────────────────────
// SL: just beyond the sweep wick (2pt buffer) — natural invalidation level
// TP: nearest swing high/low in 50–70pt window, default 60pt
function getTPSL(bias, entryPrice, sweepWickExtreme, recent5m) {
  // SL at the sweep wick with a 2pt buffer (tighter, but logical)
  const slPrice = bias === 'bullish'
    ? sweepWickExtreme - 2
    : sweepWickExtreme + 2

  const slDist = Math.abs(entryPrice - slPrice)
  // If entry has already moved far past the sweep, SL would be too wide — skip
  if (slDist > 60) return null

  const { highs, lows } = detectSwings(recent5m, 3)
  let tpPrice = null

  if (bias === 'bullish') {
    const candidates = highs
      .filter(h => h.price > entryPrice + 50 && h.price <= entryPrice + 70)
      .sort((a, b) => a.price - b.price)
    tpPrice = candidates[0]?.price ?? entryPrice + 60
  } else {
    const candidates = lows
      .filter(l => l.price < entryPrice - 50 && l.price >= entryPrice - 70)
      .sort((a, b) => b.price - a.price)
    tpPrice = candidates[0]?.price ?? entryPrice - 60
  }

  return { slPrice, tpPrice }
}

// ── Main backtest ─────────────────────────────────────────────────────────────
function runBacktest(candles5m, candles1m, symbol) {
  const multiplier = CONTRACT_MULTIPLIER[symbol] || 5
  const trades     = []

  if (!candles5m.length || !candles1m.length) return trades

  const dailyHL = buildDailyHL(candles5m)
  let lastTradeTime = 0

  for (let i = 20; i < candles5m.length - 1; i++) {
    const now5m    = candles5m[i]
    const recent5m = candles5m.slice(Math.max(0, i - 30), i + 1)

    // ── Kill zone filter: only trade London and NY open ──────────────────────
    if (!isKillZone(now5m.time)) continue

    // ── Cooldown ─────────────────────────────────────────────────────────────
    if (now5m.time - lastTradeTime < 3600) continue

    const pdhl = getPrevDayHL(dailyHL, now5m.time)
    if (!pdhl) continue

    // ── Confluence 1: Daily H/L sweep (REQUIRED) ─────────────────────────────
    // Must find a sweep within the last 30 candles (~2.5 hours)
    let sweepBias = null, sweepWickExtreme = null, sweepTime = null
    for (let j = recent5m.length - 1; j >= 0; j--) {
      const c = recent5m[j]
      if (c.low < pdhl.low && c.close > pdhl.low) {
        sweepBias = 'bullish'; sweepWickExtreme = c.low; sweepTime = c.time; break
      }
      if (c.high > pdhl.high && c.close < pdhl.high) {
        sweepBias = 'bearish'; sweepWickExtreme = c.high; sweepTime = c.time; break
      }
    }
    if (!sweepBias) continue  // no sweep = no trade

    // ── Confluence 2: BOS on 5M AFTER the sweep (REQUIRED) ──────────────────
    // Only look at candles that came AFTER the sweep candle
    const postSweep5m = recent5m.filter(c => c.time > sweepTime)
    if (postSweep5m.length < 4) continue

    const { highs: h5, lows: l5 } = detectSwings(postSweep5m, 2)
    const bosList = detectBOS(postSweep5m, h5, l5).filter(b => b.type === sweepBias)
    if (!bosList.length) continue  // no BOS after sweep = no trade

    const latestBOS = bosList[bosList.length - 1]

    // Both confluences confirmed in the same direction
    const bias = sweepBias

    // ── Entry: 1M FVG + IFVG after BOS ──────────────────────────────────────
    const m1After = candles1m.filter(c => c.time >= latestBOS.time && c.time <= now5m.time + 300)
    if (m1After.length < 5) continue

    const fvgs1m = detectFVGs(m1After).filter(f => f.type === bias)
    if (!fvgs1m.length) continue
    const fvg1m = fvgs1m[fvgs1m.length - 1]
    if (fvg1m.top - fvg1m.bottom < 7) continue  // must be at least 7pts wide

    const m1PostFVG   = m1After.filter(c => c.time > fvg1m.time)
    const entryCandle = findIFVGEntry(m1PostFVG, fvg1m, bias)
    if (!entryCandle) continue

    const entryPrice = entryCandle.close

    // ── SL / TP ──────────────────────────────────────────────────────────────
    const tpsl = getTPSL(bias, entryPrice, sweepWickExtreme, recent5m)
    if (!tpsl) continue
    const { slPrice, tpPrice } = tpsl

    if (bias === 'bullish' && tpPrice <= entryPrice) continue
    if (bias === 'bearish' && tpPrice >= entryPrice) continue

    const slDist = Math.abs(entryPrice - slPrice)
    const tpDist = Math.abs(tpPrice - entryPrice)
    if (slDist === 0 || tpDist <= 0) continue
    if (tpDist / slDist < MIN_RR) continue  // enforce minimum 2:1 RR

    // ── Simulate on 5M ───────────────────────────────────────────────────────
    const entryIdx = bsFloor(candles5m, entryCandle.time)
    const future5m = candles5m.slice(entryIdx + 1, entryIdx + 200)
    let outcome = null, exitPrice = null, exitTime = null

    for (const fc of future5m) {
      if (bias === 'bullish') {
        if (fc.low  <= slPrice) { outcome = 'loss'; exitPrice = slPrice; exitTime = fc.time; break }
        if (fc.high >= tpPrice) { outcome = 'win';  exitPrice = tpPrice; exitTime = fc.time; break }
      } else {
        if (fc.high >= slPrice) { outcome = 'loss'; exitPrice = slPrice; exitTime = fc.time; break }
        if (fc.low  <= tpPrice) { outcome = 'win';  exitPrice = tpPrice; exitTime = fc.time; break }
      }
    }

    if (!outcome) continue

    const pnlPoints  = outcome === 'win' ? tpDist : -slDist
    const pnlDollars = parseFloat((pnlPoints * multiplier).toFixed(2))
    const rr         = parseFloat((tpDist / slDist).toFixed(2))

    trades.push({
      id: trades.length + 1, time: entryCandle.time, exitTime, bias,
      entryPrice:  parseFloat(entryPrice.toFixed(4)),
      stopPrice:   parseFloat(slPrice.toFixed(4)),
      targetPrice: parseFloat(tpPrice.toFixed(4)),
      exitPrice:   parseFloat(exitPrice.toFixed(4)),
      outcome, pnlDollars, rr,
      signal: 'Sweep+BOS+1mIFVG',
    })

    lastTradeTime = now5m.time
    i += 10
  }

  return trades
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Content-Type', 'application/json')

  const { symbol } = req.query
  const ticker = SYMBOL_MAP[symbol?.toUpperCase()] || SYMBOL_MAP[symbol]
  if (!ticker) return res.status(400).json({ error: `Unknown symbol: ${symbol}` })

  try {
    const [candles5m, candles1m] = await Promise.all([
      fetch5mChunked(ticker),
      fetch1mRecent(ticker),
    ])

    const trades   = runBacktest(candles5m, candles1m, symbol)
    const wins     = trades.filter(t => t.outcome === 'win').length
    const losses   = trades.filter(t => t.outcome === 'loss').length
    const winRate  = trades.length ? ((wins / trades.length) * 100).toFixed(1) : '0.0'
    const totalPnl = trades.reduce((s, t) => s + t.pnlDollars, 0)

    const earliest = candles5m.length ? new Date(candles5m[0].time * 1000).toISOString().split('T')[0] : null
    const latest   = candles5m.length ? new Date(candles5m[candles5m.length - 1].time * 1000).toISOString().split('T')[0] : null
    const dataNote = `5m: ${earliest} → ${latest} | 1m: Yahoo 7d (${candles1m.length} candles)`

    res.setHeader('Cache-Control', 's-maxage=3600')
    return res.status(200).json({
      symbol, trades, wins, losses, winRate, totalPnl, dataNote,
      candles5m, candles1m,
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
