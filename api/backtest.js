// Fetches candles AND runs the full backtest server-side.
// Returns only the computed results — no heavy work on the browser.

const SYMBOL_MAP = {
  'MES1!': 'MES=F',
  'MNQ1!': 'MNQ=F',
  'MGC1!': 'MGC=F',
  'MSL1!': 'SIL=F',
}

const CONTRACT_MULTIPLIER = {
  'MES1!': 5,
  'MNQ1!': 2,
  'MGC1!': 10,
  'MSL1!': 5,
}

const SL_DOLLARS = 200
const TP_DOLLARS = 300

// ── Data fetching ─────────────────────────────────────────────────────────────
async function fetchTF(ticker, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=false`
  const res  = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  const data = await res.json()
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
      highs.push({ price: c.high, time: c.time, index: i })
    if (prev.every(x => x.low >= c.low) && next.every(x => x.low >= c.low))
      lows.push({ price: c.low, time: c.time, index: i })
  }
  return { highs, lows }
}

function detectFVGs(candles) {
  const fvgs = []
  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1], next = candles[i + 1]
    if (next.low > prev.high)
      fvgs.push({ type: 'bullish', top: next.low, bottom: prev.high, mid: (next.low + prev.high) / 2, time: candles[i].time, index: i })
    if (next.high < prev.low)
      fvgs.push({ type: 'bearish', top: prev.low, bottom: next.high, mid: (prev.low + next.high) / 2, time: candles[i].time, index: i })
  }
  return fvgs
}

function getHTFBias(h1Candles) {
  const fvgs = detectFVGs(h1Candles)
  if (!fvgs.length) return null
  for (const fvg of fvgs) {
    const subsequent = h1Candles.filter(c => c.time > fvg.time)
    for (const c of subsequent) {
      if (fvg.type === 'bullish' && c.low  <= fvg.mid) { fvg.mitigated = true; break }
      if (fvg.type === 'bearish' && c.high >= fvg.mid) { fvg.mitigated = true; break }
    }
  }
  const active = fvgs.filter(f => !f.mitigated)
  if (!active.length) return null
  return active[active.length - 1].type
}

function applyIFVG(candles, fvgs) {
  return fvgs.map(fvg => {
    const subsequent = candles.filter(c => c.time > fvg.time)
    let inversed = false
    for (const c of subsequent) {
      if (fvg.type === 'bullish' && c.low  <= fvg.mid) { inversed = true; break }
      if (fvg.type === 'bearish' && c.high >= fvg.mid) { inversed = true; break }
    }
    return { ...fvg, inversed, effectiveType: inversed ? (fvg.type === 'bullish' ? 'bearish' : 'bullish') : fvg.type }
  })
}

function detectBOS(candles, swingHighs, swingLows) {
  const bos = []
  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i], prev = candles[i - 1]
    const priorHighs = swingHighs.filter(s => s.time < curr.time)
    if (priorHighs.length) {
      const last = priorHighs[priorHighs.length - 1]
      if (prev.close <= last.price && curr.close > last.price)
        bos.push({ type: 'bullish', price: last.price, time: curr.time, index: i })
    }
    const priorLows = swingLows.filter(s => s.time < curr.time)
    if (priorLows.length) {
      const last = priorLows[priorLows.length - 1]
      if (prev.close >= last.price && curr.close < last.price)
        bos.push({ type: 'bearish', price: last.price, time: curr.time, index: i })
    }
  }
  return bos
}

// ── Backtest engine ───────────────────────────────────────────────────────────
function runBacktest(candles1h, candles5m, candles1m, symbol) {
  const multiplier   = CONTRACT_MULTIPLIER[symbol] || 5
  const stopPoints   = SL_DOLLARS / multiplier
  const targetPoints = TP_DOLLARS / multiplier
  const trades = []

  if (!candles1h.length || !candles5m.length || !candles1m.length) return trades

  for (let i = 20; i < candles5m.length - 1; i++) {
    const now5m = candles5m[i]

    const h1Slice = candles1h.filter(c => c.time <= now5m.time)
    if (h1Slice.length < 10) continue
    const bias = getHTFBias(h1Slice)
    if (!bias) continue

    const recent5m = candles5m.slice(Math.max(0, i - 10), i + 1)
    const fvgs5m   = detectFVGs(recent5m).filter(f => f.type === bias)
    if (!fvgs5m.length) continue
    const fvg = fvgs5m[fvgs5m.length - 1]

    const m1Slice = candles1m.filter(c => c.time > fvg.time && c.time <= now5m.time + 300)
    if (m1Slice.length < 5) continue

    const { highs: m1Highs, lows: m1Lows } = detectSwings(m1Slice, 2)
    const bos          = detectBOS(m1Slice, m1Highs, m1Lows).filter(b => b.type === bias)
    const raw1mFVGs    = detectFVGs(m1Slice)
    const ifvgSignals  = applyIFVG(m1Slice, raw1mFVGs).filter(f => f.inversed && f.effectiveType === bias)

    // Require BOTH IFVG and BOS
    if (!ifvgSignals.length || !bos.length) continue

    const latestIFVG   = ifvgSignals[ifvgSignals.length - 1]
    const bosAfterIFVG = bos.filter(b => b.time >= latestIFVG.time)
    if (!bosAfterIFVG.length) continue

    const confirmation = bosAfterIFVG.sort((a, b) => a.time - b.time)[0]
    const entryCandle  = m1Slice.find(c => c.time >= confirmation.time)
    if (!entryCandle) continue
    const entryPrice = entryCandle.close

    const stopPrice   = bias === 'bullish' ? entryPrice - stopPoints : entryPrice + stopPoints
    const targetPrice = bias === 'bullish' ? entryPrice + targetPoints : entryPrice - targetPoints

    const futureCandles = candles5m.slice(i + 1, i + 50)
    let outcome = null, exitPrice = null, exitTime = null

    for (const fc of futureCandles) {
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
    const [candles1h, candles5m, candles1m] = await Promise.all([
      fetchTF(ticker, '1h', '2y'),
      fetchTF(ticker, '5m', '60d'),
      fetchTF(ticker, '1m', '7d'),
    ])

    const trades     = runBacktest(candles1h, candles5m, candles1m, symbol)
    const wins       = trades.filter(t => t.outcome === 'win').length
    const losses     = trades.filter(t => t.outcome === 'loss').length
    const winRate    = trades.length ? ((wins / trades.length) * 100).toFixed(1) : '0.0'
    const totalPnl   = trades.reduce((s, t) => s + t.pnlDollars, 0)
    const grossWin   = wins   * TP_DOLLARS
    const grossLoss  = losses * SL_DOLLARS

    res.setHeader('Cache-Control', 's-maxage=300')
    return res.status(200).json({ symbol, trades, wins, losses, winRate, totalPnl, grossWin, grossLoss })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
