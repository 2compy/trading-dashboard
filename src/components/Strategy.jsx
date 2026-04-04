import { FUTURES } from '../store'
import { CONTRACT_MULTIPLIER } from '../utils/strategy'

const SYMBOL_RR = { 'MES1!': 3, 'MNQ1!': 3, 'MGC1!': 3, 'Sl1!': 2 }
const UNITS     = { 'MES1!': 2, 'MNQ1!': 2, 'MGC1!': 2, 'Sl1!': 1 }
const FIXED_SL  = { 'MES1!': null, 'MNQ1!': 35, 'MGC1!': 20, 'Sl1!': 15 }
const FVG_WIDTH = { 'MES1!': 7, 'MNQ1!': 20, 'MGC1!': 3, 'Sl1!': 0.10 }

// ── SHORT strategies per symbol ──────────────────────────────────────────────

const SHORT_STRATEGIES = {
  'MES1!': {
    name: 'Sweep + BOS + IFVG Mid Retrace',
    rules: [
      'Kill Zones: London 3\u20135am ET, NY 8:30am\u201312pm ET, NY PM 1:30\u20133pm ET',
      'Strategy A \u2014 Sweep + BOS: Prev day H/L or session H/L bearish sweep (wick above + close back below), then 5M BOS bearish confirmation (min 3 candles post-sweep). Entry on 1M FVG + IFVG retrace, or fallback to next 5M open after BOS.',
      'Strategy B \u2014 IFVG Mid Retrace: Find 5M FVGs \u2265 7pt wide that get inversed (price closes through entire FVG). After inversion, wait for price to retrace back up to the IFVG midpoint \u2192 SHORT entry.',
      'Either strategy can trigger a trade \u2014 first signal wins.',
    ],
    risk: {
      sl: 'Sweep wick extreme + 2pt buffer (min 10pt, max 60pt)',
      tp: 'Nearest swing low \u2265 SL \u00d7 3 distance (search window extends 30pt beyond)',
      rr: '3:1',
      units: '2 contracts',
      cooldown: '10 min between trades, 20 min same-bias dedup',
    },
    signals: ['Sweep+BOS', 'Sweep+BOS+1mIFVG', 'IFVG-Mid-Retrace'],
  },

  'MNQ1!': {
    name: 'Sweep + BOS + IFVG Mid Retrace',
    rules: [
      'Kill Zones: London 3\u20135am ET, NY 8:30am\u201312pm ET, NY PM 1:30\u20133pm ET',
      'Strategy A \u2014 Sweep + BOS: Prev day H/L or session H/L bearish sweep, then 5M BOS bearish confirmation. Entry on 1M FVG + IFVG retrace, or fallback to next 5M open after BOS.',
      'Strategy B \u2014 IFVG Mid Retrace: Find 5M FVGs \u2265 20pt wide that get inversed. After inversion, wait for midpoint retrace \u2192 SHORT entry.',
      'Fixed SL of 35pt. Either strategy can trigger.',
    ],
    risk: {
      sl: 'Fixed 35pt ($70 risk per contract)',
      tp: 'Nearest swing low \u2265 SL \u00d7 3 distance',
      rr: '3:1',
      units: '2 contracts',
      cooldown: '10 min between trades, 20 min same-bias dedup',
    },
    signals: ['Sweep+BOS', 'Sweep+BOS+1mIFVG', 'IFVG-Mid-Retrace'],
  },

  'MGC1!': {
    name: 'HTF Bias + IFVG Mid Retrace',
    rules: [
      'Kill Zones: Asia open 8pm\u2013midnight ET, NY open 8am\u2013noon ET',
      'Strategy A \u2014 HTF Bias: 4H BOS sets bearish direction, 1H BOS must agree. No open FVG on 4H or 1H blocking path to TP. Enter on 5M FVG midpoint first touch only (skip if touched > 1 time). Longs \u2265 5pt, Shorts \u2265 7pt FVG width.',
      'Strategy B \u2014 IFVG Mid Retrace: Find 5M FVGs \u2265 3pt wide that get inversed. After inversion, wait for midpoint retrace \u2192 SHORT entry.',
      'Both strategies active \u2014 merged with aggressive dedup.',
    ],
    risk: {
      sl: 'Fixed 20pt ($200 risk per contract)',
      tp: 'HTF: nearest 1H swing low beyond entry. IFVG: dynamic \u2265 SL \u00d7 3',
      rr: '3:1',
      units: '2 contracts',
      cooldown: '10 min between trades, 20 min same-bias dedup',
    },
    signals: ['HTFBias+4h/1hClean+5mFVG+MidRetrace', 'IFVG-Mid-Retrace'],
  },

  'Sl1!': {
    name: 'Sweep + BOS + IFVG Mid Retrace',
    rules: [
      'Kill Zones: London 3\u20135am ET, NY 8:30am\u201312pm ET, NY PM 1:30\u20133pm ET',
      'Strategy A \u2014 Sweep + BOS: Prev day H/L or session H/L bearish sweep, then 5M BOS bearish confirmation. Entry on 1M FVG + IFVG retrace, or fallback to next 5M open after BOS.',
      'Strategy B \u2014 IFVG Mid Retrace: Find 5M FVGs \u2265 0.10pt wide that get inversed. After inversion, wait for midpoint retrace \u2192 SHORT entry.',
      'Fixed SL of 15pt. Either strategy can trigger.',
    ],
    risk: {
      sl: 'Fixed 15pt ($75 risk per contract)',
      tp: 'Nearest swing low \u2265 SL \u00d7 2 distance',
      rr: '2:1',
      units: '1 contract',
      cooldown: '10 min between trades, 20 min same-bias dedup',
    },
    signals: ['Sweep+BOS', 'Sweep+BOS+1mIFVG', 'IFVG-Mid-Retrace'],
  },
}

