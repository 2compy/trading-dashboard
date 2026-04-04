// ─────────────────────────────────────────────────────────────────────────────
// Strategy: Daily H/L Liquidity Sweep + BOS (after sweep) + 1M IFVG Entry
//
// Rules (all required):
//  1. Kill zone only: London 3–5am ET or NY open 9:30–11:30am ET
//  2. Previous day H/L sweep: wick through + close back
//  3. BOS on 5M AFTER the sweep, same direction
//  4. 1M FVG forms after BOS (min 7pts wide)
//  5. IFVG: price retraces into FVG, first candle to close back through = entry
//  6. SL = sweep wick extreme + 2pt buffer
//  7. TP = nearest swing H/L in 50–70pt window (default 60pt)
//  8. Skip if RR < 2
// ─────────────────────────────────────────────────────────────────────────────

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

// Kill zones: London open (3–5am ET), NY open (9:30–11:30am ET), NY PM (1:30–3pm ET)
export function isKillZone(ts) {
  const mins = getETMinutes(ts)
  return (mins >= 180 && mins < 300) ||   // London: 3:00–5:00 AM ET
         (mins >= 570 && mins < 690) ||   // NY open: 9:30–11:30 AM ET
         (mins >= 810 && mins < 900)      // NY PM: 1:30–3:00 PM ET
}

