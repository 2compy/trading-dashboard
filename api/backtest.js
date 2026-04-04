// ─────────────────────────────────────────────────────────────────────────────
// Backtest Engine: Daily H/L Liquidity Sweep + BOS + 5M FVG + 1M IFVG Entry
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

// Fetch 1 week of 1m data (single call — Yahoo Finance max is 7 days for 1m)
async function fetch1mRecent(ticker) {
  const now     = Math.floor(Date.now() / 1000)
  const period1 = now - 7 * 24 * 60 * 60
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1m&period1=${period1}&period2=${now}&includePrePost=false`
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

// ── Strategy primitives ───────────────────────────────────────────────────────
function getETDateStr(ts) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ts * 1000))
}

function getPrevDayHL(candles1h, currentTs) {
  const today = getETDateStr(currentTs)
  const byDay = {}
  for (const c of candles1h) {
    const d = getETDateStr(c.time)
    if (!byDay[d]) byDay[d] = []
    byDay[d].push(c)
  }
  const days = Object.keys(byDay).sort()
  const todayIdx = days.indexOf(today)
  if (todayIdx <= 0) return null
  const prevDay  = days[todayIdx - 1]
  const candles  = byDay[prevDay]
  return {
    high: Math.max(...candles.map(c => c.high)),
    low:  Math.min(...candles.map(c => c.low)),
    date: prevDay,
  }
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

// ── IFVG entry: first candle that closes back through the FVG after retracing into it
// Bullish: price retraces INTO the gap (close < fvg.top), then closes back ABOVE fvg.top → entry
// Bearish: price retraces INTO the gap (close > fvg.bottom), then closes back BELOW fvg.bottom → entry
function findIFVGEntry(candles, fvg, bias) {
  let retraced = false
  for (const c of candles) {
    if (c.time <= fvg.time) continue
    if (bias === 'bullish') {
      if (!retraced && c.close < fvg.top) retraced = true
      if (retraced && c.close > fvg.top) return c   // first close above = entry
    } else {
      if (!retraced && c.close > fvg.bottom) retraced = true
      if (retraced && c.close < fvg.bottom) return c // first close below = entry
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

// ── Main backtest: 5M sweep+BOS+FVG, 1M IFVG entry (falls back to 5M if no 1M data) ──
function runBacktest(candles1h, candles5m, candles1m, symbol) {
  const multiplier = CONTRACT_MULTIPLIER[symbol] || 5
  const trades     = []
  const has1m      = candles1m.length > 0

  if (!candles1h.length || !candles5m.length) return trades

  let lastTradeTime = 0

  for (let i = 10; i < candles5m.length - 1; i++) {
    const now5m = candles5m[i]

    if (now5m.time - lastTradeTime < 3600) continue

    // Step 1: Previous day H/L
    const pdhl = getPrevDayHL(candles1h, now5m.time)
    if (!pdhl) continue

    // Step 2: Liquidity sweep on recent 5M
    let bias = null, sweepPrice = null, sweepCandleIdx = null
    const lookback5m = candles5m.slice(Math.max(0, i - 20), i + 1)
    for (let j = lookback5m.length - 1; j >= 0; j--) {
      const c = lookback5m[j]
      if (c.low < pdhl.low && c.close > pdhl.low) {
        bias = 'bullish'; sweepPrice = c.low; sweepCandleIdx = Math.max(0, i - 20) + j; break
      }
      if (c.high > pdhl.high && c.close < pdhl.high) {
        bias = 'bearish'; sweepPrice = c.high; sweepCandleIdx = Math.max(0, i - 20) + j; break
      }
    }
    if (!bias || sweepCandleIdx === null) continue

    // Step 3: BOS on 5M after sweep
    const post5m = candles5m.slice(sweepCandleIdx, i + 1)
    const { highs: h5, lows: l5 } = detectSwings(post5m, 2)
    const bos5m  = detectBOS(post5m, h5, l5).filter(b => b.type === bias)
    if (!bos5m.length) continue
    const bosTime = bos5m[bos5m.length - 1].time

    // Step 4: FVG on 5M after BOS
    const afterBos5m = post5m.filter(c => c.time >= bosTime)
    if (afterBos5m.length < 3) continue
    const fvgs5m = detectFVGs(afterBos5m).filter(f => f.type === bias)
    if (!fvgs5m.length) continue
    const fvg5m = fvgs5m[fvgs5m.length - 1]

    // Step 5: IFVG entry — use 1M if available, else 5M
    let entryCandle = null
    if (has1m) {
      const m1After = candles1m.filter(c => c.time > fvg5m.time && c.time <= now5m.time + 300)
      entryCandle = findIFVGEntry(m1After, fvg5m, bias)
    }
    if (!entryCandle) {
      // Fall back to 5M IFVG
      const after5m = candles5m.filter(c => c.time > fvg5m.time && c.time <= now5m.time + 300)
      entryCandle = findIFVGEntry(after5m, fvg5m, bias)
    }
    if (!entryCandle) continue

    const entryPrice = entryCandle.close

    // Step 6: SL and TP
    const buffer  = (pdhl.high - pdhl.low) * 0.005
    const slPrice = bias === 'bullish' ? sweepPrice - buffer : sweepPrice + buffer
    const tpPrice = bias === 'bullish' ? pdhl.high : pdhl.low

    if (bias === 'bullish' && tpPrice <= entryPrice) continue
    if (bias === 'bearish' && tpPrice >= entryPrice) continue

    const slDist = Math.abs(entryPrice - slPrice)
    const tpDist = Math.abs(tpPrice - entryPrice)
    if (slDist === 0 || tpDist / slDist < MIN_RR) continue

    // Step 7: Simulate on 5M
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
      id:          trades.length + 1,
      time:        entryCandle.time,
      exitTime,
      bias,
      entryPrice:  parseFloat(entryPrice.toFixed(4)),
      stopPrice:   parseFloat(slPrice.toFixed(4)),
      targetPrice: parseFloat(tpPrice.toFixed(4)),
      exitPrice:   parseFloat(exitPrice.toFixed(4)),
      outcome,
      pnlDollars,
      rr,
      signal:      'DailyHL-Sweep+BOS+5mFVG+1mIFVG',
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
    // 3 calls total: 1h (6mo) + 5m (60d) + 1m (1 week)
    const [candles1h, candles5m, candles1m] = await Promise.all([
      fetchTF(ticker, '1h', '6mo'),
      fetchTF(ticker, '5m', '60d'),
      fetch1mRecent(ticker),
    ])

    const trades   = runBacktest(candles1h, candles5m, candles1m, symbol)
    const wins     = trades.filter(t => t.outcome === 'win').length
    const losses   = trades.filter(t => t.outcome === 'loss').length
    const winRate  = trades.length ? ((wins / trades.length) * 100).toFixed(1) : '0.0'
    const totalPnl = trades.reduce((s, t) => s + t.pnlDollars, 0)

    const earliest = candles5m.length ? new Date(candles5m[0].time * 1000).toISOString().split('T')[0] : null
    const latest   = candles5m.length ? new Date(candles5m[candles5m.length - 1].time * 1000).toISOString().split('T')[0] : null
    const dataNote = `5m: ${earliest} → ${latest} | 1m IFVG entry (last 7d) | Daily H/L Sweep`

    res.setHeader('Cache-Control', 's-maxage=3600')
    return res.status(200).json({
      symbol, trades, wins, losses, winRate, totalPnl, dataNote,
      candles1h, candles5m, candles1m,
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
