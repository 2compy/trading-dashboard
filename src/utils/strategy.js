// ICT / SMC Strategy Implementation
// Multi-timeframe: 1H bias (FVG) → 5M entry (FVG) → 1M confirmation (BOS / liquidity sweep)

// ─── Swing Highs & Lows ──────────────────────────────────────────────────────
export function detectSwings(candles, lookback = 3) {
  const highs = []
  const lows  = []

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

// ─── Fair Value Gap ───────────────────────────────────────────────────────────
// Bullish FVG: gap between candle[i-1].high and candle[i+1].low  (no overlap)
// Bearish FVG: gap between candle[i-1].low  and candle[i+1].high (no overlap)
export function detectFVGs(candles) {
  const fvgs = []

  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1]
    const next = candles[i + 1]

    if (next.low > prev.high) {
      fvgs.push({
        type: 'bullish',
        top:    next.low,
        bottom: prev.high,
        mid:    (next.low + prev.high) / 2,
        time:   candles[i].time,
        index:  i,
      })
    }

    if (next.high < prev.low) {
      fvgs.push({
        type: 'bearish',
        top:    prev.low,
        bottom: next.high,
        mid:    (prev.low + next.high) / 2,
        time:   candles[i].time,
        index:  i,
      })
    }
  }

  return fvgs
}

// Get the most recent unmitigated FVG bias from 1H candles
export function getHTFBias(h1Candles) {
  const fvgs = detectFVGs(h1Candles)
  if (!fvgs.length) return null

  // Walk forward and mark mitigated FVGs
  for (const fvg of fvgs) {
    const subsequent = h1Candles.filter(c => c.time > fvg.time)
    for (const c of subsequent) {
      if (fvg.type === 'bullish' && c.low <= fvg.mid)  { fvg.mitigated = true; break }
      if (fvg.type === 'bearish' && c.high >= fvg.mid) { fvg.mitigated = true; break }
    }
  }

  const active = fvgs.filter(f => !f.mitigated)
  if (!active.length) return null

  return active[active.length - 1].type // 'bullish' | 'bearish'
}

// ─── Inverse Fair Value Gap (IFVG) ─────────────────────────────��─────────────
// When price reaches the midpoint of a 1M FVG, the FVG inverts its direction.
// Bullish FVG → price hits mid → becomes bearish IFVG (now acts as resistance)
// Bearish FVG → price hits mid → becomes bullish IFVG (now acts as support)
export function applyIFVG(candles, fvgs) {
  return fvgs.map(fvg => {
    const subsequent = candles.filter(c => c.time > fvg.time)
    let inversed = false

    for (const c of subsequent) {
      if (fvg.type === 'bullish' && c.low <= fvg.mid)  { inversed = true; break }
      if (fvg.type === 'bearish' && c.high >= fvg.mid) { inversed = true; break }
    }

    return {
      ...fvg,
      inversed,
      // effectiveType is what the FVG now represents after potential inversion
      effectiveType: inversed
        ? (fvg.type === 'bullish' ? 'bearish' : 'bullish')
        : fvg.type,
    }
  })
}

// ─── Break of Structure ───────────────────────────────────────────────────────
export function detectBOS(candles, swingHighs, swingLows) {
  const bos = []

  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i]
    const prev = candles[i - 1]

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

// ─── Liquidity Sweeps ─────────────────────────────────────────────────────────
// Sweep high → close back below (bearish reversal signal)
// Sweep low  → close back above (bullish reversal signal)
export function detectSweeps(candles, swingHighs, swingLows) {
  const sweeps = []

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]

    const priorHighs = swingHighs.filter(s => s.time < c.time)
    if (priorHighs.length) {
      const last = priorHighs[priorHighs.length - 1]
      if (c.high > last.price && c.close < last.price)
        sweeps.push({ type: 'bearish', price: last.price, time: c.time, index: i })
    }

    const priorLows = swingLows.filter(s => s.time < c.time)
    if (priorLows.length) {
      const last = priorLows[priorLows.length - 1]
      if (c.low < last.price && c.close > last.price)
        sweeps.push({ type: 'bullish', price: last.price, time: c.time, index: i })
    }
  }

  return sweeps
}

