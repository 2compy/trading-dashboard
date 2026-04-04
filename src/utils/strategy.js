// ─────────────────────────────────────────────────────────────────────────────
// Strategy: Daily H/L Liquidity Sweep + BOS + FVG + 1M IFVG Entry
//
// Steps:
//  1. Mark previous day's high and low (liquidity targets)
//  2. Wait for price to sweep the daily high or low (wick through + close back)
//  3. Sweep of daily LOW → bullish bias, TP = daily HIGH
//     Sweep of daily HIGH → bearish bias, TP = daily LOW
//  4. 5M: look for BOS in bias direction after sweep
//  5. 5M: look for FVG in bias direction after BOS
//  6. 1M: wait for IFVG (FVG that gets tapped at midpoint and flips)
//  7. Enter on 1M IFVG confirmation
//  8. SL = below sweep wick low (long) / above sweep wick high (short)
//  9. Skip if RR < 2
// ─────────────────────────────────────────────────────────────────────────────

// ── Time helpers ──────────────────────────────────────────────────────────────
function getETDateStr(ts) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ts * 1000))
}

// ── Daily H/L from 5M candles ────────────────────────────────────────────────
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

// ── IFVG entry: first candle that closes back through the FVG after retracing into it
// Bullish: price retraces into gap (close < fvg.top), first close back above fvg.top = entry
// Bearish: price retraces into gap (close > fvg.bottom), first close back below fvg.bottom = entry
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

