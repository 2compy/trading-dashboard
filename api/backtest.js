// Backtest server — fetches max available data and runs strategy server-side.
// Yahoo Finance caps: 1m = 7d per request, 5m = 60d, 1h = 2y
// We chunk 1m requests in parallel to maximise history (~28d of 1m data)

const SYMBOL_MAP = {
  'MES1!': 'MES=F',
  'MNQ1!': 'MNQ=F',
  'MGC1!': 'MGC=F',
  'MSL1!': 'SIL=F',
}

const CONTRACT_MULTIPLIER = { 'MES1!': 5, 'MNQ1!': 2, 'MGC1!': 10, 'MSL1!': 5 }
const SL_DOLLARS = 200
const TP_DOLLARS = 300

// ── Data fetching ─────────────────────────────────────────────────────────────
async function fetchTF(ticker, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=false`
  try {
    const res  = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    const data = await res.json()
    return parseCandles(data)
  } catch { return [] }
}

// Fetch 1m in parallel 7-day chunks to maximise available history
async function fetch1mChunked(ticker, chunks = 4) {
  const now      = Math.floor(Date.now() / 1000)
  const chunkSec = 7 * 24 * 60 * 60

  const requests = Array.from({ length: chunks }, (_, i) => {
    const period2 = now - i * chunkSec
    const period1 = period2 - chunkSec
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1m&period1=${period1}&period2=${period2}&includePrePost=false`
    return fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      .then(r => r.json())
      .then(d => parseCandles(d))
      .catch(() => [])
  })

  const results = await Promise.all(requests)
  const seen    = new Set()
  return results
    .flat()
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

// ── Strategy functions ────────────────────────────────────────────────────────
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

// Pre-compute bias at every 1H candle in O(n) — avoids O(n²) recompute per bar
function computeBiasTimeline(candles1h) {
  const biasArr  = new Array(candles1h.length).fill(null)
  const activeFVGs = [] // track live (unmitigated) FVGs incrementally

  for (let i = 0; i < candles1h.length; i++) {
    const c = candles1h[i]

    // Check mitigation against current candle
    for (const fvg of activeFVGs) {
      if (fvg.mitigated) continue
      if (fvg.type === 'bullish' && c.low  <= fvg.mid) { fvg.mitigated = true }
      if (fvg.type === 'bearish' && c.high >= fvg.mid) { fvg.mitigated = true }
    }

    // New FVG formed by candles[i-2], candles[i-1], candles[i]
    if (i >= 2) {
      const a = candles1h[i - 2], b = candles1h[i - 1], cur = candles1h[i]
      if (cur.low > a.high)
        activeFVGs.push({ type: 'bullish', mid: (cur.low + a.high) / 2, mitigated: false })
      if (cur.high < a.low)
        activeFVGs.push({ type: 'bearish', mid: (cur.high + a.low) / 2, mitigated: false })
    }

    // Current bias = most recent unmitigated FVG
    for (let j = activeFVGs.length - 1; j >= 0; j--) {
      if (!activeFVGs[j].mitigated) { biasArr[i] = activeFVGs[j].type; break }
    }
  }

  return biasArr
}

// Binary search: latest candle index with time <= t
function bsFloor(candles, t) {
  let lo = 0, hi = candles.length - 1, idx = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (candles[mid].time <= t) { idx = mid; lo = mid + 1 }
    else hi = mid - 1
  }
  return idx
}

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
  let lastHigh = null, lastLow = null
  let hPtr = 0, lPtr = 0

  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i], prev = candles[i - 1]

    // Advance pointers for swings that precede curr.time
    while (hPtr < highs.length && highs[hPtr].time < curr.time) { lastHigh = highs[hPtr]; hPtr++ }
    while (lPtr < lows.length  && lows[lPtr].time  < curr.time) { lastLow  = lows[lPtr];  lPtr++ }

    if (lastHigh && prev.close <= lastHigh.price && curr.close > lastHigh.price)
      bos.push({ type: 'bullish', price: lastHigh.price, time: curr.time })
    if (lastLow  && prev.close >= lastLow.price  && curr.close < lastLow.price)
      bos.push({ type: 'bearish', price: lastLow.price,  time: curr.time })
  }
  return bos
}

