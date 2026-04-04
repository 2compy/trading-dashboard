// ─────────────────────────────────────────────────────────────────────────────
// Strategy: Daily H/L (or Session H/L) Liquidity Sweep + BOS + 1M IFVG / 5M fallback
//
// Rules (all required):
//  1. Kill zone only: London 3–5am ET, NY open 8:30am–12pm ET, NY PM 1:30–3pm ET
//  2. Liquidity sweep: prev day H/L OR session H/L — wick through + close back
//  3. BOS on 5M AFTER the sweep, same direction (min 3 post-sweep candles)
//  4. Entry: 1M FVG (min 3pt) + IFVG retrace; fallback = next 5m open after BOS
//  5. SL = sweep wick extreme + 2pt buffer, max 30pt
//  6. TP = nearest swing H/L in 50–70pt window (default 60pt)
//  7. Skip if RR < 2
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

// Kill zones: London open (3–5am ET), NY open (8:30am–12pm ET), NY PM (1:30–3pm ET)
export function isKillZone(ts) {
  const mins = getETMinutes(ts)
  return (mins >= 180 && mins < 300) ||   // London: 3:00–5:00 AM ET
         (mins >= 510 && mins < 720) ||   // NY open: 8:30 AM–12:00 PM ET
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

// ── Session H/L (current day's H/L from earlier candles) ─────────────────────
export function getSessionHL(candles5m, nowTs) {
  const todayStr = getETDateStr(nowTs)
  const todayCandles = candles5m.filter(c => getETDateStr(c.time) === todayStr)
  if (todayCandles.length <= 5) return null
  // Exclude last 3 candles to avoid self-reference
  const sessionCandles = todayCandles.slice(0, -3)
  let high = -Infinity, low = Infinity
  for (const c of sessionCandles) {
    if (c.high > high) high = c.high
    if (c.low  < low)  low  = c.low
  }
  return { high, low }
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

// ── Break of Structure (O(n) pointer-based — matches backtest) ───────────────
export function detectBOS(candles, swingHighs, swingLows) {
  const bos = []
  let lastHigh = null, lastLow = null, hPtr = 0, lPtr = 0
  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i], prev = candles[i - 1]
    while (hPtr < swingHighs.length && swingHighs[hPtr].time < curr.time) { lastHigh = swingHighs[hPtr]; hPtr++ }
    while (lPtr < swingLows.length  && swingLows[lPtr].time  < curr.time) { lastLow  = swingLows[lPtr];  lPtr++ }
    if (lastHigh && prev.close <= lastHigh.price && curr.close > lastHigh.price)
      bos.push({ type: 'bullish', price: lastHigh.price, time: curr.time })
    if (lastLow  && prev.close >= lastLow.price  && curr.close < lastLow.price)
      bos.push({ type: 'bearish', price: lastLow.price,  time: curr.time })
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

// ── Futures P&L helper ───────────────────────────────────────────────────────
export function calcFuturesPnl(entryPrice, exitPrice, symbol, side) {
  const mult = CONTRACT_MULTIPLIER[symbol] || 5
  const dir  = side === 'LONG' ? 1 : -1
  return parseFloat(((exitPrice - entryPrice) * mult * dir).toFixed(2))
}

const MIN_RR = 2

// ── Sweep detection (checks both prev day H/L and session H/L) ──────────────
function findSweep(recent5m, candles5m, nowTs) {
  const dailyHL = buildDailyHL(candles5m)
  const pdhl    = getPrevDayHL(dailyHL, nowTs)

  let sweepBias = null, sweepTime = null, sweepWickExtreme = null

  // Try prev day H/L sweep first
  if (pdhl) {
    for (let j = recent5m.length - 1; j >= 0; j--) {
      const c = recent5m[j]
      if (c.low < pdhl.low && c.close > pdhl.low)   { sweepBias = 'bullish'; sweepTime = c.time; sweepWickExtreme = c.low;  break }
      if (c.high > pdhl.high && c.close < pdhl.high) { sweepBias = 'bearish'; sweepTime = c.time; sweepWickExtreme = c.high; break }
    }
  }

  // Fallback: session H/L sweep (current day)
  if (!sweepBias) {
    const sessionHL = getSessionHL(candles5m, nowTs)
    if (sessionHL) {
      for (let j = recent5m.length - 1; j >= 0; j--) {
        const c = recent5m[j]
        if (c.low < sessionHL.low && c.close > sessionHL.low)    { sweepBias = 'bullish'; sweepTime = c.time; sweepWickExtreme = c.low;  break }
        if (c.high > sessionHL.high && c.close < sessionHL.high)  { sweepBias = 'bearish'; sweepTime = c.time; sweepWickExtreme = c.high; break }
      }
    }
  }

  return { sweepBias, sweepTime, sweepWickExtreme, dailyHL, pdhl }
}

// ── Full backtest (client-side, kept for compatibility) ──────────────────────
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

    // Confluence 2: BOS on 5M AFTER the sweep, same direction
    const postSweep5m = recent5m.filter(c => c.time > sweepTime)
    if (postSweep5m.length < 3) continue
    const { highs: h5, lows: l5 } = detectSwings(postSweep5m, 2)
    const bosList = detectBOS(postSweep5m, h5, l5).filter(b => b.type === sweepBias)
    if (!bosList.length) continue
    const latestBOS = bosList[bosList.length - 1]

    const bias = sweepBias

    // Entry: try 1M FVG + IFVG, fallback to next 5m candle after BOS
    let entryCandle = null, entryPrice = null, entrySignal = 'Sweep+BOS'

    const m1After = candles1m.filter(c => c.time >= latestBOS.time && c.time <= now5m.time + 300)
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

    // 5M fallback
    if (!entryCandle) {
      const bosIdx = candles5m.findIndex(c => c.time >= latestBOS.time)
      entryCandle  = bosIdx >= 0 ? candles5m[bosIdx + 1] : null
      if (!entryCandle) continue
      entryPrice = entryCandle.open
    }

    // SL/TP
    let slPrice = bias === 'bullish' ? sweepWickExtreme - 2 : sweepWickExtreme + 2
    if (bias === 'bullish' && entryPrice - slPrice < 15) slPrice = entryPrice - 15
    if (bias === 'bearish' && slPrice - entryPrice < 15) slPrice = entryPrice + 15
    const slDist  = Math.abs(entryPrice - slPrice)
    if (slDist === 0 || slDist > 30) continue

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
      signal:      entrySignal,
    })

    lastTradeTime = now5m.time
  }

  return trades
}

