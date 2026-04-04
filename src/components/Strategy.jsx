import { FUTURES } from '../store'
import { CONTRACT_MULTIPLIER } from '../utils/strategy'

const FIXED_SL = { 'MES1!': null, 'MNQ1!': 35, 'MGC1!': 20, 'Sl1!': 15 }

function sweepBOSStrategy(symbol) {
  return {
    name: 'Daily Sweep + BOS + 1M IFVG',
    confluences: [
      { label: 'Kill Zones', value: 'London 3\u20135am ET, NY 8:30am\u201312pm ET, NY PM 1:30\u20133pm ET' },
      { label: 'Confluence 1', value: 'Prev day H/L sweep OR session H/L sweep \u2014 wick through + close back' },
      { label: 'Confluence 2', value: '5M BOS after sweep, same direction (min 3 post-sweep candles)' },
      { label: 'Entry (primary)', value: '1M FVG (\u22653pt) + IFVG retrace after BOS' },
      { label: 'Entry (fallback)', value: 'Next 5M candle open after BOS' },
    ],
    risk: [
      { label: 'Stop Loss', value: FIXED_SL[symbol] != null
        ? `Fixed ${FIXED_SL[symbol]}pt ($${FIXED_SL[symbol] * CONTRACT_MULTIPLIER[symbol]} risk)`
        : 'Sweep wick extreme \u00b12pt buffer (min 10pt, max 60pt)' },
      { label: 'Take Profit', value: `Nearest swing H/L \u2265 SL\u00d7${symbol === 'MES1!' ? '3' : '2'} distance` },
      { label: 'Min R:R', value: symbol === 'MES1!' ? '3:1' : '2:1' },
      { label: 'Cooldown', value: '10 min (backtest), 60s (live auto-trade)' },
      { label: 'Multiplier', value: `$${CONTRACT_MULTIPLIER[symbol]} per point` },
    ],
    signal: 'Sweep+BOS+1mIFVG or Sweep+BOS',
  }
}

const STRATEGIES = {
  'MES1!': sweepBOSStrategy('MES1!'),
  'MNQ1!': sweepBOSStrategy('MNQ1!'),
  'MGC1!': {
    name: 'HTF Bias + 4H/1H Clean + 5M FVG Midpoint',
    confluences: [
      { label: 'Kill Zones', value: 'Asia open 8pm\u2013midnight ET, NY open 8am\u2013noon ET' },
      { label: 'Step 1', value: '4H BOS sets trade direction (no counter-trend)' },
      { label: 'Step 2', value: '1H BOS must agree with 4H direction' },
      { label: 'Step 3', value: 'TP = nearest 1H swing H/L beyond current price' },
      { label: 'Step 4', value: 'No open FVG on 4H or 1H blocking path to TP' },
      { label: 'Step 5', value: '5M FVG matching bias, enter on first midpoint touch only (skip if touched >1 time)' },
      { label: '1M FVG Min', value: 'Bullish \u22655pt, Bearish \u22657pt' },
    ],
    risk: [
      { label: 'Stop Loss', value: `Fixed ${FIXED_SL['MGC1!']}pt ($${FIXED_SL['MGC1!'] * CONTRACT_MULTIPLIER['MGC1!']} risk)` },
      { label: 'Take Profit', value: 'Nearest 1H swing H/L beyond entry' },
      { label: 'Min R:R', value: '2:1' },
      { label: 'Cooldown', value: '10 min (backtest), 60s (live auto-trade)' },
      { label: 'Multiplier', value: `$${CONTRACT_MULTIPLIER['MGC1!']} per point` },
    ],
    signal: 'HTFBias+4h/1hClean+5mFVG+MidRetrace',
  },
  'Sl1!': sweepBOSStrategy('Sl1!'),
}

function RuleRow({ label, value }) {
  return (
    <div style={{
      display: 'flex', gap: 12, padding: '8px 0',
      borderBottom: '1px solid #111827',
    }}>
      <span style={{
        fontSize: 11, fontWeight: 700, color: '#6b7280',
        textTransform: 'uppercase', letterSpacing: '0.5px',
        minWidth: 120, flexShrink: 0,
      }}>
        {label}
      </span>
      <span style={{ fontSize: 13, color: '#d1d5db' }}>{value}</span>
    </div>
  )
}

function StrategyCard({ symbol }) {
  const info   = FUTURES.find(f => f.symbol === symbol)
  const strat  = STRATEGIES[symbol]
  if (!strat) return null

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid #1f2937',
      }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{symbol}</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{info?.name}</div>
        </div>
        <div style={{
          fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 6,
          background: '#1e3a5f', color: '#93c5fd',
        }}>
          {strat.name}
        </div>
      </div>

      {/* Confluences */}
      <div style={{ marginBottom: 16 }}>
        <div style={{
          fontSize: 10, fontWeight: 700, color: '#4ade80',
          textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6,
        }}>
          Entry Confluences
        </div>
        {strat.confluences.map(r => <RuleRow key={r.label} {...r} />)}
      </div>

      {/* Risk management */}
      <div style={{ marginBottom: 12 }}>
        <div style={{
          fontSize: 10, fontWeight: 700, color: '#f87171',
          textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6,
        }}>
          Risk Management
        </div>
        {strat.risk.map(r => <RuleRow key={r.label} {...r} />)}
      </div>

      {/* Signal label */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: '#111827', borderRadius: 8, padding: '8px 12px', marginTop: 4,
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>Signal Label</span>
        <code style={{
          fontSize: 12, fontWeight: 700, color: '#fbbf24',
          background: '#1c1917', padding: '2px 8px', borderRadius: 4,
        }}>
          {strat.signal}
        </code>
      </div>
    </div>
  )
}

export default function Strategy() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{
        fontSize: 11, fontWeight: 600, color: '#6b7280',
        textTransform: 'uppercase', letterSpacing: '0.5px',
      }}>
        Strategy Rules by Symbol
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16 }}>
        {FUTURES.map(f => <StrategyCard key={f.symbol} symbol={f.symbol} />)}
      </div>
    </div>
  )
}
