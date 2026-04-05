import { useStore } from '../store'

const UNIT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const TRADE_LIMIT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

export default function LiveTrading() {
  const {
    futures, livePrice, tradeSettings, updateTradeSetting,
    symbolEnabled, toggleSymbol,
    enterTrade, trades, masterSwitch, toggleMasterSwitch,
  } = useStore()

  const openTrades = trades.filter(t => t.status === 'OPEN')
  const enabledSymbols = futures.filter(f => symbolEnabled[f.symbol])
  const units = tradeSettings.liveUnits || 1
  const maxTrades = tradeSettings.liveMaxTrades || 3

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>

      {/* Master Switch */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Live Trading</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
            {masterSwitch ? 'Trades will be placed and executed' : 'Trading is disabled'}
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
        <div style={{ fontSize: 11, color: '#6b7280' }}>How many contracts to buy per trade</div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {UNIT_OPTIONS.map(n => (
            <button
              key={n}
              onClick={() => updateTradeSetting('liveUnits', n)}
              style={{
                width: 42, height: 38, borderRadius: 8, border: '1px solid',
                borderColor: units === n ? '#7c3aed' : '#374151',
                background: units === n ? '#4c1d95' : '#1f2937',
                color: units === n ? '#c4b5fd' : '#6b7280',
                fontWeight: 700, fontSize: 14, cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Max trades per day */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Max Trades per Day</div>
        <div style={{ fontSize: 11, color: '#6b7280' }}>Limit how many trades can be taken</div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {TRADE_LIMIT_OPTIONS.map(n => (
            <button
              key={n}
              onClick={() => updateTradeSetting('liveMaxTrades', n)}
              style={{
                width: 42, height: 38, borderRadius: 8, border: '1px solid',
                borderColor: maxTrades === n ? '#2563eb' : '#374151',
                background: maxTrades === n ? '#1e3a5f' : '#1f2937',
                color: maxTrades === n ? '#93c5fd' : '#6b7280',
                fontWeight: 700, fontSize: 14, cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Active Symbols */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Active Symbols</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {futures.map(f => {
            const enabled = symbolEnabled[f.symbol]
            const open = openTrades.filter(t => t.symbol === f.symbol).length
            const price = livePrice[f.symbol]
            return (
              <div key={f.symbol} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 12px', borderRadius: 8,
                border: `1px solid ${enabled ? '#1d4ed8' : '#1f2937'}`,
                background: enabled ? '#0f172a' : '#111827',
                transition: 'all 0.15s', gap: 10,
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{f.symbol}</div>
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
            )
          })}
        </div>

        {masterSwitch && (
          <div style={{ fontSize: 11, color: '#4ade80', background: '#14532d', borderRadius: 6, padding: '6px 10px', textAlign: 'center' }}>
            Live trading active — {units} unit{units !== 1 ? 's' : ''} per trade, max {maxTrades}/day on {enabledSymbols.length} symbol{enabledSymbols.length !== 1 ? 's' : ''}
          </div>
        )}

        <button
          onClick={() => enabledSymbols.forEach(f => enterTrade(f.symbol))}
          disabled={!masterSwitch || enabledSymbols.length === 0}
          style={{
            width: '100%', padding: '10px 0', borderRadius: 8, border: 'none',
            background: !masterSwitch || enabledSymbols.length === 0 ? '#1f2937' : '#2563eb',
            color: !masterSwitch || enabledSymbols.length === 0 ? '#4b5563' : '#fff',
            fontWeight: 700, fontSize: 13, cursor: !masterSwitch || enabledSymbols.length === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          {!masterSwitch ? 'Enable master switch to trade'
            : enabledSymbols.length === 0 ? 'No symbols selected'
            : `Enter Trade — ${enabledSymbols.map(f => f.symbol).join(' · ')}`}
        </button>
      </div>
    </div>
  )
}
