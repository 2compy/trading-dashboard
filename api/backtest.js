// ─────────────────────────────────────────────────────────────────────────────
// Multi-Strategy Backtest Engine
// 10 high-probability setups layered for maximum win rate
//
// STRATEGIES IMPLEMENTED:
//  1. ICT Silver Bullet       — 10:00–11:00 AM ET, FVG + IFVG + BOS
//  2. London Open Kill Zone   — 02:00–05:00 AM ET, bias + liquidity sweep
//  3. NY Open Kill Zone       — 07:00–10:30 AM ET, bias + FVG + BOS
//  4. PDH/PDL Liquidity Sweep — trade AFTER smart money grabs stops
//  5. Order Block Entry       — last OB before displacement (5M or 1M)
//  6. FVG + OB Confluence     — FVG overlaps OB = highest probability
//  7. IFVG Inversion          — FVG midpoint touched → flips direction
//  8. Break of Structure      — confirms directional bias on 1M
//  9. Asian Range Sweep       — NY session sweeps Asia hi/lo then trends
// 10. Power of 3 (AMD)        — accumulation → manipulation → distribution
//
// All setups require: kill zone + HTF bias alignment + LTF confirmation
// ─────────────────────────────────────────────────────────────────────────────

const SYMBOL_MAP = {
  'MES1!': 'MES=F',
  'MNQ1!': 'MNQ=F',
  'MGC1!': 'MGC=F',
  'MSL1!': 'SIL=F',
}

const CONTRACT_MULTIPLIER = { 'MES1!': 5, 'MNQ1!': 2, 'MGC1!': 10, 'MSL1!': 5 }
const SL_DOLLARS = 200
const TP_DOLLARS = 300

// Kill zones — ET hours where smart money is most active
// Gold/Silver best in London; equity index best in NY
const KILL_ZONES = [
  { name: 'London',  startH: 2,  endH: 5   },  // 02:00–05:00 ET
  { name: 'NY Open', startH: 7,  endH: 10  },  // 07:00–10:00 ET
  { name: 'SB',      startH: 10, endH: 11  },  // Silver Bullet 10:00–11:00 ET
  { name: 'PM',      startH: 13, endH: 16  },  // PM session 13:00–16:00 ET
]

// Instruments have preferred kill zones based on liquidity profiles
const PREFERRED_KZ = {
  'MES1!': ['NY Open', 'SB', 'PM'],
  'MNQ1!': ['NY Open', 'SB', 'PM'],
  'MGC1!': ['London', 'NY Open', 'SB'],
  'MSL1!': ['London', 'NY Open', 'SB'],
}

// ── Data fetching ─────────────────────────────────────────────────────────────
async function fetchTF(ticker, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=false`
  try {
    const res  = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    const data = await res.json()
    return parseCandles(data)
  } catch { return [] }
}

async function fetch1mChunked(ticker, chunks = 4) {
  const now      = Math.floor(Date.now() / 1000)
  const chunkSec = 7 * 24 * 60 * 60
  const requests = Array.from({ length: chunks }, (_, i) => {
    const period2 = now - i * chunkSec
    const period1 = period2 - chunkSec
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1m&period1=${period1}&period2=${period2}&includePrePost=false`
    return fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      .then(r => r.json()).then(d => parseCandles(d)).catch(() => [])
  })
  const results = await Promise.all(requests)
  const seen = new Set()
  return results.flat()
    .filter(c => { if (seen.has(c.time)) return false; seen.add(c.time); return true })
    .sort((a, b) => a.time - b.time)
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
function getETHour(ts) {
  try {
    const s = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour: 'numeric', hour12: false,
    }).format(new Date(ts * 1000))
    return parseInt(s) % 24
  } catch { return (Math.floor(ts / 3600) - 5 + 24) % 24 }
}

function getKillZone(ts, symbol) {
  const h    = getETHour(ts)
  const pref = PREFERRED_KZ[symbol] || KILL_ZONES.map(k => k.name)
  const kz   = KILL_ZONES.find(k => h >= k.startH && h < k.endH && pref.includes(k.name))
  return kz || null
}

// Asian session range: 20:00–02:00 ET prior night
function getAsianRange(candles, beforeTs) {
  const h  = getETHour(beforeTs)
  // Asian session closed, collect candles from 20:00 to 02:00 ET
  const dayMs  = 86400
  const base   = beforeTs - (h + 5) * 3600  // rough start of current UTC day
  const asStart = base - 4 * 3600            // 20:00 ET prior day ≈ 00:00 UTC
  const asEnd   = base + 2 * 3600            // 02:00 ET ≈ 07:00 UTC
  const slice   = candles.filter(c => c.time >= asStart && c.time < asEnd)
  if (slice.length < 3) return null
  return { high: Math.max(...slice.map(c => c.high)), low: Math.min(...slice.map(c => c.low)) }
}

