// ─────────────────────────────────────────────────────────────────────────────
// Strategy: TRIPLE — Sweep+BOS + IFVG Midpoint Retrace + Uptrend FVG Tap-Back
//
// Any strategy can trigger a trade:
//
// A) Sweep + BOS:
//   1. Kill zone only
//   2. Liquidity sweep: prev day H/L OR session H/L — wick through + close back
//   3. BOS on 5M AFTER the sweep, same direction
//   4. Entry: 1M FVG + IFVG retrace; fallback = next 5m open after BOS
//   5. SL = sweep wick extreme + 2pt buffer
//   6. TP = dynamic, R:R >= 2
//
// B) IFVG Midpoint Retrace:
//   1. Kill zone only
//   2. Find 5M FVGs >= 7pt wide
//   3. FVG must be "inversed" — price closes through the entire FVG
//   4. After inversion, price retraces to IFVG midpoint -> entry
//   5. SL = opposite extreme of FVG + 2pt buffer
//   6. TP = dynamic, R:R >= 2
//
// C) Uptrend FVG Tap-Back (LONG only):
//   1. Kill zone only
//   2. Bullish FVG forms in an uptrend (≥2 higher highs + higher lows)
//   3. FVG must be ≥ 4pt wide
//   4. Wait for price to tap back into the FVG zone -> entry at FVG midpoint
//   5. SL = below FVG bottom + 2pt buffer (FIXED — never moves)
//   6. TP = dynamic, R:R >= 4 (FIXED — never moves)
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

// Kill zones: Asia (8pm–midnight ET), London (3–5am ET), NY open (8:30am–12pm ET), NY PM (1:30–3pm ET)
export function isKillZone(ts) {
  const mins = getETMinutes(ts)
  return (mins >= 1200) ||                // Asia: 8:00 PM – midnight ET
         (mins >= 180 && mins < 300) ||   // London: 3:00–5:00 AM ET
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

// ── IFVG entry (for Sweep+BOS 1m entry path) ─────────────────────────────────
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

// ── Break of Structure ───────────────────────────────────────────────────────
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

// ── Detect Inversed FVGs (for IFVG Midpoint Retrace strategy) ────────────────
export function detectIFVGs(candles, fvgs, minWidth = DEFAULT_FVG_WIDTH) {
  const ifvgs = []
  for (const fvg of fvgs) {
    if (fvg.top - fvg.bottom < minWidth) continue

    for (let k = 0; k < candles.length; k++) {
      const c = candles[k]
      if (c.time <= fvg.time) continue
      if (fvg.type === 'bullish' && c.close < fvg.bottom) {
        ifvgs.push({ ...fvg, ifvgBias: 'bearish', inversionTime: c.time, inversionIndex: k })
        break
      }
      if (fvg.type === 'bearish' && c.close > fvg.top) {
        ifvgs.push({ ...fvg, ifvgBias: 'bullish', inversionTime: c.time, inversionIndex: k })
        break
      }
    }
  }
  return ifvgs
}

// ── Find midpoint retrace entry after IFVG inversion ────────────────────────
export function findMidRetrace(candles, ifvg) {
  let movedAway = false
  for (const c of candles) {
    if (c.time <= ifvg.inversionTime) continue
    if (ifvg.ifvgBias === 'bullish') {
      if (!movedAway && c.close > ifvg.mid) movedAway = true
      if (movedAway && c.low <= ifvg.mid) return c
    } else {
      if (!movedAway && c.close < ifvg.mid) movedAway = true
      if (movedAway && c.high >= ifvg.mid) return c
    }
  }
  return null
}

// ── Uptrend detection (for Strategy C: FVG Tap-Back in Uptrend) ─────────────
// Uptrend = at least 2 consecutive higher highs AND higher lows in recent candles
export function isUptrend(candles, lookback = 6) {
  if (candles.length < lookback) return false
  const recent = candles.slice(-lookback)
  let hh = 0, hl = 0
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].high > recent[i - 1].high) hh++
    if (recent[i].low  > recent[i - 1].low)  hl++
  }
  return hh >= 2 && hl >= 2
}

// ── FVG Tap-Back entry (Strategy C: bullish FVG in uptrend, ≥4pt, tap back) ─
// Finds bullish FVGs formed during an uptrend that are at least minWidth wide,
// then waits for price to "tap back" into the FVG zone before entering long.
const FVG_TAPBACK_MIN_WIDTH = 4

