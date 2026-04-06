import { FUTURES } from '../store'
import { CONTRACT_MULTIPLIER } from '../utils/strategy'

const SYMBOL_RR = { 'MES1!': 6, 'MNQ1!': 6, 'MGC1!': 8 }
const UNITS     = { 'MES1!': 2, 'MNQ1!': 2, 'MGC1!': 2 }
const FIXED_SL  = { 'MES1!': null, 'MNQ1!': 20, 'MGC1!': 20 }
const FVG_WIDTH = { 'MES1!': 5, 'MNQ1!': 16, 'MGC1!': 4 }

// ── SHORT strategies per symbol ──────────────────────────────────────────────

const SHORT_STRATEGIES = {
  'MES1!': {
    name: 'Sweep + BOS + IFVG Mid Retrace',
    rules: [
      'Kill Zones: Asia 8pm\u2013midnight ET, London 3\u20135am ET, NY 8:30am\u201312pm ET, NY PM 1:30\u20133pm ET',
      'Strategy A \u2014 Sweep + BOS: Prev day H/L or session H/L bearish sweep (wick above + close back below), then 5M BOS bearish confirmation (min 3 candles post-sweep). Entry on 1M FVG + IFVG retrace, or fallback to next 5M open after BOS.',
      'Strategy B \u2014 IFVG Mid Retrace: Find 5M FVGs \u2265 5pt wide that get inversed (price closes through entire FVG). After inversion, wait for price to retrace back up to the IFVG midpoint \u2192 SHORT entry.',
      'Either strategy can trigger a trade \u2014 first signal wins.',
    ],
    risk: {
      sl: 'Sweep wick extreme + 2pt buffer (min 5pt, max 30pt)',
      tp: 'Nearest swing low \u2265 SL \u00d7 6 distance (search window extends 30pt beyond)',
      rr: '6:1',
      units: '2 contracts',
      cooldown: '5 min between trades, 10 min same-bias dedup',
    },
    signals: ['Sweep+BOS', 'Sweep+BOS+1mIFVG', 'IFVG-Mid-Retrace'],
  },

  'MNQ1!': {
    name: 'Sweep + BOS + IFVG Mid Retrace',
    rules: [
      'Kill Zones: Asia 8pm\u2013midnight ET, London 3\u20135am ET, NY 8:30am\u201312pm ET, NY PM 1:30\u20133pm ET',
      'Strategy A \u2014 Sweep + BOS: Prev day H/L or session H/L bearish sweep, then 5M BOS bearish confirmation. Entry on 1M FVG + IFVG retrace, or fallback to next 5M open after BOS.',
      'Strategy B \u2014 IFVG Mid Retrace: Find 5M FVGs \u2265 16pt wide that get inversed. After inversion, wait for midpoint retrace \u2192 SHORT entry.',
      'Fixed SL of 35pt. Either strategy can trigger.',
    ],
    risk: {
      sl: 'Fixed 20pt',
      tp: 'Nearest swing low \u2265 SL \u00d7 6 distance',
      rr: '6:1',
      units: '2 contracts',
      cooldown: '5 min between trades, 10 min same-bias dedup',
    },
    signals: ['Sweep+BOS', 'Sweep+BOS+1mIFVG', 'IFVG-Mid-Retrace'],
  },

  'MGC1!': {
    name: 'HTF Bias + IFVG Mid Retrace',
    rules: [
      'Kill Zones: Asia open 8pm\u2013midnight ET, NY open 8am\u2013noon ET',
      'Strategy A \u2014 HTF Bias: 4H BOS sets bearish direction, 1H BOS must agree. No open FVG on 4H or 1H blocking path to TP. Enter on 5M FVG midpoint first touch only (skip if touched > 1 time). Longs \u2265 5pt, Shorts \u2265 7pt FVG width.',
      'Strategy B \u2014 IFVG Mid Retrace: Find 5M FVGs \u2265 4pt wide that get inversed. After inversion, wait for midpoint retrace \u2192 SHORT entry.',
      'Both strategies active \u2014 merged with dedup.',
    ],
    risk: {
      sl: 'Fixed 20pt',
      tp: 'HTF: nearest 1H swing low beyond entry. IFVG: dynamic \u2265 SL \u00d7 8',
      rr: '8:1',
      units: '2 contracts',
      cooldown: '5 min between trades, 10 min same-bias dedup',
    },
    signals: ['HTFBias+4h/1hClean+5mFVG+MidRetrace', 'IFVG-Mid-Retrace'],
  },
}

// ── LONG strategies per symbol (mirrors SHORT, flipped bullish) ─────────────────