// ── Daily H/L from 5M candles ─────────────────────────────────────────────────
export function buildDailyHL(candles5m) {
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

export function getPrevDayHL(dailyHL, currentTs) {
  const today = getETDateStr(currentTs)
  const days  = Object.keys(dailyHL).sort()
  const idx   = days.indexOf(today)
  if (idx <= 0) return null
  const prev = days[idx - 1]
  return { ...dailyHL[prev], date: prev }
}

// ── Swing Highs & Lows ────────────────────────────────────────────────────────
export function detectSwings(candles, lookback = 3) {
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

// ── Fair Value Gaps ───────────────────────────────────────────────────────────
export function detectFVGs(candles) {
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

// ── IFVG entry ────────────────────────────────────────────────────────────────
export function findIFVGEntry(candles, fvg, bias) {
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

// kept for compatibility
export function applyIFVG(candles, fvgs) {
  return fvgs.map(fvg => {
    const subsequent = candles.filter(c => c.time > fvg.time)
    let inversed = false
    for (const c of subsequent) {
      if (fvg.type === 'bullish' && c.low  <= fvg.mid) { inversed = true; break }
      if (fvg.type === 'bearish' && c.high >= fvg.mid) { inversed = true; break }
    }
    return {
      ...fvg,
      inversed,
      effectiveType: inversed
        ? (fvg.type === 'bullish' ? 'bearish' : 'bullish')
        : fvg.type,
    }
  })
}

// ── Break of Structure ────────────────────────────────────────────────────────
export function detectBOS(candles, swingHighs, swingLows) {
  const bos = []
  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i], prev = candles[i - 1]
    const priorHighs = swingHighs.filter(s => s.time < curr.time)
    if (priorHighs.length) {
      const last = priorHighs[priorHighs.length - 1]
      if (prev.close <= last.price && curr.close > last.price)
        bos.push({ type: 'bullish', price: last.price, time: curr.time })
    }
    const priorLows = swingLows.filter(s => s.time < curr.time)
    if (priorLows.length) {
      const last = priorLows[priorLows.length - 1]
      if (prev.close >= last.price && curr.close < last.price)
        bos.push({ type: 'bearish', price: last.price, time: curr.time })
    }
  }
  return bos
}

// ── Contract multipliers ──────────────────────────────────────────────────────
export const CONTRACT_MULTIPLIER = {
  'MES1!': 5,
  'MNQ1!': 2,
  'MGC1!': 10,
  'Sl1!':  5,
}

const MIN_RR = 2

// ── Full backtest ─────────────────────────────────────────────────────────────
export function runBacktest(candles5m, candles1m, symbol = 'MES1!') {
  const multiplier = CONTRACT_MULTIPLIER[symbol] || 5
  const trades     = []

  if (!candles5m.length || !candles1m.length) return trades

  const dailyHL = buildDailyHL(candles5m)
  let lastTradeTime = 0

  for (let i = 20; i < candles5m.length - 1; i++) {
    const now5m    = candles5m[i]
    const recent5m = candles5m.slice(Math.max(0, i - 30), i + 1)

    if (!isKillZone(now5m.time)) continue
    if (now5m.time - lastTradeTime < 3600) continue

    const pdhl = getPrevDayHL(dailyHL, now5m.time)
    if (!pdhl) continue

    // Confluence 1: Daily H/L sweep (required)
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
    if (!sweepBias) continue

    // Confluence 2: BOS on 5M AFTER the sweep, same direction (required)
    const postSweep5m = recent5m.filter(c => c.time > sweepTime)
    if (postSweep5m.length < 4) continue
    const { highs: h5, lows: l5 } = detectSwings(postSweep5m, 2)
    const bosList = detectBOS(postSweep5m, h5, l5).filter(b => b.type === sweepBias)
    if (!bosList.length) continue
    const latestBOS = bosList[bosList.length - 1]

    const bias = sweepBias

    // Entry: 1M FVG + IFVG after BOS
    const m1After = candles1m.filter(c => c.time >= latestBOS.time && c.time <= now5m.time + 300)
    if (m1After.length < 5) continue

    const fvgs1m = detectFVGs(m1After).filter(f => f.type === bias)
    if (!fvgs1m.length) continue
    const fvg1m = fvgs1m[fvgs1m.length - 1]
    if (fvg1m.top - fvg1m.bottom < 7) continue

    const m1PostFVG   = m1After.filter(c => c.time > fvg1m.time)
    const entryCandle = findIFVGEntry(m1PostFVG, fvg1m, bias)
    if (!entryCandle) continue

    const entryPrice = entryCandle.close
    const slPrice = bias === 'bullish' ? sweepWickExtreme - 2 : sweepWickExtreme + 2
    const slDist  = Math.abs(entryPrice - slPrice)
    if (slDist === 0 || slDist > 60) continue

    const { highs, lows } = detectSwings(recent5m, 3)
    let tpPrice
    if (bias === 'bullish') {
      const c = highs.filter(h => h.price > entryPrice + 50 && h.price <= entryPrice + 70).sort((a, b) => a.price - b.price)
      tpPrice = c[0]?.price ?? entryPrice + 60
    } else {
      const c = lows.filter(l => l.price < entryPrice - 50 && l.price >= entryPrice - 70).sort((a, b) => b.price - a.price)
      tpPrice = c[0]?.price ?? entryPrice - 60
    }

    if (bias === 'bullish' && tpPrice <= entryPrice) continue
    if (bias === 'bearish' && tpPrice >= entryPrice) continue

    const tpDist = Math.abs(tpPrice - entryPrice)
    if (tpDist / slDist < MIN_RR) continue

    const entryIdx1m = candles1m.findIndex(c => c.time >= entryCandle.time)
    const future1m   = candles1m.slice(entryIdx1m + 1, entryIdx1m + 300)
    let outcome = null, exitPrice = null, exitTime = null

    for (const fc of future1m) {
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
      rr:          parseFloat((tpDist / slDist).toFixed(2)),
      signal:      'Sweep+BOS+1mIFVG',
    })

    lastTradeTime = now5m.time
    i += 10
  }

  return trades
}

// ── Live signal ───────────────────────────────────────────────────────────────
export function getLiveSignal(candles5m, candles1m) {
  if (!candles5m?.length || !candles1m?.length) return null

  const recent5m = candles5m.slice(-30)
  const nowTs    = recent5m[recent5m.length - 1]?.time
  if (!nowTs) return null

  // Kill zone check
  if (!isKillZone(nowTs)) return null

  // Confluence 1: Daily H/L sweep (required)
  const dailyHL = buildDailyHL(candles5m)
  const pdhl    = getPrevDayHL(dailyHL, nowTs)
  if (!pdhl) return null

  let sweepBias = null, sweepTime = null
  for (let j = recent5m.length - 1; j >= 0; j--) {
    const c = recent5m[j]
    if (c.low < pdhl.low && c.close > pdhl.low)    { sweepBias = 'bullish'; sweepTime = c.time; break }
    if (c.high > pdhl.high && c.close < pdhl.high)  { sweepBias = 'bearish'; sweepTime = c.time; break }
  }
  if (!sweepBias) return null

  // Confluence 2: BOS on 5M AFTER the sweep, same direction (required)
  const postSweep5m = recent5m.filter(c => c.time > sweepTime)
  if (postSweep5m.length < 4) return null
  const { highs: h5, lows: l5 } = detectSwings(postSweep5m, 2)
  const bosList   = detectBOS(postSweep5m, h5, l5).filter(b => b.type === sweepBias)
  if (!bosList.length) return null
  const latestBOS = bosList[bosList.length - 1]

  const bias = sweepBias

  // Entry: 1M FVG + IFVG after BOS
  const m1After = candles1m.filter(c => c.time >= latestBOS.time)
  if (m1After.length < 5) return null

  const fvgs1m = detectFVGs(m1After).filter(f => f.type === bias)
  if (!fvgs1m.length) return null
  const fvg1m = fvgs1m[fvgs1m.length - 1]
  if (fvg1m.top - fvg1m.bottom < 7) return null

  const m1PostFVG   = m1After.filter(c => c.time > fvg1m.time)
  const entryCandle = findIFVGEntry(m1PostFVG, fvg1m, bias)
  if (!entryCandle) return null

  return bias === 'bullish' ? 'LONG' : 'SHORT'
}