export function detectUptrendFVGs(candles, minWidth = FVG_TAPBACK_MIN_WIDTH) {
  const fvgs = []
  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1], next = candles[i + 1]
    // Bullish FVG only (for long strategy)
    if (next.low > prev.high) {
      const width = next.low - prev.high
      if (width < minWidth) continue
      // Check if we're in an uptrend at the time of FVG formation
      const priorCandles = candles.slice(0, i + 1)
      if (!isUptrend(priorCandles, 6)) continue
      fvgs.push({
        type: 'bullish',
        top: next.low,
        bottom: prev.high,
        mid: (next.low + prev.high) / 2,
        width,
        time: candles[i].time,
        index: i,
      })
    }
  }
  return fvgs
}

// Find the first candle that taps back into the FVG zone after it forms
export function findFVGTapBack(candles, fvg) {
  for (const c of candles) {
    if (c.time <= fvg.time) continue
    // Tap back = price pulls back into the FVG zone (low touches or enters the FVG)
    if (c.low <= fvg.top && c.low >= fvg.bottom) {
      return c
    }
    // If price drops below the FVG entirely, the setup is invalidated
    if (c.close < fvg.bottom) return null
  }
  return null
}

// ── Contract multipliers ──────────────────────────────────────────────────────
export const CONTRACT_MULTIPLIER = {
  'MES1!': 5,
  'MNQ1!': 2,
  'MGC1!': 10,
}

// ── Futures P&L helper ───────────────────────────────────────────────────────
export function calcFuturesPnl(entryPrice, exitPrice, symbol, side) {
  const mult = CONTRACT_MULTIPLIER[symbol] || 5
  const dir  = side === 'LONG' ? 1 : -1
  return parseFloat(((exitPrice - entryPrice) * mult * dir).toFixed(2))
}

const MIN_RR = 4
const FIXED_SL = { 'MES1!': null, 'MNQ1!': 20, 'MGC1!': 20 }
const FIXED_TP = { 'MES1!': null, 'MNQ1!': null, 'MGC1!': 50 }
const SYMBOL_RR = { 'MES1!': 4, 'MNQ1!': 4, 'MGC1!': 4 }
// Units (contracts) per trade per symbol
const UNITS = { 'MES1!': 2, 'MNQ1!': 2, 'MGC1!': 2 }
// Per-symbol min FVG width for IFVG detection
const MIN_FVG_WIDTH = {
  'MES1!': 5,
  'MNQ1!': 16,
  'MGC1!': 4,
}
const DEFAULT_FVG_WIDTH = 5
// Per-symbol min 1m FVG width for Strategy D (1m FVG Tap-Back)
const MIN_1M_FVG_WIDTH = { 'MES1!': 4, 'MNQ1!': 10, 'MGC1!': 4 }
// Per-symbol SL distance bounds
const SL_BOUNDS = {
  'MES1!': { min: 3, max: 30 },
  'MNQ1!': { min: 5, max: 50 },
  'MGC1!': { min: 2, max: 20 },
}
const DEFAULT_SL_BOUNDS = { min: 3, max: 30 }

// ── Sweep detection helper ──────────────────────────────────────────────────
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

// ══════════════════════════════════════════════════════════════════════════════
// BACKTEST: runs BOTH strategies, merges + deduplicates by time
// ══════════════════════════════════════════════════════════════════════════════

// ── Strategy A: Sweep + BOS backtest ─────────────────────────────────────────
const MAX_TRADE_DURATION = 86400  // 1 day in seconds