// ── Signal debug info ────────────────────────────────────────────────────────
export function getSignalDebugInfo(candles5m, candles1m) {
  if (!candles5m?.length)
    return { signal: null, step: 'no_data', label: 'Awaiting MTF candle data\u2026' }

  const recent5m = candles5m.slice(-30)
  const nowTs    = recent5m[recent5m.length - 1]?.time
  if (!nowTs)
    return { signal: null, step: 'no_ts', label: 'No timestamp on candles' }

  if (!isKillZone(nowTs)) {
    const mins = getETMinutes(nowTs)
    const nextZone =
      mins < 180 ? 'London opens at 3:00 AM ET' :
      mins < 510 ? 'NY open at 8:30 AM ET' :
      mins < 810 ? 'NY PM at 1:30 PM ET' :
      'London opens at 3:00 AM ET (next day)'
    return { signal: null, step: 'kill_zone', label: `Outside kill zone \u2014 ${nextZone}` }
  }

  const { sweepBias, sweepTime, dailyHL, pdhl } = findSweep(recent5m, candles5m, nowTs)

  if (!pdhl && !getSessionHL(candles5m, nowTs))
    return { signal: null, step: 'prev_day', label: 'No previous day or session H/L available' }

  if (!sweepBias) {
    const levels = pdhl
      ? `prev day H: ${pdhl.high.toFixed(2)} / L: ${pdhl.low.toFixed(2)}`
      : 'session H/L'
    return { signal: null, step: 'sweep', label: `No sweep \u2014 watching ${levels}` }
  }

  const postSweep5m = recent5m.filter(c => c.time > sweepTime)
  if (postSweep5m.length < 3)
    return { signal: null, step: 'bos_data', label: `${sweepBias} sweep found \u2014 waiting for more 5m candles to detect BOS` }

  const { highs: h5, lows: l5 } = detectSwings(postSweep5m, 2)
  const bosList   = detectBOS(postSweep5m, h5, l5).filter(b => b.type === sweepBias)
  if (!bosList.length)
    return { signal: null, step: 'bos', label: `${sweepBias} sweep found \u2014 waiting for 5m BOS confirmation` }

  const latestBOS = bosList[bosList.length - 1]

  // Check 1m IFVG entry
  if (candles1m?.length) {
    const m1After = candles1m.filter(c => c.time >= latestBOS.time)
    if (m1After.length < 5)
      return { signal: null, step: 'fvg_data', label: 'BOS confirmed \u2014 waiting for 1m candles after BOS' }

    const fvgs1m = detectFVGs(m1After).filter(f => f.type === sweepBias)
    if (fvgs1m.length) {
      const fvg1m = fvgs1m[fvgs1m.length - 1]
      if (fvg1m.top - fvg1m.bottom < 3)
        return { signal: null, step: 'fvg_width', label: `FVG found but too narrow: ${(fvg1m.top - fvg1m.bottom).toFixed(1)}pt (need \u22653pt)` }

      const m1PostFVG   = m1After.filter(c => c.time > fvg1m.time)
      const entryCandle = findIFVGEntry(m1PostFVG, fvg1m, sweepBias)
      if (entryCandle) {
        const sig = sweepBias === 'bullish' ? 'LONG' : 'SHORT'
        return { signal: sig, step: 'signal', label: `\ud83d\udfe2 ${sig} signal active (1m IFVG entry)` }
      }
      return { signal: null, step: 'ifvg', label: `${sweepBias} FVG at ${fvg1m.bottom.toFixed(2)}\u2013${fvg1m.top.toFixed(2)} \u2014 awaiting IFVG retrace entry` }
    }
  }

  // 5M BOS fallback signal
  const sig = sweepBias === 'bullish' ? 'LONG' : 'SHORT'
  return { signal: sig, step: 'signal', label: `\ud83d\udfe2 ${sig} signal active (5m BOS fallback)` }
}

