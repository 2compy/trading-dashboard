// ─────────────────────────────────────────────────────────────────────────────
// Backtest Engine
//   MGC1!  → HTF Bias + 4h/1h clean FVG check + 5m FVG + 5m BOS confirm
//   Others → Daily H/L Sweep + BOS (after sweep) + 5m entry
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

// ── Time helpers ──────────────────────────────────────────────────────────────
function getETDateStr(ts) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ts * 1000))
}

function getETMinutes(ts) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(new Date(ts * 1000))
  const h = parseInt(parts.find(p => p.type === 'hour').value)
  const m = parseInt(parts.find(p => p.type === 'minute').value)
  return h * 60 + m
}

// Kill zones: London (3-5am ET), NY open (8:30am-12pm ET), NY PM (1:30-3pm ET)
function isKillZone(ts) {
  const mins = getETMinutes(ts)
  return (mins >= 180 && mins < 300) ||
         (mins >= 510 && mins < 720) ||
         (mins >= 810 && mins < 900)
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

// ── Session H/L (current day's H/L from earlier candles) ─────────────────────
function getSessionHL(candles5m, nowTs) {
  const todayStr = getETDateStr(nowTs)
  const todayCandles = candles5m.filter(c => getETDateStr(c.time) === todayStr)
  if (todayCandles.length <= 5) return null
  const sessionCandles = todayCandles.slice(0, -3)
  let high = -Infinity, low = Infinity
  for (const c of sessionCandles) {
    if (c.high > high) high = c.high
    if (c.low  < low)  low  = c.low
  }
  return { high, low }
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

// ── SL/TP for default strategy ────────────────────────────────────────────────
function getTPSL(bias, entryPrice, sweepWickExtreme, recent5m) {
  let slPrice = bias === 'bullish' ? sweepWickExtreme - 2 : sweepWickExtreme + 2
  if (bias === 'bullish' && entryPrice - slPrice < 15) slPrice = entryPrice - 15
  if (bias === 'bearish' && slPrice - entryPrice < 15) slPrice = entryPrice + 15
  const slDist = Math.abs(entryPrice - slPrice)
  if (slDist > 30) return null

  const { highs, lows } = detectSwings(recent5m, 3)
  let tpPrice
  if (bias === 'bullish') {
    const c = highs.filter(h => h.price > entryPrice + 50 && h.price <= entryPrice + 70).sort((a, b) => a.price - b.price)
    tpPrice = c[0]?.price ?? entryPrice + 60
  } else {
    const c = lows.filter(l => l.price < entryPrice - 50 && l.price >= entryPrice - 70).sort((a, b) => b.price - a.price)
    tpPrice = c[0]?.price ?? entryPrice - 60
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
  let lastTradeTime = 0
  const usedFVGs   = new Set()  // prevent same FVG from firing more than once

  for (let i = 20; i < candles5m.length - 1; i++) {
    const now5m    = candles5m[i]
    const recent5m = candles5m.slice(Math.max(0, i - 36), i + 1)  // ~3hrs of 5m

    if (!isMGCKillZone(now5m.time)) continue
    if (now5m.time - lastTradeTime < 1200) continue

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

    // ── TP at nearest 1h swing H/L beyond current price ──────────────────────
    let tpPrice = null
    if (bias === 'bullish') {
      const cands = h1h.filter(h => h.price > now5m.close).sort((a, b) => a.price - b.price)
      tpPrice = cands[0]?.price
    } else {
      const cands = l1h.filter(l => l.price < now5m.close).sort((a, b) => b.price - a.price)
      tpPrice = cands[0]?.price
    }
    if (!tpPrice) continue

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
    usedFVGs.add(fvg5m.time)
    const entryPrice = fvg5m.mid

    // ── SL: $200 risk per contract. MGC multiplier = 10, so 200/10 = 20 points
    const slPrice = bias === 'bullish' ? entryPrice - 20 : entryPrice + 20

    if (bias === 'bullish' && tpPrice <= entryPrice) continue
    if (bias === 'bearish' && tpPrice >= entryPrice) continue

    const slDist = 20
    const tpDist = Math.abs(tpPrice - entryPrice)
    if (tpDist / slDist < MIN_RR) continue

    // ── Simulate on 5m ───────────────────────────────────────────────────────
    const entryIdx = candles5m.indexOf(entryCandle)
    const future5m = candles5m.slice(entryIdx + 1, entryIdx + 300)
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
    const pnlDollars = parseFloat((pnlPoints * multiplier).toFixed(2))  // 1 contract
    const rr         = parseFloat((tpDist / slDist).toFixed(2))

    trades.push({
      id: trades.length + 1, time: entryCandle.time, exitTime, bias,
      entryPrice:  parseFloat(entryPrice.toFixed(4)),
      stopPrice:   parseFloat(slPrice.toFixed(4)),
      targetPrice: parseFloat(tpPrice.toFixed(4)),
      exitPrice:   parseFloat(exitPrice.toFixed(4)),
      outcome, pnlDollars, rr, contracts: 1,
      signal: 'HTFBias+4h/1hClean+5mFVG+MidRetrace',
    })

    lastTradeTime = now5m.time
  }

  return trades
}

// ── Default strategy (MES1!, MNQ1!, Sl1!) ────────────────────────────────────
function runBacktest(candles5m, candles1m, symbol) {
  const multiplier = CONTRACT_MULTIPLIER[symbol] || 5
  const trades     = []

  if (!candles5m.length || !candles1m.length) return trades

  const dailyHL = buildDailyHL(candles5m)
  let lastTradeTime = 0

  // Only iterate 5m candles that fall within the 1m data range
  const m1Start = candles1m.length ? candles1m[0].time : 0

  for (let i = 20; i < candles5m.length - 1; i++) {
    const now5m    = candles5m[i]
    const recent5m = candles5m.slice(Math.max(0, i - 30), i + 1)

    if (now5m.time < m1Start) continue
    if (!isKillZone(now5m.time)) continue
    if (now5m.time - lastTradeTime < 1200) continue

    const pdhl = getPrevDayHL(dailyHL, now5m.time)

    // Confluence 1: Daily H/L sweep OR session H/L sweep
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
      const sessionHL = getSessionHL(candles5m, now5m.time)
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

    // Confluence 2: BOS on 5m AFTER the sweep, same direction (required)
    const postSweep5m = recent5m.filter(c => c.time > sweepTime)
    if (postSweep5m.length < 3) continue
    const { highs: h5, lows: l5 } = detectSwings(postSweep5m, 2)
    const bosList = detectBOS(postSweep5m, h5, l5).filter(b => b.type === sweepBias)
    if (!bosList.length) continue
    const latestBOS = bosList[bosList.length - 1]

    const bias = sweepBias

    // Entry: try 1M FVG + IFVG retrace, fall back to 5m BOS candle
    let entryCandle = null, entryPrice = null, entrySignal = 'Sweep+BOS'

    const m1After = candles1m.filter(c => c.time >= latestBOS.time && c.time <= latestBOS.time + 7200)
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

    // Fallback: enter on next 5m candle open after BOS
    if (!entryCandle) {
      const bosIdx = candles5m.findIndex(c => c.time >= latestBOS.time)
      entryCandle  = bosIdx >= 0 ? candles5m[bosIdx + 1] : null
      if (!entryCandle) continue
      entryPrice = entryCandle.open
    }

    // SL/TP
    const tpsl = getTPSL(bias, entryPrice, sweepWickExtreme, recent5m)
    if (!tpsl) continue
    const { slPrice, tpPrice } = tpsl

    if (bias === 'bullish' && tpPrice <= entryPrice) continue
    if (bias === 'bearish' && tpPrice >= entryPrice) continue

    const slDist = Math.abs(entryPrice - slPrice)
    const tpDist = Math.abs(tpPrice - entryPrice)
    if (slDist === 0 || tpDist <= 0) continue
    if (tpDist / slDist < MIN_RR) continue

    // Simulate on 1m if available, else 5m
    const entryIdx1m = candles1m.findIndex(c => c.time >= entryCandle.time)
    const simCandles = entryIdx1m >= 0 && entryIdx1m < candles1m.length - 1
      ? candles1m.slice(entryIdx1m + 1, entryIdx1m + 300)
      : candles5m.slice(candles5m.findIndex(c => c.time >= entryCandle.time) + 1).slice(0, 200)
    let outcome = null, exitPrice = null, exitTime = null

    for (const fc of simCandles) {
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
      signal: entrySignal,
    })

    lastTradeTime = now5m.time
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

    // Route to symbol-specific strategy
    const trades = symbol === 'MGC1!'
      ? runBacktestMGC(candles5m)
      : runBacktest(candles5m, candles1m, symbol)

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
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
