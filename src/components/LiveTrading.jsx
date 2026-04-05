import { useStore } from '../store'

const UNIT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const TRADE_LIMIT_OPTIONS = [1, 2, 3, 4, 5, '∞']

// Base margin at reference prices — scales with live price
const BASE_MARGIN = {
  'MES1!': { margin: 1650.94, refPrice: 5400 },
  'MNQ1!': { margin: 2412.80, refPrice: 18800 },
  'MGC1!': { margin: 2354.10, refPrice: 4700 },
}

function getMargin(symbol, livePrice) {
  const base = BASE_MARGIN[symbol]
  if (!base) return 1000
  const price = livePrice || base.refPrice
  return parseFloat((base.margin * (price / base.refPrice)).toFixed(2))
}

export default function LiveTrading() {
  const {
    futures, livePrice, tradeSettings, updateTradeSetting,
    symbolEnabled, toggleSymbol,
    enterTrade, trades, masterSwitch, toggleMasterSwitch,
  } = useStore()

  const openTrades = trades.filter(t => t.status === 'OPEN')
  const enabledSymbols = futures.filter(f => symbolEnabled[f.symbol])
  const units = tradeSettings.liveUnits || 1
  const liveMaxPerSymbol = tradeSettings.liveMaxPerSymbol || {}

  const getMaxForSymbol = (sym) => liveMaxPerSymbol[sym] || 3

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>

      {/* Master Switch */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Live Trading</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
            {masterSwitch ? 'Strategy running — auto-entering shorts' : 'Trading is disabled'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: masterSwitch ? '#4ade80' : '#6b7280' }}>
            {masterSwitch ? 'ON' : 'OFF'}
          </span>
          <button
            onClick={toggleMasterSwitch}
            style={{
              position: 'relative', width: 56, height: 30, borderRadius: 15,
              border: 'none', background: masterSwitch ? '#16a34a' : '#374151',
              cursor: 'pointer', transition: 'background 0.2s',
            }}
          >
            <span style={{
              position: 'absolute', top: 4,
              left: masterSwitch ? 30 : 4,
              width: 22, height: 22, borderRadius: '50%',
              background: '#fff', transition: 'left 0.2s', display: 'block',
            }} />
          </button>
        </div>
      </div>

      {/* Units per trade */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Units per Trade</div>
        <div style={{ fontSize: 11, color: '#6b7280' }}>Each unit = 1 contract of margin (costs fluctuate with price)</div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {UNIT_OPTIONS.map(n => {
            const avgCost = enabledSymbols.length > 0
              ? enabledSymbols.reduce((s, f) => s + getMargin(f.symbol, livePrice[f.symbol]), 0) / enabledSymbols.length
              : getMargin('MES1!', livePrice['MES1!'])
            const cost = n * avgCost
            return (
              <button
                key={n}
                onClick={() => updateTradeSetting('liveUnits', n)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  width: 52, padding: '6px 0', borderRadius: 8, border: '1px solid',
                  borderColor: units === n ? '#7c3aed' : '#374151',
                  background: units === n ? '#4c1d95' : '#1f2937',
                  color: units === n ? '#c4b5fd' : '#6b7280',
                  fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                <span style={{ fontSize: 14 }}>{n}</span>
                <span style={{ fontSize: 8, opacity: 0.7 }}>${(cost / 1000).toFixed(1)}k</span>
              </button>
            )
          })}
        </div>
        {/* Per-symbol margin breakdown */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 2 }}>
          {futures.map(f => {
            const m = getMargin(f.symbol, livePrice[f.symbol])
            return (
              <div key={f.symbol} style={{ fontSize: 10, color: '#6b7280' }}>
                {f.symbol}: <span style={{ color: '#93c5fd', fontFamily: 'monospace' }}>${(m * units).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Active Symbols with per-symbol max trades */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Active Symbols</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {futures.map(f => {
            const enabled = symbolEnabled[f.symbol]
            const open = openTrades.filter(t => t.symbol === f.symbol).length
            const price = livePrice[f.symbol]
            const symMax = getMaxForSymbol(f.symbol)
            const selectedMax = symMax === 'infinite' ? '∞' : symMax
            const margin = getMargin(f.symbol, price)
            return (
              <div key={f.symbol} style={{
                padding: '10px 12px', borderRadius: 8,
                border: `1px solid ${enabled ? '#1d4ed8' : '#1f2937'}`,
                background: enabled ? '#0f172a' : '#111827',
                transition: 'all 0.15s',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>
                      {f.symbol}
                      <span style={{ fontSize: 10, color: '#6b7280', fontWeight: 400, marginLeft: 6 }}>${margin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/contract</span>
                    </div>
                    <div style={{ fontSize: 10, color: '#6b7280' }}>{f.name}</div>
                    <div style={{ fontFamily: 'monospace', color: '#60a5fa', fontSize: 12, marginTop: 1 }}>
                      ${price?.toFixed(2)}
                      {open > 0 && <span style={{ color: '#60a5fa', background: '#1e3a5f', padding: '1px 5px', borderRadius: 999, marginLeft: 4, fontSize: 10 }}>{open} open</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <button
                      onClick={() => toggleSymbol(f.symbol)}
                      style={{
                        position: 'relative', width: 44, height: 24, borderRadius: 12,
                        border: 'none', background: enabled ? '#16a34a' : '#374151',
                        cursor: 'pointer', transition: 'background 0.2s',
                      }}
                    >
                      <span style={{
                        position: 'absolute', top: 3,
                        left: enabled ? 23 : 3,
                        width: 18, height: 18, borderRadius: '50%',
                        background: '#fff', transition: 'left 0.2s', display: 'block',
                      }} />
                    </button>
                  </div>
                </div>
                {/* Per-symbol trades per day */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, color: '#6b7280', fontWeight: 600, minWidth: 70 }}>Trades/day</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {TRADE_LIMIT_OPTIONS.map(c => {
                      const val = c === '∞' ? 'infinite' : c
                      return (
                        <button
                          key={c}
                          onClick={() => updateTradeSetting('liveMaxPerSymbol', { ...liveMaxPerSymbol, [f.symbol]: val })}
                          style={{
                            width: 34, height: 28, borderRadius: 6, border: '1px solid',
                            borderColor: selectedMax === c ? '#2563eb' : '#374151',
                            background: selectedMax === c ? '#1e3a5f' : '#1f2937',
                            color: selectedMax === c ? '#93c5fd' : '#6b7280',
                            fontWeight: 700, fontSize: 12, cursor: 'pointer',
                            transition: 'all 0.15s',
                          }}
                        >
                          {c}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {masterSwitch && (
          <div style={{ fontSize: 11, color: '#4ade80', background: '#14532d', borderRadius: 6, padding: '6px 10px', textAlign: 'center' }}>
            Strategy running every 30s — {units} unit{units !== 1 ? 's' : ''} per trade on {enabledSymbols.length} symbol{enabledSymbols.length !== 1 ? 's' : ''}
          </div>
        )}

        <button
          onClick={() => enabledSymbols.forEach(f => enterTrade(f.symbol))}
          disabled={!masterSwitch || enabledSymbols.length === 0}
          style={{
            width: '100%', padding: '16px 0', borderRadius: 12, border: 'none',
            background: !masterSwitch || enabledSymbols.length === 0 ? '#1f2937' : '#dc2626',
            color: !masterSwitch || enabledSymbols.length === 0 ? '#4b5563' : '#fff',
            fontWeight: 800, fontSize: 16, cursor: !masterSwitch || enabledSymbols.length === 0 ? 'not-allowed' : 'pointer',
            letterSpacing: '0.5px', textTransform: 'uppercase',
            boxShadow: masterSwitch && enabledSymbols.length > 0 ? '0 0 20px rgba(220, 38, 38, 0.4)' : 'none',
            transition: 'all 0.2s',
          }}
        >
          {!masterSwitch ? 'Enable master switch to trade'
            : enabledSymbols.length === 0 ? 'No symbols selected'
            : 'Big Red Button'}
        </button>
      </div>
    </div>
  )
}