const LONG_STRATEGIES = {
  'MES1!': {
    name: 'Sweep + BOS + IFVG Mid + Uptrend FVG Tap-Back',
    rules: [
      'Kill Zones: Asia 8pm\u2013midnight ET, London 3\u20135am ET, NY 8:30am\u201312pm ET, NY PM 1:30\u20133pm ET',
      'Strategy A \u2014 Sweep + BOS: Prev day H/L or session H/L bullish sweep (wick below + close back above), then 5M BOS bullish confirmation (min 3 candles post-sweep). Entry on 1M FVG + IFVG retrace, or fallback to next 5M open after BOS.',
      'Strategy B \u2014 IFVG Mid Retrace: Find 5M FVGs \u2265 5pt wide that get inversed (price closes through entire FVG). After inversion, wait for price to retrace back down to the IFVG midpoint \u2192 LONG entry.',
      'Strategy C \u2014 Uptrend FVG Tap-Back: Bullish FVG forms in an uptrend (\u22652 higher highs + higher lows), FVG must be \u2265 4pt wide. Wait for price to tap back into the FVG zone \u2192 LONG entry at FVG midpoint. SL/TP are fixed at entry and never move.',
      'Any strategy can trigger a trade \u2014 first signal wins.',
    ],
    risk: {
      sl: 'Sweep wick extreme + 2pt buffer (min 5pt, max 30pt). SL is fixed at entry \u2014 never moves.',
      tp: 'Nearest swing high \u2265 SL \u00d7 6 distance (search window extends 30pt beyond). TP is fixed at entry \u2014 never moves.',
      rr: '6:1',
      units: '2 contracts',
      cooldown: '5 min between trades, 10 min same-bias dedup',
    },
    signals: ['Sweep+BOS', 'Sweep+BOS+1mIFVG', 'IFVG-Mid-Retrace', 'Uptrend-FVG-TapBack'],
  },

  'MNQ1!': {
    name: 'Sweep + BOS + IFVG Mid + Uptrend FVG Tap-Back',
    rules: [
      'Kill Zones: Asia 8pm\u2013midnight ET, London 3\u20135am ET, NY 8:30am\u201312pm ET, NY PM 1:30\u20133pm ET',
      'Strategy A \u2014 Sweep + BOS: Prev day H/L or session H/L bullish sweep, then 5M BOS bullish confirmation. Entry on 1M FVG + IFVG retrace, or fallback to next 5M open after BOS.',
      'Strategy B \u2014 IFVG Mid Retrace: Find 5M FVGs \u2265 16pt wide that get inversed. After inversion, wait for midpoint retrace \u2192 LONG entry.',
      'Strategy C \u2014 Uptrend FVG Tap-Back: Bullish FVG forms in an uptrend (\u22652 higher highs + higher lows), FVG must be \u2265 4pt wide. Wait for price to tap back into the FVG zone \u2192 LONG entry at FVG midpoint. SL/TP are fixed at entry and never move.',
      'Fixed SL of 35pt. Any strategy can trigger.',
    ],
    risk: {
      sl: 'Fixed 20pt. SL is fixed at entry \u2014 never moves.',
      tp: 'Nearest swing high \u2265 SL \u00d7 6 distance. TP is fixed at entry \u2014 never moves.',
      rr: '6:1',
      units: '2 contracts',
      cooldown: '5 min between trades, 10 min same-bias dedup',
    },
    signals: ['Sweep+BOS', 'Sweep+BOS+1mIFVG', 'IFVG-Mid-Retrace', 'Uptrend-FVG-TapBack'],
  },

  'MGC1!': {
    name: 'HTF Bias + IFVG Mid + Uptrend FVG Tap-Back',
    rules: [
      'Kill Zones: Asia open 8pm\u2013midnight ET, NY open 8am\u2013noon ET',
      'Strategy A \u2014 HTF Bias: 4H BOS sets bullish direction, 1H BOS must agree. No open FVG on 4H or 1H blocking path to TP. Enter on 5M FVG midpoint first touch only (skip if touched > 1 time). Longs \u2265 5pt, Shorts \u2265 7pt FVG width.',
      'Strategy B \u2014 IFVG Mid Retrace: Find 5M FVGs \u2265 4pt wide that get inversed. After inversion, wait for midpoint retrace \u2192 LONG entry.',
      'Strategy C \u2014 Uptrend FVG Tap-Back: Bullish FVG forms in an uptrend (\u22652 higher highs + higher lows), FVG must be \u2265 4pt wide. Wait for price to tap back into the FVG zone \u2192 LONG entry at FVG midpoint. SL/TP are fixed at entry and never move.',
      'All strategies active \u2014 merged with dedup.',
    ],
    risk: {
      sl: 'Fixed 20pt. SL is fixed at entry \u2014 never moves.',
      tp: 'HTF: nearest 1H swing high beyond entry. IFVG/FVG Tap-Back: dynamic \u2265 SL \u00d7 8. TP is fixed at entry \u2014 never moves.',
      rr: '8:1',
      units: '2 contracts',
      cooldown: '5 min between trades, 10 min same-bias dedup',
    },
    signals: ['HTFBias+4h/1hClean+5mFVG+MidRetrace', 'IFVG-Mid-Retrace', 'Uptrend-FVG-TapBack'],
  },
}