function runBacktestSweepBOS(candles5m, candles1m, symbol, multiplier) {
  const trades = []
  if (!candles5m.length) return trades

  const dailyHL = buildDailyHL(candles5m)
  let lastExitTime = 0
  const usedSweeps     = new Set()
  const usedEntryTimes = new Set()

  for (let i = 20; i < candles5m.length - 1; i++) {
    const now5m    = candles5m[i]
    const recent5m = candles5m.slice(Math.max(0, i - 30), i + 1)

    if (!isKillZone(now5m.time)) continue
    if (now5m.time <= lastExitTime) continue  // no overlapping trades

    const pdhl = getPrevDayHL(dailyHL, now5m.time)

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
    if (usedSweeps.has(sweepTime)) continue

    // BOS
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

    if (!entryCandle) {
      const bosIdx = candles5m.findIndex(c => c.time >= latestBOS.time)
      entryCandle  = bosIdx >= 0 ? candles5m[bosIdx + 1] : null
      if (!entryCandle) continue
      entryPrice = entryCandle.open
    }

    if (usedEntryTimes.has(entryCandle.time)) continue

    // SL/TP
    let slPrice, slDist
    const fixedSL = FIXED_SL[symbol]
    if (fixedSL != null) {
      slDist = fixedSL
      slPrice = bias === 'bullish' ? entryPrice - slDist : entryPrice + slDist
    } else {
      slPrice = bias === 'bullish' ? sweepWickExtreme - 2 : sweepWickExtreme + 2
      if (bias === 'bullish' && entryPrice - slPrice < 5) slPrice = entryPrice - 5
      if (bias === 'bearish' && slPrice - entryPrice < 5) slPrice = entryPrice + 5
      slDist = Math.abs(entryPrice - slPrice)
      if (slDist > 30) continue
    }

    let tpPrice
    const fixedTP = FIXED_TP[symbol]
    if (fixedTP != null) {
      tpPrice = bias === 'bullish' ? entryPrice + fixedTP : entryPrice - fixedTP
    } else {
      const rr = SYMBOL_RR[symbol] || MIN_RR
      const minTPDist = slDist * rr
      const maxTPDist = minTPDist + 30
      const { highs, lows } = detectSwings(recent5m, 3)
      if (bias === 'bullish') {
        const c = highs.filter(h => h.price >= entryPrice + minTPDist && h.price <= entryPrice + maxTPDist).sort((a, b) => a.price - b.price)
        tpPrice = c[0]?.price ?? entryPrice + minTPDist
      } else {
        const c = lows.filter(l => l.price <= entryPrice - minTPDist && l.price >= entryPrice - maxTPDist).sort((a, b) => b.price - a.price)
        tpPrice = c[0]?.price ?? entryPrice - minTPDist
      }
    }

    if (bias === 'bullish' && tpPrice <= entryPrice) continue
    if (bias === 'bearish' && tpPrice >= entryPrice) continue

    const tpDist = Math.abs(tpPrice - entryPrice)
    if (fixedTP == null && tpDist / slDist < MIN_RR) continue

    const entryIdx1m = candles1m.findIndex(c => c.time >= entryCandle.time)
    const future1m   = candles1m.slice(entryIdx1m + 1, entryIdx1m + 720)
    // Fallback to 5m simulation if no 1m data
    const entryIdx5m = candles5m.findIndex(c => c.time >= entryCandle.time)
    const simCandles = future1m.length > 0 ? future1m : candles5m.slice(entryIdx5m + 1, entryIdx5m + 200)
    let outcome = null, exitPrice = null, exitTime = null

    for (const fc of simCandles) {
      // Max 1-day duration — force close if trade has been open too long
      if (fc.time - entryCandle.time >= MAX_TRADE_DURATION) {
        outcome = fc.close > entryPrice === (bias === 'bullish') ? 'win' : 'loss'
        exitPrice = fc.close; exitTime = fc.time; break
      }
      if (bias === 'bullish') {
        if (fc.low  <= slPrice) { outcome = 'loss'; exitPrice = slPrice; exitTime = fc.time; break }
        if (fc.high >= tpPrice) { outcome = 'win';  exitPrice = tpPrice; exitTime = fc.time; break }
      } else {
        if (fc.high >= slPrice) { outcome = 'loss'; exitPrice = slPrice; exitTime = fc.time; break }
        if (fc.low  <= tpPrice) { outcome = 'win';  exitPrice = tpPrice; exitTime = fc.time; break }
      }
    }

    if (!outcome) continue

    const pnlPoints  = outcome === 'win' ? Math.abs(exitPrice - entryPrice) : -slDist
    const units      = UNITS[symbol] || 1
    const pnlDollars = parseFloat((pnlPoints * multiplier * units).toFixed(2))

    trades.push({
      time:        entryCandle.time,
      exitTime,
      bias,
      entryPrice:  parseFloat(entryPrice.toFixed(4)),
      stopPrice:   parseFloat(slPrice.toFixed(4)),
      targetPrice: parseFloat(tpPrice.toFixed(4)),
      exitPrice:   parseFloat(exitPrice.toFixed(4)),
      outcome,
      pnlDollars, contracts: units,
      rr:          parseFloat((tpDist / slDist).toFixed(2)),
      signal:      entrySignal,
    })

    usedSweeps.add(sweepTime)
    usedEntryTimes.add(entryCandle.time)
    lastExitTime = exitTime || entryCandle.time
  }

  return trades
}