// kept for backtest compatibility
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
  let lastSweepTime = 0

  for (let i = 10; i < candles5m.length - 1; i++) {
    const now5m = candles5m[i]

    // Cooldown — don't take overlapping trades
    if (now5m.time - lastSweepTime < 3600) continue

    // ── Step 1: Get previous day H/L ────────────────────────────────────────
    const pdhl = getPrevDayHL(dailyHL, now5m.time)
    if (!pdhl) continue

    // ── Step 2: Detect liquidity sweep on 5M ────────────────────────────────
    // Bullish: wick below daily low + close above it
    // Bearish: wick above daily high + close below it
    let bias = null, sweepPrice = null, sweepCandleIdx = null

    const lookback5m = candles5m.slice(Math.max(0, i - 20), i + 1)
    for (let j = lookback5m.length - 1; j >= 0; j--) {
      const c = lookback5m[j]
      if (c.low < pdhl.low && c.close > pdhl.low) {
        bias            = 'bullish'
        sweepPrice      = c.low
        sweepCandleIdx  = Math.max(0, i - 20) + j
        break
      }
      if (c.high > pdhl.high && c.close < pdhl.high) {
        bias            = 'bearish'
        sweepPrice      = c.high
        sweepCandleIdx  = Math.max(0, i - 20) + j
        break
      }
    }
    if (!bias || sweepCandleIdx === null) continue

    const sweepTime = candles5m[sweepCandleIdx].time

    // ── Step 3: BOS on 5M after the sweep ───────────────────────────────────
    const post5m    = candles5m.slice(sweepCandleIdx, i + 1)
    const { highs: h5, lows: l5 } = detectSwings(post5m, 2)
    const bos5m     = detectBOS(post5m, h5, l5).filter(b => b.type === bias)
    if (!bos5m.length) continue
    const bosTime   = bos5m[bos5m.length - 1].time

    // ── Step 4: FVG on 5M after BOS ─────────────────────────────────────────
    const afterBos5m = candles5m.slice(sweepCandleIdx, i + 1).filter(c => c.time >= bosTime)
    if (afterBos5m.length < 3) continue
    const fvgs5m = detectFVGs(afterBos5m).filter(f => f.type === bias)
    if (!fvgs5m.length) continue
    const lastFVG5m = fvgs5m[fvgs5m.length - 1]

    // ── Step 5: IFVG on 1M after the 5M FVG ────────────────────────────────
    const m1After = candles1m.filter(c => c.time > lastFVG5m.time && c.time <= now5m.time)
    if (m1After.length < 5) continue

    const raw1m  = detectFVGs(m1After)
    const ifvgs  = applyIFVG(m1After, raw1m).filter(f => f.inversed && f.effectiveType === bias)
    if (!ifvgs.length) continue

    const latestIFVG = ifvgs[ifvgs.length - 1]
    const entryCandle = m1After.find(c => c.time > latestIFVG.time)
    if (!entryCandle) continue
    const entryPrice = entryCandle.close

    // ── Step 6: SL and TP ───────────────────────────────────────────────────
    // SL = below/above the sweep wick
    // TP = daily HIGH for longs, daily LOW for shorts
    const slPrice = bias === 'bullish'
      ? sweepPrice - (pdhl.high - pdhl.low) * 0.005  // small buffer below sweep low
      : sweepPrice + (pdhl.high - pdhl.low) * 0.005  // small buffer above sweep high

    const tpPrice = bias === 'bullish' ? pdhl.high : pdhl.low

    // Skip if TP is on wrong side of entry
    if (bias === 'bullish' && tpPrice <= entryPrice) continue
    if (bias === 'bearish' && tpPrice >= entryPrice) continue

    const slDist = Math.abs(entryPrice - slPrice)
    const tpDist = Math.abs(tpPrice - entryPrice)
    if (slDist === 0) continue
    const rr = tpDist / slDist
    if (rr < MIN_RR) continue

    // ── Step 7: Simulate outcome ─────────────────────────────────────────────
    const entryIdx1m  = candles1m.findIndex(c => c.time >= entryCandle.time)
    const future1m    = candles1m.slice(entryIdx1m + 1, entryIdx1m + 300)
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

    const pnlPoints = outcome === 'win' ? tpDist : -slDist
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
      rr:          parseFloat(rr.toFixed(2)),
      signal:      `DailyHL-Sweep+BOS+FVG+IFVG`,
    })

    lastSweepTime = now5m.time
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

  // Confluence 1: Daily H/L sweep
  const dailyHL = buildDailyHL(candles5m)
  const pdhl    = getPrevDayHL(dailyHL, nowTs)
  let sweepBias = null
  if (pdhl) {
    for (let j = recent5m.length - 1; j >= 0; j--) {
      const c = recent5m[j]
      if (c.low < pdhl.low && c.close > pdhl.low)   { sweepBias = 'bullish'; break }
      if (c.high > pdhl.high && c.close < pdhl.high) { sweepBias = 'bearish'; break }
    }
  }

  // Confluence 2: BOS on 5M
  const { highs: h5, lows: l5 } = detectSwings(recent5m, 2)
  const allBOS    = detectBOS(recent5m, h5, l5)
  const latestBOS = allBOS.length ? allBOS[allBOS.length - 1] : null
  const bosBias   = latestBOS?.type || null

  // Need at least one confluence
  const bullVotes = (sweepBias === 'bullish' ? 1 : 0) + (bosBias === 'bullish' ? 1 : 0)
  const bearVotes = (sweepBias === 'bearish' ? 1 : 0) + (bosBias === 'bearish' ? 1 : 0)
  if (bullVotes === 0 && bearVotes === 0) return null
  const bias = bullVotes >= bearVotes ? 'bullish' : 'bearish'

  const anchorTime = latestBOS?.time || recent5m[0].time

  // Entry: 1M FVG + IFVG
  const m1After = candles1m.filter(c => c.time >= anchorTime)
  if (m1After.length < 5) return null
  const fvgs1m = detectFVGs(m1After).filter(f => f.type === bias)
  if (!fvgs1m.length) return null
  const fvg1m = fvgs1m[fvgs1m.length - 1]
  if (fvg1m.top - fvg1m.bottom < 7) return null  // must be at least 7pts wide

  const m1PostFVG   = m1After.filter(c => c.time > fvg1m.time)
  const entryCandle = findIFVGEntry(m1PostFVG, fvg1m, bias)
  if (!entryCandle) return null

  return bias === 'bullish' ? 'LONG' : 'SHORT'
}