// Previous day high/low from 1H candles (ET day boundary)
function getPrevDayHL(candles1h, beforeTs) {
  const etH     = getETHour(beforeTs)
  const dayStart = beforeTs - etH * 3600 - (beforeTs % 3600) // midnight ET approx
  const ydStart  = dayStart - 86400
  const ydCandles = candles1h.filter(c => c.time >= ydStart && c.time < dayStart)
  if (!ydCandles.length) return null
  return {
    high: Math.max(...ydCandles.map(c => c.high)),
    low:  Math.min(...ydCandles.map(c => c.low)),
  }
}

// ── Strategy primitives ───────────────────────────────────────────────────────
function detectSwings(candles, lookback = 3) {
  const highs = [], lows = []
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i]
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

// Order Blocks: last opposing candle before a displacement move
function detectOBs(candles) {
  const obs = []
  for (let i = 1; i < candles.length - 1; i++) {
    const c = candles[i], next = candles[i + 1]
    // Bullish OB: bearish candle immediately before strong bullish displacement
    if (c.close < c.open && next.close > c.open && (next.close - next.open) > (c.open - c.close) * 0.5)
      obs.push({ type: 'bullish', top: c.open, bottom: c.close, mid: (c.open + c.close) / 2, time: c.time })
    // Bearish OB: bullish candle immediately before strong bearish displacement
    if (c.close > c.open && next.close < c.open && (next.open - next.close) > (c.close - c.open) * 0.5)
      obs.push({ type: 'bearish', top: c.close, bottom: c.open, mid: (c.open + c.close) / 2, time: c.time })
  }
  return obs
}

