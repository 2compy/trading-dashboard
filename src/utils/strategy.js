// ─────────────────────────────────────────────────────────────────────────────
// Multi-Strategy ICT/SMC Engine — 10 confluence strategies
//
//  1. Kill Zone Filter        (London / NY Open / Silver Bullet / PM)
//  2. HTF Bias                (1H FVG direction)
//  3. Premium / Discount      (only longs in discount, shorts in premium)
//  4. Order Block Entry       (5M + 1M)
//  5. FVG + OB Confluence     (Unicorn Model overlap = highest probability)
//  6. IFVG Inversion          (FVG flips at midpoint → Breaker signal)
//  7. Break of Structure      (1M direction confirmation)
//  8. Turtle Soup             (liquidity sweep + close-back reversal)
//  9. OTE Fibonacci Zone      (61.8–78.6% retracement entry)
// 10. Judas Swing / Displacement (false push → real move + impulse candle)
//
//  Signal fires when confluence score >= 5 out of 10
// ─────────────────────────────────────────────────────────────────────────────

const KILL_ZONES = [
  { name: 'London',  startH: 2,  endH: 5  },
  { name: 'NY Open', startH: 7,  endH: 10 },
  { name: 'SB',      startH: 10, endH: 11 },
  { name: 'SB2',     startH: 14, endH: 15 }, // PM Silver Bullet 2:00–3:00 ET
  { name: 'PM',      startH: 13, endH: 16 },
]

const PREFERRED_KZ = {
  'MES1!': ['NY Open', 'SB', 'SB2', 'PM'],
  'MNQ1!': ['NY Open', 'SB', 'SB2', 'PM'],
  'MGC1!': ['London', 'NY Open', 'SB'],
  'MSL1!': ['London', 'NY Open', 'SB'],
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

function getETMinute(ts) {
  try {
    const s = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', minute: 'numeric',
    }).format(new Date(ts * 1000))
    return parseInt(s)
  } catch { return 0 }
}

export function getKillZone(ts, symbol) {
  const h    = getETHour(ts)
  const pref = PREFERRED_KZ[symbol] || KILL_ZONES.map(k => k.name)
  return KILL_ZONES.find(k => h >= k.startH && h < k.endH && pref.includes(k.name)) || null
}