// ── Strategy B: IFVG Midpoint Retrace backtest ──────────────────────────────
function runBacktestIFVGMid(candles5m, candles1m, symbol, multiplier) {
  const trades = []
  if (!candles5m.length) return trades

  const fvgWidth = MIN_FVG_WIDTH[symbol] || DEFAULT_FVG_WIDTH
  const allFVGs  = detectFVGs(candles5m)
  const allIFVGs = detectIFVGs(candles5m, allFVGs, fvgWidth)

  let lastExitTime     = 0
  const usedIFVGs      = new Set()
  const usedEntryTimes = new Set()
  const slBounds       = SL_BOUNDS[symbol] || DEFAULT_SL_BOUNDS

  for (const ifvg of allIFVGs) {
    if (!isKillZone(ifvg.inversionTime)) continue

    const entryCandle = findMidRetrace(candles5m, ifvg)
    if (!entryCandle) continue
    if (!isKillZone(entryCandle.time)) continue
    if (entryCandle.time <= lastExitTime) continue  // no overlapping trades
    if (usedIFVGs.has(ifvg.time)) continue
    if (usedEntryTimes.has(entryCandle.time)) continue

    const bias       = ifvg.ifvgBias
    const entryPrice = ifvg.mid

    let slDist, slPrice
    const fixedSL2 = FIXED_SL[symbol]
    if (fixedSL2 != null) {
      slDist = fixedSL2
    } else {
      slDist = Math.abs(entryPrice - (bias === 'bullish' ? ifvg.bottom - 2 : ifvg.top + 2))
      if (slDist < slBounds.min || slDist > slBounds.max) continue
    }
    slPrice = bias === 'bullish' ? entryPrice - slDist : entryPrice + slDist

    let tpPrice
    const fixedTP2 = FIXED_TP[symbol]
    if (fixedTP2 != null) {
      tpPrice = bias === 'bullish' ? entryPrice + fixedTP2 : entryPrice - fixedTP2
    } else {
      const rr2 = SYMBOL_RR[symbol] || MIN_RR
      const minTPDist = slDist * rr2
      const maxTPDist = minTPDist + 30

      const entryIdx  = candles5m.findIndex(c => c.time >= entryCandle.time)
      const recent5m  = candles5m.slice(Math.max(0, entryIdx - 30), entryIdx + 1)
      const { highs, lows } = detectSwings(recent5m, 3)

      if (bias === 'bullish') {
        const targets = highs.filter(h => h.price >= entryPrice + minTPDist && h.price <= entryPrice + maxTPDist).sort((a, b) => a.price - b.price)
        tpPrice = targets[0]?.price ?? entryPrice + minTPDist
      } else {
        const targets = lows.filter(l => l.price <= entryPrice - minTPDist && l.price >= entryPrice - maxTPDist).sort((a, b) => b.price - a.price)
        tpPrice = targets[0]?.price ?? entryPrice - minTPDist
      }
    }

    if (bias === 'bullish' && tpPrice <= entryPrice) continue
    if (bias === 'bearish' && tpPrice >= entryPrice) continue

    const tpDist = Math.abs(tpPrice - entryPrice)
    if (fixedTP2 == null && tpDist / slDist < MIN_RR) continue

    const entryIdx1m = candles1m?.length ? candles1m.findIndex(c => c.time >= entryCandle.time) : -1
    const simCandles = entryIdx1m >= 0 && entryIdx1m < candles1m.length - 1
      ? candles1m.slice(entryIdx1m + 1, entryIdx1m + 720)
      : candles5m.slice(entryIdx + 1, entryIdx + 200)
    let outcome = null, exitPrice = null, exitTime = null

    for (const fc of simCandles) {
      if (fc.time - entryCandle.time >= MAX_TRADE_DURATION) {
        const dir = bias === 'bullish' ? 1 : -1
        outcome = (fc.close - entryPrice) * dir > 0 ? 'win' : 'loss'
        exitPrice = fc.close; exitTime = fc.time; break
      }
      if (bias === 'bullish') {
        if (fc.low  <= slPrice) { outcome = 'loss'; exitPrice = slPrice; exitTime = fc.time; break }
        if (fc.high >= tpPrice) { outcome = 'win';  exitPrice = tpPrice; exitTime = fc.time; break }
      } else {
        if (fc.high >= slPrice) { outcome = 'loss'; exitPrice = slPrice; exitTime = fc.time; break }
        if (fc.low  <= tpPrice) { outcome = 'win';  exitPrice = tpPrice; exitTime = fc.time; break }
      }
    }

    if (!outcome) continue

    const pnlPoints  = outcome === 'win' ? Math.abs(exitPrice - entryPrice) : -slDist
    const units      = UNITS[symbol] || 1
    const pnlDollars = parseFloat((pnlPoints * multiplier * units).toFixed(2))

    trades.push({
      time:        entryCandle.time,
      exitTime,
      bias,
      entryPrice:  parseFloat(entryPrice.toFixed(4)),
      stopPrice:   parseFloat(slPrice.toFixed(4)),
      targetPrice: parseFloat(tpPrice.toFixed(4)),
      exitPrice:   parseFloat(exitPrice.toFixed(4)),
      outcome,
      pnlDollars, contracts: units,
      rr:          parseFloat((tpDist / slDist).toFixed(2)),
      signal:      'IFVG-Mid-Retrace',
    })

    usedIFVGs.add(ifvg.time)
    usedEntryTimes.add(entryCandle.time)
    lastExitTime = exitTime || entryCandle.time
  }

  return trades
}