// ── Live signal — returns { direction, bosTime, signal } or null ─────────────
export function getLiveSignal(candles5m, candles1m) {
  if (!candles5m?.length) return null

  const recent5m = candles5m.slice(-30)
  const nowTs    = recent5m[recent5m.length - 1]?.time
  if (!nowTs) return null

  if (!isKillZone(nowTs)) return null

  // Confluence 1: Liquidity sweep (prev day H/L or session H/L)
  const { sweepBias, sweepTime } = findSweep(recent5m, candles5m, nowTs)
  if (!sweepBias) return null

  // Confluence 2: BOS on 5M after sweep
  const postSweep5m = recent5m.filter(c => c.time > sweepTime)
  if (postSweep5m.length < 3) return null
  const { highs: h5, lows: l5 } = detectSwings(postSweep5m, 2)
  const bosList   = detectBOS(postSweep5m, h5, l5).filter(b => b.type === sweepBias)
  if (!bosList.length) return null
  const latestBOS = bosList[bosList.length - 1]

  const bias = sweepBias

  // Entry: try 1M FVG + IFVG first
  let entrySignal = null

  if (candles1m?.length) {
    const m1After = candles1m.filter(c => c.time >= latestBOS.time)
    if (m1After.length >= 5) {
      const fvgs1m = detectFVGs(m1After).filter(f => f.type === bias && f.top - f.bottom >= 3)
      if (fvgs1m.length) {
        const fvg1m     = fvgs1m[fvgs1m.length - 1]
        const m1PostFVG = m1After.filter(c => c.time > fvg1m.time)
        const entryCandle = findIFVGEntry(m1PostFVG, fvg1m, bias)
        if (entryCandle) entrySignal = 'Sweep+BOS+1mIFVG'
      }
    }
  }

  // 5M BOS fallback — signal fires even without 1m IFVG entry
  if (!entrySignal) entrySignal = 'Sweep+BOS'

  const direction = bias === 'bullish' ? 'LONG' : 'SHORT'
  return { direction, bosTime: latestBOS.time, signal: entrySignal }
}