function getSessionPhase(ts) {
  const h = getETHour(ts)
  if (h >= 20 || h < 2)  return 'accumulation'   // Asian session
  if (h >= 2  && h < 7)  return 'manipulation'
  if (h >= 7  && h < 16) return 'distribution'
  return null
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

// ── Order Blocks ──────────────────────────────────────────────────────────────
export function detectOBs(candles) {
  const obs = []
  for (let i = 1; i < candles.length - 1; i++) {
    const c = candles[i], next = candles[i + 1]
    if (c.close < c.open && next.close > c.open && (next.close - next.open) > (c.open - c.close) * 0.5)
      obs.push({ type: 'bullish', top: c.open, bottom: c.close, mid: (c.open + c.close) / 2, time: c.time, index: i })
    if (c.close > c.open && next.close < c.open && (next.open - next.close) > (c.close - c.open) * 0.5)
      obs.push({ type: 'bearish', top: c.close, bottom: c.open, mid: (c.open + c.close) / 2, time: c.time, index: i })
  }
  return obs
}

// ── Breaker Blocks (violated OBs that flip direction) ────────────────────────
// A bullish OB that price breaks below becomes a bearish breaker (supply)
// A bearish OB that price breaks above becomes a bullish breaker (demand)
export function detectBreakerBlocks(candles) {
  const obs      = detectOBs(candles)
  const breakers = []
  for (const ob of obs) {
    const subsequent = candles.filter(c => c.time > ob.time)
    let broken = false
    for (const c of subsequent) {
      if (ob.type === 'bullish' && c.low < ob.bottom) { broken = true; break }
      if (ob.type === 'bearish' && c.high > ob.top)   { broken = true; break }
    }
    if (broken) {
      breakers.push({
        ...ob,
        type: ob.type === 'bullish' ? 'bearish' : 'bullish', // flipped
        breaker: true,
      })
    }
  }
  return breakers
}

// ── HTF Bias from 1H FVGs ─────────────────────────────────────────────────────
export function getHTFBias(h1Candles) {
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
  return active.length ? active[active.length - 1].type : null
}

// ── IFVG: Inverse Fair Value Gap ──────────────────────────────────────────────
export function applyIFVG(candles, fvgs) {
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

// ── Break of Structure ────────────────────────────────────────────────────────
export function detectBOS(candles, swingHighs, swingLows) {
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

// ── Market Structure Shift (MSS) — aggressive BOS with displacement ───────────
export function detectMSS(candles) {
  const { highs, lows } = detectSwings(candles, 2)
  const mss = []
  for (let i = 2; i < candles.length; i++) {
    const c    = candles[i]
    const body = Math.abs(c.close - c.open)
    const range = c.high - c.low
    const isDisplacement = range > 0 && body / range > 0.6 // strong bodied candle

    if (isDisplacement) {
      if (c.close > c.open) {
        const priorLow = lows.filter(l => l.time < c.time).slice(-1)[0]
        if (priorLow && c.low < priorLow.price && c.close > priorLow.price)
          mss.push({ type: 'bullish', price: c.close, time: c.time, displacement: true })
      } else {
        const priorHigh = highs.filter(h => h.time < c.time).slice(-1)[0]
        if (priorHigh && c.high > priorHigh.price && c.close < priorHigh.price)
          mss.push({ type: 'bearish', price: c.close, time: c.time, displacement: true })
      }
    }
  }
  return mss
}

// ── Liquidity Sweeps ──────────────────────────────────────────────────────────
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

// ── Turtle Soup: sweep of prior swing + close back inside ─────────────────────
// Bullish Turtle Soup: price sweeps a prior swing low then closes back above it
// Bearish Turtle Soup: price sweeps a prior swing high then closes back below it
export function detectTurtleSoup(candles) {
  const { highs, lows } = detectSwings(candles, 3)
  const signals = []
  for (let i = 3; i < candles.length; i++) {
    const c = candles[i]

    // Bullish: wick below prior swing low, close above it
    const priorLow = lows.filter(l => l.time < c.time).slice(-1)[0]
    if (priorLow && c.low < priorLow.price && c.close > priorLow.price) {
      signals.push({ type: 'bullish', price: c.close, sweepPrice: priorLow.price, time: c.time })
    }

    // Bearish: wick above prior swing high, close below it
    const priorHigh = highs.filter(h => h.time < c.time).slice(-1)[0]
    if (priorHigh && c.high > priorHigh.price && c.close < priorHigh.price) {
      signals.push({ type: 'bearish', price: c.close, sweepPrice: priorHigh.price, time: c.time })
    }
  }
  return signals
}

// ── Judas Swing: opening push in wrong direction before real move ─────────────
// Within first 30 min of session, price moves against bias then reverses
export function detectJudasSwing(candles, bias, sessionStartHour) {
  const sessionCandles = candles.filter(c => {
    const h = getETHour(c.time)
    const m = getETMinute(c.time)
    return h === sessionStartHour && m <= 30
  })
  if (sessionCandles.length < 3) return false

  const firstClose = sessionCandles[0].close
  const lastClose  = sessionCandles[sessionCandles.length - 1].close

  if (bias === 'bullish') {
    const hasDownMove = sessionCandles.some(c => c.close < firstClose * 0.9995)
    return hasDownMove && lastClose > firstClose
  } else {
    const hasUpMove = sessionCandles.some(c => c.close > firstClose * 1.0005)
    return hasUpMove && lastClose < firstClose
  }
}

// ── OTE: Optimal Trade Entry (61.8%–78.6% fib retracement) ───────────────────
export function detectOTE(candles, bias) {
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

// ── Premium / Discount Arrays ─────────────────────────────────────────────────
// Longs should be taken at/below 50% of the range (discount)
// Shorts should be taken at/above 50% of the range (premium)
export function getPremiumDiscount(candles, bias, currentPrice) {
  const { highs, lows } = detectSwings(candles, 3)
  if (!highs.length || !lows.length) return true // default allow
  const high = highs[highs.length - 1].price
  const low  = lows[lows.length - 1].price
  const mid  = (high + low) / 2
  if (bias === 'bullish') return currentPrice <= mid   // discount zone
  if (bias === 'bearish') return currentPrice >= mid   // premium zone
  return true
}

// ── Asian Range: track overnight session high/low ─────────────────────────────
export function getAsianRange(candles) {
  const asian = candles.filter(c => {
    const h = getETHour(c.time)
    return h >= 20 || h < 2
  })
  if (!asian.length) return null
  return {
    high: Math.max(...asian.map(c => c.high)),
    low:  Math.min(...asian.map(c => c.low)),
  }
}

// ── Unicorn Model: FVG + Breaker Block overlap ────────────────────────────────
export function detectUnicorn(candles, bias) {
  const fvgs     = detectFVGs(candles).filter(f => f.type === bias)
  const breakers = detectBreakerBlocks(candles).filter(b => b.type === bias)
  if (!fvgs.length || !breakers.length) return false

  const lastFVG = fvgs[fvgs.length - 1]
  const lastBrk = breakers[breakers.length - 1]

  // Check for price range overlap
  const overlapTop    = Math.min(lastFVG.top, lastBrk.top)
  const overlapBottom = Math.max(lastFVG.bottom, lastBrk.bottom)
  return overlapTop > overlapBottom
}

// ── Displacement candle ───────────────────────────────────────────────────────
export function hasDisplacementCandle(candles, bias) {
  const recent = candles.slice(-5)
  return recent.some(c => {
    const body  = Math.abs(c.close - c.open)
    const range = c.high - c.low
    if (range === 0) return false
    const strongBody = body / range > 0.65
    if (bias === 'bullish') return strongBody && c.close > c.open
    if (bias === 'bearish') return strongBody && c.close < c.open
    return false
  })
}

// ── Contract multipliers ──────────────────────────────────────────────────────
export const CONTRACT_MULTIPLIER = {
  'MES1!': 5,
  'MNQ1!': 2,
  'MGC1!': 10,
  'MSL1!': 5,
}

const SL_DOLLARS = 200
const TP_DOLLARS = 300

// ── Full backtest ─────────────────────────────────────────────────────────────
export function runBacktest(candles1h, candles5m, candles1m, symbol = 'MES1!') {
  const multiplier   = CONTRACT_MULTIPLIER[symbol] || 5
  const stopPoints   = SL_DOLLARS / multiplier
  const targetPoints = TP_DOLLARS / multiplier
  const trades       = []

  if (!candles1h.length || !candles5m.length || !candles1m.length) return trades

  for (let i = 20; i < candles5m.length - 1; i++) {
    const now5m = candles5m[i]

    const killZone = getKillZone(now5m.time, symbol)
    if (!killZone) continue
    if (getSessionPhase(now5m.time) === 'accumulation') continue

    const h1Slice = candles1h.filter(c => c.time <= now5m.time)
    if (h1Slice.length < 10) continue
    const bias = getHTFBias(h1Slice)
    if (!bias) continue

    const recent5m = candles5m.slice(Math.max(0, i - 20), i + 1)
    const fvgs5m   = detectFVGs(recent5m).filter(f => f.type === bias)
    const obs5m    = detectOBs(recent5m).filter(ob => ob.type === bias)
    if (!fvgs5m.length && !obs5m.length) continue
    const anchorTime = fvgs5m.length ? fvgs5m[fvgs5m.length - 1].time : obs5m[obs5m.length - 1].time

    const m1Slice = candles1m.filter(c => c.time > anchorTime && c.time <= now5m.time)
    if (m1Slice.length < 5) continue

    const raw1mFVGs   = detectFVGs(m1Slice)
    const ifvgSignals = applyIFVG(m1Slice, raw1mFVGs).filter(f => f.inversed && f.effectiveType === bias)
    if (!ifvgSignals.length) continue

    const { highs: m1H, lows: m1L } = detectSwings(m1Slice, 2)
    const bos          = detectBOS(m1Slice, m1H, m1L).filter(b => b.type === bias)
    const latestIFVG   = ifvgSignals[ifvgSignals.length - 1]
    const bosAfterIFVG = bos.filter(b => b.time >= latestIFVG.time)
    if (!bosAfterIFVG.length) continue

    // Confluence scoring
    let score = 3 // killzone + bias + ifvg+bos = 3 base points
    const currentPrice = now5m.close

    if (getPremiumDiscount(recent5m, bias, currentPrice)) score++
    if (detectUnicorn(recent5m, bias)) score++
    if (hasDisplacementCandle(m1Slice, bias)) score++
    const turtleSoup = detectTurtleSoup(m1Slice).filter(t => t.type === bias)
    if (turtleSoup.length) score++
    const mss = detectMSS(m1Slice).filter(m => m.type === bias)
    if (mss.length) score++
    const ote = detectOTE(recent5m, bias)
    if (ote && currentPrice >= ote.bottom && currentPrice <= ote.top) score++
    const asianRange = getAsianRange(candles1m.filter(c => c.time <= now5m.time).slice(-200))
    if (asianRange) {
      const sweptAsian = bias === 'bullish'
        ? candles5m.slice(Math.max(0, i - 5), i).some(c => c.low < asianRange.low)
        : candles5m.slice(Math.max(0, i - 5), i).some(c => c.high > asianRange.high)
      if (sweptAsian) score++
    }

    if (score < 5) continue // require at least 5/10 confluence

    const confirmation = bosAfterIFVG.sort((a, b) => a.time - b.time)[0]
    const entryPrice   = m1Slice.find(c => c.time >= confirmation.time)?.close
    if (!entryPrice) continue

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

    const strategies = [
      'KillZone', 'HTF-Bias', 'IFVG+BOS',
      score >= 4 ? 'PremDiscount' : null,
      score >= 5 ? 'Unicorn/OB' : null,
      score >= 6 ? 'Displacement' : null,
      score >= 7 ? 'TurtleSoup' : null,
      score >= 8 ? 'MSS' : null,
      score >= 9 ? 'OTE' : null,
      score >= 10 ? 'AsianSweep' : null,
    ].filter(Boolean)

    trades.push({
      id: trades.length + 1, time: confirmation.time, bias,
      entryPrice:  parseFloat(entryPrice.toFixed(4)),
      stopPrice:   parseFloat(stopPrice.toFixed(4)),
      targetPrice: parseFloat(targetPrice.toFixed(4)),
      exitPrice:   parseFloat(exitPrice.toFixed(4)),
      exitTime, outcome,
      pnlDollars: outcome === 'win' ? TP_DOLLARS : -SL_DOLLARS,
      rr: (TP_DOLLARS / SL_DOLLARS).toFixed(2),
      score,
      signal: strategies.join('+'),
    })
    i += 5
  }

  return trades
}

// ── Live signal (used by auto-trader) — full confluence scoring ───────────────
export function getLiveSignal(candles1h, candles5m, candles1m, symbol) {
  if (!candles1h?.length || !candles5m?.length || !candles1m?.length) return null

  const nowTs = candles5m[candles5m.length - 1]?.time
  if (!nowTs) return null

  // 1. Kill Zone
  const killZone = getKillZone(nowTs, symbol)
  if (!killZone) return null

  // No trades during accumulation
  if (getSessionPhase(nowTs) === 'accumulation') return null

  // 2. HTF Bias
  const bias = getHTFBias(candles1h)
  if (!bias) return null

  let score = 2 // kill zone + bias

  const recent5m = candles5m.slice(-20)
  const recent1m = candles1m.slice(-40)
  const currentPrice = candles5m[candles5m.length - 1].close

  // 3. FVG / OB on 5M
  const fvgs5m = detectFVGs(recent5m).filter(f => f.type === bias)
  const obs5m  = detectOBs(recent5m).filter(ob => ob.type === bias)
  if (fvgs5m.length || obs5m.length) score++

  // 4. IFVG + BOS on 1M
  const raw1m   = detectFVGs(recent1m)
  const ifvgs   = applyIFVG(recent1m, raw1m).filter(f => f.inversed && f.effectiveType === bias)
  const { highs, lows } = detectSwings(recent1m, 2)
  const bos     = detectBOS(recent1m, highs, lows).filter(b => b.type === bias)
  if (ifvgs.length && bos.length) {
    const latestIFVG   = ifvgs[ifvgs.length - 1]
    const bosAfterIFVG = bos.filter(b => b.time >= latestIFVG.time)
    if (bosAfterIFVG.length) score++
  }

  // 5. Premium / Discount zone
  if (getPremiumDiscount(recent5m, bias, currentPrice)) score++

  // 6. Unicorn Model (FVG + Breaker overlap)
  if (detectUnicorn(recent5m, bias)) score++

  // 7. Displacement candle on 1M
  if (hasDisplacementCandle(recent1m, bias)) score++

  // 8. Turtle Soup (sweep reversal)
  const turtleSoup = detectTurtleSoup(recent1m).filter(t => t.type === bias)
  if (turtleSoup.length) score++

  // 9. Market Structure Shift on 1M
  const mss = detectMSS(recent1m).filter(m => m.type === bias)
  if (mss.length) score++

  // 10. OTE zone on 5M
  const ote = detectOTE(recent5m, bias)
  if (ote && currentPrice >= ote.bottom && currentPrice <= ote.top) score++

  if (score < 5) return null

  return bias === 'bullish' ? 'LONG' : 'SHORT'
}