// ── Strategy C: Uptrend FVG Tap-Back (LONG only) ────────────────────────────
function runBacktestFVGTapBack(candles5m, candles1m, symbol, multiplier) {
  const trades = []
  if (!candles5m.length) return trades

  const units = UNITS[symbol] || 1
  let lastExitTime = 0
  const usedFVGs = new Set()
  const usedEntryTimes = new Set()
  const slBounds = SL_BOUNDS[symbol] || DEFAULT_SL_BOUNDS

  // Detect bullish FVGs formed in uptrends (≥4pt wide)
  const uptrendFVGs = detectUptrendFVGs(candles5m, FVG_TAPBACK_MIN_WIDTH)

  for (const fvg of uptrendFVGs) {
    if (!isKillZone(fvg.time)) continue

    // Find the tap-back candle
    const entryCandle = findFVGTapBack(candles5m, fvg)
    if (!entryCandle) continue
    if (!isKillZone(entryCandle.time)) continue
    if (entryCandle.time <= lastExitTime) continue  // no overlapping trades
    if (usedFVGs.has(fvg.time)) continue
    if (usedEntryTimes.has(entryCandle.time)) continue

    // Entry at the midpoint of the FVG on tap-back
    const entryPrice = fvg.mid

    // SL below the FVG bottom with buffer
    let slDist, slPrice
    const fixedSL = FIXED_SL[symbol]
    if (fixedSL != null) {
      slDist = fixedSL
    } else {
      slDist = Math.abs(entryPrice - (fvg.bottom - 2))
      if (slDist < slBounds.min || slDist > slBounds.max) continue
    }
    slPrice = entryPrice - slDist

    // TP
    let tpPrice
    const fixedTP3 = FIXED_TP[symbol]
    if (fixedTP3 != null) {
      tpPrice = entryPrice + fixedTP3
    } else {
      const rr = SYMBOL_RR[symbol] || MIN_RR
      const minTPDist = slDist * rr
      const maxTPDist = minTPDist + 30

      const entryIdx = candles5m.findIndex(c => c.time >= entryCandle.time)
      const recent5m = candles5m.slice(Math.max(0, entryIdx - 30), entryIdx + 1)
      const { highs } = detectSwings(recent5m, 3)

      const targets = highs.filter(h => h.price >= entryPrice + minTPDist && h.price <= entryPrice + maxTPDist).sort((a, b) => a.price - b.price)
      tpPrice = targets[0]?.price ?? entryPrice + minTPDist
    }

    if (tpPrice <= entryPrice) continue

    const tpDist = Math.abs(tpPrice - entryPrice)
    if (fixedTP3 == null && tpDist / slDist < MIN_RR) continue

    // Simulate on 1m data if available, fallback to 5m
    const entryIdx1m = candles1m?.length ? candles1m.findIndex(c => c.time >= entryCandle.time) : -1
    const simCandles = entryIdx1m >= 0 && entryIdx1m < candles1m.length - 1
      ? candles1m.slice(entryIdx1m + 1, entryIdx1m + 720)
      : candles5m.slice(entryIdx + 1, entryIdx + 200)
    let outcome = null, exitPrice = null, exitTime = null

    for (const fc of simCandles) {
      // Max 1-day duration
      if (fc.time - entryCandle.time >= MAX_TRADE_DURATION) {
        outcome = fc.close > entryPrice ? 'win' : 'loss'
        exitPrice = fc.close; exitTime = fc.time; break
      }
      // Long trade: SL below, TP above
      if (fc.low  <= slPrice) { outcome = 'loss'; exitPrice = slPrice; exitTime = fc.time; break }
      if (fc.high >= tpPrice) { outcome = 'win';  exitPrice = tpPrice; exitTime = fc.time; break }
    }

    if (!outcome) continue

    const pnlPoints  = outcome === 'win' ? Math.abs(exitPrice - entryPrice) : -slDist
    const pnlDollars = parseFloat((pnlPoints * multiplier * units).toFixed(2))

    trades.push({
      time:        entryCandle.time,
      exitTime,
      bias:        'bullish',
      entryPrice:  parseFloat(entryPrice.toFixed(4)),
      stopPrice:   parseFloat(slPrice.toFixed(4)),
      targetPrice: parseFloat(tpPrice.toFixed(4)),
      exitPrice:   parseFloat(exitPrice.toFixed(4)),
      outcome,
      pnlDollars, contracts: units,
      rr:          parseFloat((tpDist / slDist).toFixed(2)),
      signal:      'Uptrend-FVG-TapBack',
    })

    usedFVGs.add(fvg.time)
    usedEntryTimes.add(entryCandle.time)
    lastExitTime = exitTime || entryCandle.time
  }

  return trades
}