// ── Components ───────────────────────────────────────────────────────────────

function RuleRow({ label, value }) {
  return (
    <div style={{
      display: 'flex', gap: 10, padding: '5px 0',
      borderBottom: '1px solid #111827',
    }}>
      <span style={{
        fontSize: 10, fontWeight: 700, color: '#6b7280',
        textTransform: 'uppercase', letterSpacing: '0.5px',
        minWidth: 90, flexShrink: 0,
      }}>
        {label}
      </span>
      <span style={{ fontSize: 11, color: '#d1d5db' }}>{value}</span>
    </div>
  )
}

function SideCard({ side, strat, color, bgColor, badgeBg, badgeColor }) {
  if (!strat) {
    return (
      <div style={{
        flex: 1, background: '#0a0a0a', borderRadius: 8, padding: 14,
        border: '1px dashed #1f2937', display: 'flex', alignItems: 'center',
        justifyContent: 'center', minHeight: 120,
      }}>
        <span style={{ fontSize: 13, color: '#4b5563', fontStyle: 'italic' }}>
          {side} strategy not configured yet
        </span>
      </div>
    )
  }

  return (
    <div style={{
      flex: 1, background: '#0a0a0a', borderRadius: 8, padding: 12,
      border: `1px solid ${bgColor}`,
    }}>
      {/* Side badge + strategy name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{
          fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 4,
          background: badgeBg, color: badgeColor, letterSpacing: '0.5px',
        }}>
          {side}
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#e5e7eb' }}>
          {strat.name}
        </span>
      </div>

      {/* Rules */}
      <div style={{ marginBottom: 10 }}>
        <div style={{
          fontSize: 9, fontWeight: 700, color, textTransform: 'uppercase',
          letterSpacing: '0.5px', marginBottom: 5,
        }}>
          Entry Rules
        </div>
        {strat.rules.map((rule, i) => (
          <div key={i} style={{
            fontSize: 11, color: '#d1d5db', lineHeight: 1.4,
            padding: '4px 0', borderBottom: '1px solid #111827',
          }}>
            {rule}
          </div>
        ))}
      </div>

      {/* Risk */}
      <div style={{ marginBottom: 8 }}>
        <div style={{
          fontSize: 9, fontWeight: 700, color: '#f87171', textTransform: 'uppercase',
          letterSpacing: '0.5px', marginBottom: 4,
        }}>
          Risk Management
        </div>
        <RuleRow label="Stop Loss" value={strat.risk.sl} />
        <RuleRow label="Take Profit" value={strat.risk.tp} />
        <RuleRow label="Min R:R" value={strat.risk.rr} />
        <RuleRow label="Contracts" value={strat.risk.units} />
        <RuleRow label="Cooldown" value={strat.risk.cooldown} />
      </div>

      {/* Signal labels */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6,
      }}>
        {strat.signals.map(s => (
          <code key={s} style={{
            fontSize: 10, fontWeight: 700, color: '#fbbf24',
            background: '#1c1917', padding: '2px 6px', borderRadius: 4,
          }}>
            {s}
          </code>
        ))}
      </div>
    </div>
  )
}

function SymbolStrategy({ symbol }) {
  const info = FUTURES.find(f => f.symbol === symbol)
  const shortStrat = SHORT_STRATEGIES[symbol]
  const longStrat  = LONG_STRATEGIES[symbol]

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
      {/* Symbol header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        paddingBottom: 8, borderBottom: '1px solid #1f2937',
      }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>{symbol}</span>
        <span style={{ fontSize: 11, color: '#6b7280' }}>{info?.name}</span>
        <span style={{
          marginLeft: 'auto', fontSize: 11, color: '#9ca3af',
          background: '#111827', padding: '3px 10px', borderRadius: 6,
        }}>
          ${CONTRACT_MULTIPLIER[symbol]}/pt &middot; {UNITS[symbol]} unit{UNITS[symbol] > 1 ? 's' : ''}
        </span>
      </div>

      {/* Short + Long side by side */}
      <div style={{ display: 'flex', gap: 8 }}>
        <SideCard
          side="SHORT"
          strat={shortStrat}
          color="#f87171"
          bgColor="#1c1917"
          badgeBg="#7f1d1d"
          badgeColor="#fca5a5"
        />
        <SideCard
          side="LONG"
          strat={longStrat}
          color="#4ade80"
          bgColor="#1c1917"
          badgeBg="#14532d"
          badgeColor="#86efac"
        />
      </div>
    </div>
  )
}

export default function Strategy() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{
        fontSize: 11, fontWeight: 600, color: '#6b7280',
        textTransform: 'uppercase', letterSpacing: '0.5px',
      }}>
        Strategy Rules by Symbol
      </div>

      {FUTURES.map(f => <SymbolStrategy key={f.symbol} symbol={f.symbol} />)}
    </div>
  )
}