// ── Backtest engine ───────────────────────────────────────────────────────────
// Loop: 5m candles for signal detection (much fewer iterations than 1m)
// Bias: pre-computed from 1H timeline — O(n) not O(n²)
// Confirmation: 1M IFVG + BOS on slice only
// Simulation: future 1m candles for precise exit
function runBacktest(candles1h, candles5m, candles1m, symbol) {
  const multiplier   = CONTRACT_MULTIPLIER[symbol] || 5
  const stopPoints   = SL_DOLLARS / multiplier
  const targetPoints = TP_DOLLARS / multiplier
  const trades = []

  if (!candles1h.length || !candles1m.length || !candles5m.length) return trades

  // Pre-compute 1H bias for every hour in O(n)
  const h1BiasArr = computeBiasTimeline(candles1h)

  function getBiasAt(time) {
    const idx = bsFloor(candles1h, time)
    return idx >= 0 ? h1BiasArr[idx] : null
  }

  // Main loop: 5m candles — ~8,000 iterations for 60d vs ~40,000 for 1m
  for (let i = 20; i < candles5m.length - 1; i++) {
    const now5m = candles5m[i]
    const bias  = getBiasAt(now5m.time)
    if (!bias) continue

    // 5M FVG aligned with bias — last 10 candles
    const recent5m = candles5m.slice(Math.max(0, i - 10), i + 1)
    const fvgs5m   = detectFVGs(recent5m).filter(f => f.type === bias)
    if (!fvgs5m.length) continue
    const fvg5m = fvgs5m[fvgs5m.length - 1]

    // 1m slice: after the 5m FVG formed, up to now5m
    const m1Start = bsFloor(candles1m, fvg5m.time) + 1
    const m1End   = bsFloor(candles1m, now5m.time)
    if (m1End - m1Start < 5) continue
    const m1Slice = candles1m.slice(m1Start, m1End + 1)

    // IFVG on 1m
    const raw1mFVGs   = detectFVGs(m1Slice)
    const ifvgSignals = applyIFVG(m1Slice, raw1mFVGs).filter(f => f.inversed && f.effectiveType === bias)
    if (!ifvgSignals.length) continue

    // BOS on 1m after IFVG
    const { highs: m1H, lows: m1L } = detectSwings(m1Slice, 2)
    const bos          = detectBOS(m1Slice, m1H, m1L).filter(b => b.type === bias)
    const latestIFVG   = ifvgSignals[ifvgSignals.length - 1]
    const bosAfterIFVG = bos.filter(b => b.time >= latestIFVG.time)
    if (!bosAfterIFVG.length) continue

    const confirmation = bosAfterIFVG[0]
    const entryCandle  = m1Slice.find(c => c.time >= confirmation.time)
    if (!entryCandle) continue
    const entryPrice = entryCandle.close

    const stopPrice   = bias === 'bullish' ? entryPrice - stopPoints : entryPrice + stopPoints
    const targetPrice = bias === 'bullish' ? entryPrice + targetPoints : entryPrice - targetPoints

    // Simulate on future 1m candles
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
      signal:      'IFVG+BOS',
    })

    i += 5 // skip ahead to avoid overlapping trades
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
    // Fetch all timeframes in parallel — 1m chunked for max history
    const [candles1h, candles5m, candles1m] = await Promise.all([
      fetchTF(ticker, '1h', '1y'),
      fetchTF(ticker, '5m', '60d'),
      fetch1mChunked(ticker, 4),   // 4 × 7d chunks = ~28 days of 1m data
    ])

    const trades    = runBacktest(candles1h, candles5m, candles1m, symbol)
    const wins      = trades.filter(t => t.outcome === 'win').length
    const losses    = trades.filter(t => t.outcome === 'loss').length
    const winRate   = trades.length ? ((wins / trades.length) * 100).toFixed(1) : '0.0'
    const totalPnl  = trades.reduce((s, t) => s + t.pnlDollars, 0)
    const grossWin  = wins   * TP_DOLLARS
    const grossLoss = losses * SL_DOLLARS

    // Date range info
    const earliest = candles1m.length ? new Date(candles1m[0].time * 1000).toISOString().split('T')[0] : null
    const latest   = candles1m.length ? new Date(candles1m[candles1m.length - 1].time * 1000).toISOString().split('T')[0] : null
    const dataNote = `1m data: ${earliest} → ${latest} (${candles1m.length} candles) | 1H bias: 1 year`

    res.setHeader('Cache-Control', 's-maxage=300')
    return res.status(200).json({ symbol, trades, wins, losses, winRate, totalPnl, grossWin, grossLoss, dataNote })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