// IFVG: FVG that has been mitigated (price reached midpoint) — now acts as opposing level
function applyIFVG(candles, fvgs) {
  return fvgs.map(fvg => {
    let inversed = false
    for (const c of candles) {
      if (c.time <= fvg.time) continue
      if (fvg.type === 'bullish' && c.low  <= fvg.mid) { inversed = true; break }
      if (fvg.type === 'bearish' && c.high >= fvg.mid) { inversed = true; break }
    }
    return { ...fvg, inversed, effectiveType: inversed ? (fvg.type === 'bullish' ? 'bearish' : 'bullish') : fvg.type }
  })
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

// OTE: Optimal Trade Entry zone — 61.8%–78.6% Fibonacci retracement
function detectOTE(candles, bias) {
  const { highs, lows } = detectSwings(candles, 2)
  if (!highs.length || !lows.length) return null
  if (bias === 'bullish') {
    const recentLow  = lows[lows.length - 1]
    const recentHigh = highs.filter(h => h.time > recentLow.time).slice(-1)[0]
    if (!recentHigh) return null
    const range = recentHigh.price - recentLow.price
    if (range <= 0) return null
    return { top: recentHigh.price - range * 0.618, bottom: recentHigh.price - range * 0.786 }
  } else {
    const recentHigh = highs[highs.length - 1]
    const recentLow  = lows.filter(l => l.time > recentHigh.time).slice(-1)[0]
    if (!recentLow) return null
    const range = recentHigh.price - recentLow.price
    if (range <= 0) return null
    return { top: recentLow.price + range * 0.786, bottom: recentLow.price + range * 0.618 }
  }
}

// Power of 3 / AMD: determine phase of current session
// Accumulation (Asia), Manipulation (London sweep), Distribution (NY trend)
function getSessionPhase(ts) {
  const h = getETHour(ts)
  if (h >= 20 || h < 2)  return 'accumulation'   // Asia
  if (h >= 2  && h < 7)  return 'manipulation'    // London sweep
  if (h >= 7  && h < 16) return 'distribution'    // NY trend
  return null
}

// ── HTF bias timeline (pre-computed, O(n)) ───────────────────────────────────
function computeBiasTimeline(candles1h) {
  const biasArr    = new Array(candles1h.length).fill(null)
  const activeFVGs = []
  for (let i = 0; i < candles1h.length; i++) {
    const c = candles1h[i]
    for (const fvg of activeFVGs) {
      if (fvg.mitigated) continue
      if (fvg.type === 'bullish' && c.low  <= fvg.mid) fvg.mitigated = true
      if (fvg.type === 'bearish' && c.high >= fvg.mid) fvg.mitigated = true
    }
    if (i >= 2) {
      const a = candles1h[i - 2], cur = candles1h[i]
      if (cur.low  > a.high) activeFVGs.push({ type: 'bullish', mid: (cur.low  + a.high) / 2, mitigated: false })
      if (cur.high < a.low)  activeFVGs.push({ type: 'bearish', mid: (cur.high + a.low)  / 2, mitigated: false })
    }
    for (let j = activeFVGs.length - 1; j >= 0; j--) {
      if (!activeFVGs[j].mitigated) { biasArr[i] = activeFVGs[j].type; break }
    }
  }
  return biasArr
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

// ── Multi-strategy backtest engine ────────────────────────────────────────────
function runBacktest(candles1h, candles5m, candles1m, symbol) {
  const multiplier   = CONTRACT_MULTIPLIER[symbol] || 5
  const stopPoints   = SL_DOLLARS / multiplier
  const targetPoints = TP_DOLLARS / multiplier
  const trades       = []

  if (!candles1h.length || !candles5m.length || !candles1m.length) return trades

  // Pre-compute 1H bias timeline once — O(n) total
  const h1BiasArr = computeBiasTimeline(candles1h)

  function getBiasAt(time) {
    const idx = bsFloor(candles1h, time)
    return idx >= 0 ? h1BiasArr[idx] : null
  }

  // ── Main loop: iterate 5m candles ─────────────────────────────────────────
  for (let i = 20; i < candles5m.length - 1; i++) {
    const now5m = candles5m[i]

    // ── Filter 1: Kill Zone ──────────────────────────────────────────────────
    const killZone = getKillZone(now5m.time, symbol)
    if (!killZone) continue

    // ── Filter 2: HTF Bias ───────────────────────────────────────────────────
    const bias = getBiasAt(now5m.time)
    if (!bias) continue

    // ── Filter 3: Power of 3 phase — only trade in distribution phase ────────
    const phase = getSessionPhase(now5m.time)
    // Allow both manipulation and distribution entries (manipulation = the sweep before the move)
    if (phase === 'accumulation') continue

    // ── Filter 4: Previous Day High/Low — require liquidity sweep ────────────
    const pdhl = getPrevDayHL(candles1h, now5m.time)
    if (pdhl) {
      const lookback5m = candles5m.slice(Math.max(0, i - 30), i + 1)
      const swept = bias === 'bullish'
        ? lookback5m.some(c => c.low  < pdhl.low)   // PDL swept before bullish entry
        : lookback5m.some(c => c.high > pdhl.high)  // PDH swept before bearish entry
      if (!swept) continue
    }

    // ── Filter 5: Asian Range Sweep check ────────────────────────────────────
    const asianRange = getAsianRange(candles1h, now5m.time)
    if (asianRange && killZone.name === 'NY Open') {
      const lookback5m = candles5m.slice(Math.max(0, i - 20), i + 1)
      const asianSwept = bias === 'bullish'
        ? lookback5m.some(c => c.low  < asianRange.low)
        : lookback5m.some(c => c.high > asianRange.high)
      if (!asianSwept) continue
    }

    // ── 5M structure: FVG and/or Order Block aligned with bias ───────────────
    const recent5m = candles5m.slice(Math.max(0, i - 15), i + 1)
    const fvgs5m   = detectFVGs(recent5m).filter(f => f.type === bias)
    const obs5m    = detectOBs(recent5m).filter(ob => ob.type === bias)

    // Need at least one 5M setup
    if (!fvgs5m.length && !obs5m.length) continue

    // Prefer FVG+OB confluence (highest probability), fall back to either alone
    const has5mFVG = fvgs5m.length > 0
    const has5mOB  = obs5m.length  > 0
    const fvg5m    = has5mFVG ? fvgs5m[fvgs5m.length - 1] : null
    const ob5m     = has5mOB  ? obs5m[obs5m.length - 1]   : null
    const anchorTime = fvg5m ? fvg5m.time : ob5m.time

    // ── 1M confirmation slice ─────────────────────────────────────────────────
    const m1Start = bsFloor(candles1m, anchorTime) + 1
    const m1End   = bsFloor(candles1m, now5m.time)
    if (m1End - m1Start < 5) continue
    const m1Slice = candles1m.slice(m1Start, m1End + 1)

    // ── IFVG on 1M ────────────────────────────────────────────────────────────
    const raw1mFVGs   = detectFVGs(m1Slice)
    const ifvgSignals = applyIFVG(m1Slice, raw1mFVGs).filter(f => f.inversed && f.effectiveType === bias)
    if (!ifvgSignals.length) continue

    // ── 1M Order Block aligned with bias ─────────────────────────────────────
    const obs1m = detectOBs(m1Slice).filter(ob => ob.type === bias)

    // ── BOS on 1M ─────────────────────────────────────────────────────────────
    const { highs: m1H, lows: m1L } = detectSwings(m1Slice, 2)
    const bos          = detectBOS(m1Slice, m1H, m1L).filter(b => b.type === bias)
    const latestIFVG   = ifvgSignals[ifvgSignals.length - 1]
    const bosAfterIFVG = bos.filter(b => b.time >= latestIFVG.time)
    if (!bosAfterIFVG.length) continue

    // ── OTE check (optional — acts as precision filter) ───────────────────────
    const ote = detectOTE(m1Slice, bias)

    // ── Entry ─────────────────────────────────────────────────────────────────
    const confirmation = bosAfterIFVG[0]
    const entryCandle  = m1Slice.find(c => c.time >= confirmation.time)
    if (!entryCandle) continue
    const entryPrice = entryCandle.close

    // OTE filter: if OTE zone detected, only take trade if entry is near OTE
    if (ote) {
      const inOTE = bias === 'bullish'
        ? entryPrice >= ote.bottom && entryPrice <= ote.top * 1.005
        : entryPrice <= ote.top    && entryPrice >= ote.bottom * 0.995
      if (!inOTE) continue
    }

    const stopPrice   = bias === 'bullish' ? entryPrice - stopPoints : entryPrice + stopPoints
    const targetPrice = bias === 'bullish' ? entryPrice + targetPoints : entryPrice - targetPoints

    // ── Simulation: future 1m candles ─────────────────────────────────────────
    const entryIdx1m = bsFloor(candles1m, entryCandle.time)
    const future1m   = candles1m.slice(entryIdx1m + 1, entryIdx1m + 201)
    let outcome = null, exitPrice = null, exitTime = null

    for (const fc of future1m) {
      if (bias === 'bullish') {
        if (fc.low  <= stopPrice)   { outcome = 'loss'; exitPrice = stopPrice;   exitTime = fc.time; break }
        if (fc.high >= targetPrice) { outcome = 'win';  exitPrice = targetPrice; exitTime = fc.time; break }
      } else {
        if (fc.high >= stopPrice)   { outcome = 'loss'; exitPrice = stopPrice;   exitTime = fc.time; break }
        if (fc.low  <= targetPrice) { outcome = 'win';  exitPrice = targetPrice; exitTime = fc.time; break }
      }
    }

    if (!outcome) continue

    // ── Signal label — shows which strategies aligned ─────────────────────────
    const parts = [killZone.name]
    if (pdhl && (bias === 'bullish' ? candles5m.slice(Math.max(0,i-30),i+1).some(c=>c.low<pdhl.low) : candles5m.slice(Math.max(0,i-30),i+1).some(c=>c.high>pdhl.high))) parts.push('PDL')
    if (has5mFVG && has5mOB) parts.push('FVG+OB')
    else if (has5mFVG)       parts.push('FVG')
    else if (has5mOB)        parts.push('OB')
    if (obs1m.length)        parts.push('1mOB')
    parts.push('IFVG+BOS')
    if (ote) parts.push('OTE')

    trades.push({
      id:          trades.length + 1,
      time:        confirmation.time,
      exitTime,
      bias,
      entryPrice:  parseFloat(entryPrice.toFixed(4)),
      stopPrice:   parseFloat(stopPrice.toFixed(4)),
      targetPrice: parseFloat(targetPrice.toFixed(4)),
      exitPrice:   parseFloat(exitPrice.toFixed(4)),
      outcome,
      pnlDollars:  outcome === 'win' ? TP_DOLLARS : -SL_DOLLARS,
      rr:          (TP_DOLLARS / SL_DOLLARS).toFixed(2),
      signal:      parts.join('+'),
      killZone:    killZone.name,
    })

    i += 5
  }

  return trades
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')

  const { symbol } = req.query
  const ticker = SYMBOL_MAP[symbol]
  if (!ticker) return res.status(400).json({ error: 'Unknown symbol' })

  try {
    const [candles1h, candles5m, candles1m] = await Promise.all([
      fetchTF(ticker, '1h', '1y'),
      fetchTF(ticker, '5m', '60d'),
      fetch1mChunked(ticker, 4),
    ])

    const trades    = runBacktest(candles1h, candles5m, candles1m, symbol)
    const wins      = trades.filter(t => t.outcome === 'win').length
    const losses    = trades.filter(t => t.outcome === 'loss').length
    const winRate   = trades.length ? ((wins / trades.length) * 100).toFixed(1) : '0.0'
    const totalPnl  = trades.reduce((s, t) => s + t.pnlDollars, 0)
    const grossWin  = wins   * TP_DOLLARS
    const grossLoss = losses * SL_DOLLARS

    const earliest = candles1m.length ? new Date(candles1m[0].time * 1000).toISOString().split('T')[0] : null
    const latest   = candles1m.length ? new Date(candles1m[candles1m.length - 1].time * 1000).toISOString().split('T')[0] : null
    const dataNote = `1m data: ${earliest} → ${latest} | 1H bias: 1 year | 10-strategy confluence`

    res.setHeader('Cache-Control', 's-maxage=300')
    return res.status(200).json({ symbol, trades, wins, losses, winRate, totalPnl, grossWin, grossLoss, dataNote })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