// ── LONG strategies per symbol (placeholder \u2014 to be filled in) ─────────────────

const LONG_STRATEGIES = {
  'MES1!': null,
  'MNQ1!': null,
  'MGC1!': null,
  'Sl1!':  null,
}

// ── Components ───────────────────────────────────────────────────────────────

function RuleRow({ label, value }) {
  return (
    <div style={{
      display: 'flex', gap: 12, padding: '8px 0',
      borderBottom: '1px solid #111827',
    }}>
      <span style={{
        fontSize: 11, fontWeight: 700, color: '#6b7280',
        textTransform: 'uppercase', letterSpacing: '0.5px',
        minWidth: 110, flexShrink: 0,
      }}>
        {label}
      </span>
      <span style={{ fontSize: 13, color: '#d1d5db' }}>{value}</span>
    </div>
  )
}

function SideCard({ side, strat, color, bgColor, badgeBg, badgeColor }) {
  if (!strat) {
    return (
      <div style={{
        flex: 1, background: '#0a0a0a', borderRadius: 10, padding: 20,
        border: '1px dashed #1f2937', display: 'flex', alignItems: 'center',
        justifyContent: 'center', minHeight: 200,
      }}>
        <span style={{ fontSize: 13, color: '#4b5563', fontStyle: 'italic' }}>
          {side} strategy not configured yet
        </span>
      </div>
    )
  }

  return (
    <div style={{
      flex: 1, background: '#0a0a0a', borderRadius: 10, padding: 16,
      border: `1px solid ${bgColor}`,
    }}>
      {/* Side badge + strategy name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{
          fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 4,
          background: badgeBg, color: badgeColor, letterSpacing: '0.5px',
        }}>
          {side}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#e5e7eb' }}>
          {strat.name}
        </span>
      </div>

      {/* Rules */}
      <div style={{ marginBottom: 14 }}>
        <div style={{
          fontSize: 10, fontWeight: 700, color, textTransform: 'uppercase',
          letterSpacing: '0.5px', marginBottom: 8,
        }}>
          Entry Rules
        </div>
        {strat.rules.map((rule, i) => (
          <div key={i} style={{
            fontSize: 12, color: '#d1d5db', lineHeight: 1.5,
            padding: '6px 0', borderBottom: '1px solid #111827',
          }}>
            {rule}
          </div>
        ))}
      </div>

      {/* Risk */}
      <div style={{ marginBottom: 12 }}>
        <div style={{
          fontSize: 10, fontWeight: 700, color: '#f87171', textTransform: 'uppercase',
          letterSpacing: '0.5px', marginBottom: 6,
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
        display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8,
      }}>
        {strat.signals.map(s => (
          <code key={s} style={{
            fontSize: 11, fontWeight: 700, color: '#fbbf24',
            background: '#1c1917', padding: '2px 8px', borderRadius: 4,
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
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Symbol header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        paddingBottom: 12, borderBottom: '1px solid #1f2937',
      }}>
        <span style={{ fontWeight: 700, fontSize: 18 }}>{symbol}</span>
        <span style={{ fontSize: 12, color: '#6b7280' }}>{info?.name}</span>
        <span style={{
          marginLeft: 'auto', fontSize: 11, color: '#9ca3af',
          background: '#111827', padding: '3px 10px', borderRadius: 6,
        }}>
          ${CONTRACT_MULTIPLIER[symbol]}/pt &middot; {UNITS[symbol]} unit{UNITS[symbol] > 1 ? 's' : ''}
        </span>
      </div>

      {/* Short + Long side by side */}
      <div style={{ display: 'flex', gap: 12 }}>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
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