// ── Combined backtest: merge all strategies, dedup by entry time ─────────────
export function runBacktest(candles5m, candles1m, symbol = 'MES1!') {
  const multiplier = CONTRACT_MULTIPLIER[symbol] || 5

  // Run all strategies independently
  const sweepTrades   = runBacktestSweepBOS(candles5m, candles1m || [], symbol, multiplier)
  const ifvgTrades    = runBacktestIFVGMid(candles5m, candles1m || [], symbol, multiplier)
  const tapBackTrades = runBacktestFVGTapBack(candles5m, candles1m || [], symbol, multiplier)

  // Merge and sort by entry time
  const all = [...sweepTrades, ...ifvgTrades, ...tapBackTrades].sort((a, b) => a.time - b.time)

  // Dedup: no overlapping trades — new trade can't start until previous trade exits
  const final = []
  const usedTimes = new Set()
  let lastExitTime = 0
  for (const t of all) {
    if (usedTimes.has(t.time)) continue
    if (t.time <= lastExitTime) continue  // no overlapping trades

    t.id = final.length + 1
    final.push(t)
    usedTimes.add(t.time)
    if (t.exitTime) lastExitTime = t.exitTime
  }

  return final
}

// ── Signal debug info (checks both strategies) ──────────────────────────────
export function getSignalDebugInfo(candles5m, candles1m, symbol = 'MES1!') {
  if (!candles5m?.length)
    return { signal: null, step: 'no_data', label: 'Awaiting MTF candle data\u2026' }

  const recent5m = candles5m.slice(-60)
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

  // ── Check Strategy B: IFVG Midpoint Retrace ────────────────────────────────
  const fvgWidth = MIN_FVG_WIDTH[symbol] || DEFAULT_FVG_WIDTH
  const fvgs = detectFVGs(recent5m).filter(f => f.top - f.bottom >= fvgWidth)
  if (fvgs.length) {
    const ifvgs = detectIFVGs(recent5m, fvgs, fvgWidth)
    if (ifvgs.length) {
      const latestIFVG  = ifvgs[ifvgs.length - 1]
      const entryCandle = findMidRetrace(recent5m, latestIFVG)
      if (entryCandle) {
        const dir = latestIFVG.ifvgBias === 'bullish' ? 'LONG' : 'SHORT'
        return { signal: dir, step: 'signal', label: `${dir} signal — IFVG mid retrace at ${latestIFVG.mid.toFixed(2)}` }
      }
    }
  }

  // ── Check Strategy C: Uptrend FVG Tap-Back (LONG only) ─────────────────────
  const uptrendFVGs = detectUptrendFVGs(recent5m, FVG_TAPBACK_MIN_WIDTH)
  if (uptrendFVGs.length) {
    const latestUFVG = uptrendFVGs[uptrendFVGs.length - 1]
    const tapBackCandle = findFVGTapBack(recent5m, latestUFVG)
    if (tapBackCandle) {
      return { signal: 'LONG', step: 'signal', label: `LONG signal — Uptrend FVG tap-back at ${latestUFVG.mid.toFixed(2)} (${latestUFVG.width.toFixed(1)}pt wide)` }
    }
    return { signal: null, step: 'fvg_tapback', label: `Uptrend FVG found (${latestUFVG.width.toFixed(1)}pt) — awaiting tap-back into ${latestUFVG.bottom.toFixed(2)}–${latestUFVG.top.toFixed(2)}` }
  }

  // ── Check Strategy D: 1m FVG Tap-Back (both directions) ────────────────────
  if (candles1m?.length >= 10) {
    const recent1m = candles1m.slice(-120)
    const fvgs1mD = detectFVGs(recent1m).filter(f => (f.top - f.bottom) >= (MIN_1M_FVG_WIDTH[symbol] || 4))
    if (fvgs1mD.length) {
      const latestFVG = fvgs1mD[fvgs1mD.length - 1]
      const fvgIdx1m = recent1m.findIndex(c => c.time >= latestFVG.time)
      if (fvgIdx1m >= 0) {
        const postFVG1m = recent1m.slice(fvgIdx1m + 1)
        let movedAway = false
        let tapBackFound = false
        const fvgBias = latestFVG.type
        for (const c of postFVG1m) {
          if (fvgBias === 'bearish') {
            if (c.high > latestFVG.top) movedAway = true
            if (movedAway && c.low <= latestFVG.top && c.low >= latestFVG.bottom) { tapBackFound = true; break }
          } else {
            if (c.low < latestFVG.bottom) movedAway = true
            if (movedAway && c.high >= latestFVG.bottom && c.high <= latestFVG.top) { tapBackFound = true; break }
          }
        }
        const dir1m = fvgBias === 'bullish' ? 'LONG' : 'SHORT'
        if (tapBackFound) {
          return { signal: dir1m, step: 'signal', label: `${dir1m} signal — 1m FVG tap-back at ${latestFVG.mid.toFixed(2)} (${(latestFVG.top - latestFVG.bottom).toFixed(1)}pt wide)` }
        }
        if (movedAway) {
          return { signal: null, step: '1m_fvg_tapback', label: `1m ${fvgBias} FVG (${(latestFVG.top - latestFVG.bottom).toFixed(1)}pt) — retrace done, awaiting tap-back into ${latestFVG.bottom.toFixed(2)}–${latestFVG.top.toFixed(2)}` }
        }
        return { signal: null, step: '1m_fvg_retrace', label: `1m ${fvgBias} FVG (${(latestFVG.top - latestFVG.bottom).toFixed(1)}pt) — awaiting retrace away from FVG` }
      }
    }
  }

  // ── Check Strategy A: Sweep + BOS ──────────────────────────────────────────
  const { sweepBias, sweepTime, pdhl } = findSweep(recent5m.slice(-30), candles5m, nowTs)

  if (!pdhl && !getSessionHL(candles5m, nowTs)) {
    // No levels for sweep, check IFVG status
    if (fvgs.length) {
      const ifvgs = detectIFVGs(recent5m, fvgs)
      if (ifvgs.length) {
        const latestIFVG = ifvgs[ifvgs.length - 1]
        const dir = latestIFVG.ifvgBias === 'bullish' ? 'LONG' : 'SHORT'
        return { signal: null, step: 'retrace', label: `${dir} IFVG \u2014 awaiting midpoint retrace (${latestIFVG.mid.toFixed(2)})` }
      }
      return { signal: null, step: 'inversion', label: `${fvgs.length} FVG(s) found \u2014 none inversed yet` }
    }
    return { signal: null, step: 'prev_day', label: 'No sweep levels or IFVG setups available' }
  }

  if (sweepBias) {
    const postSweep5m = recent5m.slice(-30).filter(c => c.time > sweepTime)
    if (postSweep5m.length >= 3) {
      const { highs: h5, lows: l5 } = detectSwings(postSweep5m, 2)
      const bosList = detectBOS(postSweep5m, h5, l5).filter(b => b.type === sweepBias)
      if (bosList.length) {
        const latestBOS = bosList[bosList.length - 1]

        // Try 1m IFVG entry
        if (candles1m?.length) {
          const m1After = candles1m.filter(c => c.time >= latestBOS.time)
          if (m1After.length >= 5) {
            const fvgs1m = detectFVGs(m1After).filter(f => f.type === sweepBias && f.top - f.bottom >= 3)
            if (fvgs1m.length) {
              const fvg1m     = fvgs1m[fvgs1m.length - 1]
              const m1PostFVG = m1After.filter(c => c.time > fvg1m.time)
              const entryCandle = findIFVGEntry(m1PostFVG, fvg1m, sweepBias)
              if (entryCandle) {
                const dir2 = sweepBias === 'bullish' ? 'LONG' : 'SHORT'
                return { signal: dir2, step: 'signal', label: `${dir2} signal (Sweep+BOS+1m IFVG)` }
              }
            }
          }
        }

        // 5M fallback
        const dir3 = sweepBias === 'bullish' ? 'LONG' : 'SHORT'
        return { signal: dir3, step: 'signal', label: `${dir3} signal (Sweep+BOS fallback)` }
      }
      return { signal: null, step: 'bos', label: `${sweepBias} sweep found \u2014 waiting for 5m BOS confirmation` }
    }
    return { signal: null, step: 'bos_data', label: `${sweepBias} sweep found \u2014 waiting for more candles` }
  }

  // Neither strategy has a signal — show what we're watching
  if (fvgs.length) {
    const ifvgs = detectIFVGs(recent5m, fvgs)
    if (ifvgs.length) {
      const latestIFVG = ifvgs[ifvgs.length - 1]
      const dir = latestIFVG.ifvgBias === 'bullish' ? 'LONG' : 'SHORT'
      return { signal: null, step: 'retrace', label: `No sweep | ${dir} IFVG awaiting mid retrace (${latestIFVG.mid.toFixed(2)})` }
    }
    return { signal: null, step: 'inversion', label: `No sweep | ${fvgs.length} FVG(s) \u2014 none inversed` }
  }

  const levels = pdhl
    ? `prev day H: ${pdhl.high.toFixed(2)} / L: ${pdhl.low.toFixed(2)}`
    : 'session H/L'
  return { signal: null, step: 'sweep', label: `No sweep (watching ${levels}) | No IFVG setups` }
}