// ─── Full Backtest ─────────────────────────────────────────────────────────────
// Runs the multi-TF strategy against historical candle data.
// candles1h / candles5m / candles1m should be sorted ascending by time.
export function runBacktest(candles1h, candles5m, candles1m, opts = {}) {
  const { riskPct = 1, rewardRatio = 2 } = opts
  const trades = []

  if (!candles1h.length || !candles5m.length || !candles1m.length) return trades

  // Step through 5m candles sequentially, simulating live trading
  for (let i = 20; i < candles5m.length - 1; i++) {
    const now5m = candles5m[i]

    // 1. Determine 1H bias at this point in time
    const h1Slice = candles1h.filter(c => c.time <= now5m.time)
    if (h1Slice.length < 10) continue
    const bias = getHTFBias(h1Slice)
    if (!bias) continue

    // 2. Find a 5M FVG aligned with bias within last 10 candles
    const recent5m = candles5m.slice(Math.max(0, i - 10), i + 1)
    const fvgs5m = detectFVGs(recent5m).filter(f => f.type === bias)
    if (!fvgs5m.length) continue
    const fvg = fvgs5m[fvgs5m.length - 1]

    // 3. Check 1M for BOS, liquidity sweep, or IFVG confirming bias
    const m1Slice = candles1m.filter(c => c.time > fvg.time && c.time <= now5m.time + 300)
    if (m1Slice.length < 5) continue

    const { highs: m1Highs, lows: m1Lows } = detectSwings(m1Slice, 2)
    const bos    = detectBOS(m1Slice, m1Highs, m1Lows).filter(b => b.type === bias)
    const sweeps = detectSweeps(m1Slice, m1Highs, m1Lows).filter(s => s.type === bias)

    // 1M FVGs with IFVG inversion applied — an inversed FVG that now matches
    // our bias is an additional confirmation signal
    const raw1mFVGs    = detectFVGs(m1Slice)
    const ifvg1m       = applyIFVG(m1Slice, raw1mFVGs)
    const ifvgSignals  = ifvg1m.filter(f => f.inversed && f.effectiveType === bias)

    if (!bos.length && !sweeps.length && !ifvgSignals.length) continue

    // If only IFVG confirmed (no BOS/sweep), use the inversion candle time as confirmation
    const ifvgConfirm = ifvgSignals.length
      ? [{ time: ifvgSignals[ifvgSignals.length - 1].time, price: ifvgSignals[ifvgSignals.length - 1].mid }]
      : []

    // 4. Entry: earliest confirmation (BOS, sweep, or IFVG)
    const confirmation = [...bos, ...sweeps, ...ifvgConfirm].sort((a, b) => a.time - b.time)[0]
    const entryPrice = m1Slice.find(c => c.time >= confirmation.time)?.close
    if (!entryPrice) continue

    // 5. Stop loss: opposite side of the 5M FVG
    const stopPrice = bias === 'bullish' ? fvg.bottom * 0.9995 : fvg.top * 1.0005
    const stopDist  = Math.abs(entryPrice - stopPrice)
    if (stopDist === 0) continue

    // 6. Target: nearest resting liquidity (swing high for longs, swing low for shorts)
    const futureCandles5m = candles5m.slice(i + 1, i + 50)
    const { highs: futHighs, lows: futLows } = detectSwings(
      candles5m.slice(Math.max(0, i - 20), i + 1), 2
    )

    let targetPrice
    if (bias === 'bullish') {
      const above = futHighs.filter(h => h.price > entryPrice)
      targetPrice = above.length ? above[0].price : entryPrice + stopDist * rewardRatio
    } else {
      const below = futLows.filter(l => l.price < entryPrice)
      targetPrice = below.length ? below[0].price : entryPrice - stopDist * rewardRatio
    }

    // 7. Simulate the trade outcome on future 5m candles
    let outcome = null
    let exitPrice = null
    let exitTime  = null

    for (const fc of futureCandles5m) {
      if (bias === 'bullish') {
        if (fc.low  <= stopPrice)  { outcome = 'loss'; exitPrice = stopPrice;  exitTime = fc.time; break }
        if (fc.high >= targetPrice){ outcome = 'win';  exitPrice = targetPrice; exitTime = fc.time; break }
      } else {
        if (fc.high >= stopPrice)  { outcome = 'loss'; exitPrice = stopPrice;  exitTime = fc.time; break }
        if (fc.low  <= targetPrice){ outcome = 'win';  exitPrice = targetPrice; exitTime = fc.time; break }
      }
    }

    if (!outcome) continue // trade never resolved in window

    const pnlPct = bias === 'bullish'
      ? ((exitPrice - entryPrice) / entryPrice) * 100
      : ((entryPrice - exitPrice) / entryPrice) * 100

    const hasIFVG = ifvgSignals.length > 0
    trades.push({
      id:          trades.length + 1,
      time:        confirmation.time,
      bias,
      entryPrice:  parseFloat(entryPrice.toFixed(4)),
      stopPrice:   parseFloat(stopPrice.toFixed(4)),
      targetPrice: parseFloat(targetPrice.toFixed(4)),
      exitPrice:   parseFloat(exitPrice.toFixed(4)),
      exitTime,
      outcome,
      pnlPct:      parseFloat(pnlPct.toFixed(2)),
      rr:          parseFloat((Math.abs(targetPrice - entryPrice) / stopDist).toFixed(2)),
      signal:      hasIFVG ? (bos.length || sweeps.length ? 'BOS+IFVG' : 'IFVG') : (bos.length ? 'BOS' : 'SWEEP'),
    })

    // Skip ahead to avoid overlapping trades
    i += 5
  }

  return trades
}

// ─── Live signal for auto-trading ─────────────────────────────────────────────
export function getLiveSignal(candles1h, candles5m, candles1m) {
  if (!candles1h?.length || !candles5m?.length || !candles1m?.length) return null

  const bias = getHTFBias(candles1h)
  if (!bias) return null

  const recent5m = candles5m.slice(-15)
  const fvgs5m   = detectFVGs(recent5m).filter(f => f.type === bias)
  if (!fvgs5m.length) return null

  const recent1m = candles1m.slice(-20)
  const { highs, lows } = detectSwings(recent1m, 2)
  const bos    = detectBOS(recent1m, highs, lows).filter(b => b.type === bias)
  const sweeps = detectSweeps(recent1m, highs, lows).filter(s => s.type === bias)

  // Check 1M IFVG — an inversed 1M FVG aligned with bias is a valid entry signal
  const raw1m  = detectFVGs(recent1m)
  const ifvgs  = applyIFVG(recent1m, raw1m).filter(f => f.inversed && f.effectiveType === bias)

  if (!bos.length && !sweeps.length && !ifvgs.length) return null

  return bias === 'bullish' ? 'LONG' : 'SHORT'
}