// ── Live signal: returns { direction, signal, bosTime } or null ─────────────
// Checks BOTH strategies — first signal wins
// Now supports LONG and SHORT for maximum trade frequency
export function getLiveSignal(candles5m, candles1m, symbol = 'MES1!') {
  if (!candles5m?.length) return null

  const recent5m = candles5m.slice(-60)
  const nowTs    = recent5m[recent5m.length - 1]?.time
  if (!nowTs) return null
  if (!isKillZone(nowTs)) return null

  // ── Strategy B: IFVG Midpoint Retrace ──────────────────────────────────────
  const fvgW = MIN_FVG_WIDTH[symbol] || DEFAULT_FVG_WIDTH
  const fvgs = detectFVGs(recent5m).filter(f => f.top - f.bottom >= fvgW)
  if (fvgs.length) {
    const ifvgs = detectIFVGs(recent5m, fvgs, fvgW)
    if (ifvgs.length) {
      const latestIFVG  = ifvgs[ifvgs.length - 1]
      const entryCandle = findMidRetrace(recent5m, latestIFVG)
      if (entryCandle) {
        const direction = latestIFVG.ifvgBias === 'bullish' ? 'LONG' : 'SHORT'
        return {
          direction,
          signal: 'IFVG-Mid-Retrace',
          bosTime: latestIFVG.inversionTime,
        }
      }
    }
  }

  // ── Strategy C: Uptrend FVG Tap-Back (LONG only) ───────────────────────────
  const uptrendFVGsLive = detectUptrendFVGs(recent5m, FVG_TAPBACK_MIN_WIDTH)
  if (uptrendFVGsLive.length) {
    const latestUFVG = uptrendFVGsLive[uptrendFVGsLive.length - 1]
    const tapBackCandle = findFVGTapBack(recent5m, latestUFVG)
    if (tapBackCandle) {
      return {
        direction: 'LONG',
        signal: 'Uptrend-FVG-TapBack',
        bosTime: latestUFVG.time,
      }
    }
  }

  // ── Strategy D: 1m FVG Tap-Back (both directions) ──────────────────────────
  if (candles1m?.length >= 10) {
    const recent1m = candles1m.slice(-120)
    const fvgs1mD = detectFVGs(recent1m).filter(f => (f.top - f.bottom) >= (MIN_1M_FVG_WIDTH[symbol] || 4))
    if (fvgs1mD.length) {
      const latestFVG = fvgs1mD[fvgs1mD.length - 1]
      const fvgIdx1m = recent1m.findIndex(c => c.time >= latestFVG.time)
      if (fvgIdx1m >= 0) {
        const postFVG1m = recent1m.slice(fvgIdx1m + 1)
        let movedAway = false
        let tapBackFound = false
        const bias = latestFVG.type
        for (const c of postFVG1m) {
          if (bias === 'bearish') {
            if (c.high > latestFVG.top) movedAway = true
            if (movedAway && c.low <= latestFVG.top && c.low >= latestFVG.bottom) { tapBackFound = true; break }
          } else {
            if (c.low < latestFVG.bottom) movedAway = true
            if (movedAway && c.high >= latestFVG.bottom && c.high <= latestFVG.top) { tapBackFound = true; break }
          }
        }
        if (tapBackFound) {
          return {
            direction: bias === 'bullish' ? 'LONG' : 'SHORT',
            signal: '1m-FVG-TapBack',
            bosTime: latestFVG.time,
          }
        }
      }
    }
  }

  // ── Strategy A: Sweep + BOS ────────────────────────────────────────────────
  const recent30 = recent5m.slice(-30)
  const { sweepBias, sweepTime } = findSweep(recent30, candles5m, nowTs)
  if (!sweepBias) return null

  const postSweep5m = recent30.filter(c => c.time > sweepTime)
  if (postSweep5m.length < 3) return null
  const { highs: h5, lows: l5 } = detectSwings(postSweep5m, 2)
  const bosList = detectBOS(postSweep5m, h5, l5).filter(b => b.type === sweepBias)
  if (!bosList.length) return null
  const latestBOS = bosList[bosList.length - 1]

  const direction = sweepBias === 'bullish' ? 'LONG' : 'SHORT'

  // Try 1m IFVG entry first
  if (candles1m?.length) {
    const m1After = candles1m.filter(c => c.time >= latestBOS.time)
    if (m1After.length >= 5) {
      const fvgs1m = detectFVGs(m1After).filter(f => f.type === sweepBias && f.top - f.bottom >= 3)
      if (fvgs1m.length) {
        const fvg1m     = fvgs1m[fvgs1m.length - 1]
        const m1PostFVG = m1After.filter(c => c.time > fvg1m.time)
        const entryCandle = findIFVGEntry(m1PostFVG, fvg1m, sweepBias)
        if (entryCandle) {
          return {
            direction,
            signal: 'Sweep+BOS+1mIFVG',
            bosTime: latestBOS.time,
          }
        }
      }
    }
  }

  // 5M fallback: BOS confirmed = enter
  return {
    direction,
    signal: 'Sweep+BOS',
    bosTime: latestBOS.time,
  }
}