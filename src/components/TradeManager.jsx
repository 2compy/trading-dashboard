import { useStore } from '../store'

const COUNT_OPTIONS = [1, 2, 3, 4, 5, '∞']

function Field({ label, value, onChange, placeholder }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</label>
      <input
        type="number"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  )
}

export default function TradeManager() {
  const {
    futures, livePrice, tradeSettings, updateTradeSetting,
    symbolEnabled, toggleSymbol, symbolSide, setSymbolSide,
    enterTrade, trades, masterSwitch,
  } = useStore()

  const s = tradeSettings
  const openTrades = trades.filter(t => t.status === 'OPEN')
  const selectedCount = s.tradeCount === 'infinite' ? '∞' : s.tradeCount
  const enabledSymbols = futures.filter(f => symbolEnabled[f.symbol])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 640 }}>

      {/* Global settings card */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Trade Settings</div>

        <Field label="Amount ($)" value={s.amount} onChange={v => updateTradeSetting('amount', v)} placeholder="1000" />
        <Field label="Stop Loss"  value={s.stopLoss}   onChange={v => updateTradeSetting('stopLoss', v)}   placeholder="e.g. 5350.00" />
        <Field label="Take Profit" value={s.takeProfit} onChange={v => updateTradeSetting('takeProfit', v)} placeholder="e.g. 5500.00" />

        {/* Trades per execution */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Trades per execution</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {COUNT_OPTIONS.map(c => (
              <button
                key={c}
                onClick={() => updateTradeSetting('tradeCount', c === '∞' ? 'infinite' : c)}
                style={{
                  flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid',
                  borderColor: selectedCount === c ? '#7c3aed' : '#374151',
                  background:  selectedCount === c ? '#4c1d95' : '#1f2937',
                  color: selectedCount === c ? '#c4b5fd' : '#6b7280',
                  fontWeight: 700, fontSize: 13, cursor: 'pointer',
                }}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Symbol toggles */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Active Symbols</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {futures.map(f => {
            const enabled = symbolEnabled[f.symbol]
            const side = symbolSide[f.symbol]
            const open = openTrades.filter(t => t.symbol === f.symbol).length
            const price = livePrice[f.symbol]
            return (
              <div key={f.symbol} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 14px', borderRadius: 10,
                border: `1px solid ${enabled ? '#1d4ed8' : '#1f2937'}`,
                background: enabled ? '#0f172a' : '#111827',
                transition: 'all 0.15s', gap: 12,
              }}>
                {/* Symbol info */}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{f.symbol}</div>
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 1 }}>{f.name}</div>
                  <div style={{ fontFamily: 'monospace', color: '#60a5fa', fontSize: 12, marginTop: 2 }}>
                    ${price?.toFixed(2)}
                    {open > 0 && <span style={{ color: '#60a5fa', background: '#1e3a5f', padding: '1px 6px', borderRadius: 999, marginLeft: 6, fontSize: 10 }}>{open} open</span>}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  {/* Long / Short per symbol */}
                  <div style={{ display: 'flex', borderRadius: 7, overflow: 'hidden', border: '1px solid #374151' }}>
                    {['LONG', 'SHORT'].map(s => (
                      <button key={s} onClick={() => setSymbolSide(f.symbol, s)} style={{
                        padding: '5px 10px', fontSize: 11, fontWeight: 700, border: 'none',
                        background: side === s ? (s === 'LONG' ? '#16a34a' : '#dc2626') : '#1f2937',
                        color: side === s ? '#fff' : '#6b7280',
                        cursor: 'pointer', transition: 'all 0.15s',
                      }}>
                        {s}
                      </button>
                    ))}
                  </div>

                  {/* ON/OFF toggle */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: enabled ? '#4ade80' : '#6b7280' }}>
                      {enabled ? 'ON' : 'OFF'}
                    </span>
                    <button
                      onClick={() => toggleSymbol(f.symbol)}
                      style={{
                        position: 'relative', width: 48, height: 26, borderRadius: 13,
                        border: 'none', background: enabled ? '#16a34a' : '#374151',
                        cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0,
                      }}
                    >
                      <span style={{
                        position: 'absolute', top: 3,
                        left: enabled ? 25 : 3,
                        width: 20, height: 20, borderRadius: '50%',
                        background: '#fff', transition: 'left 0.2s', display: 'block',
                      }} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {masterSwitch && (
          <div style={{ fontSize: 12, color: '#fbbf24', background: '#451a03', borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
            ⚡ Auto-trading active on {enabledSymbols.length} symbol{enabledSymbols.length !== 1 ? 's' : ''}
          </div>
        )}

        {/* Enter trade button */}
        <button
          onClick={() => enabledSymbols.forEach(f => enterTrade(f.symbol))}
          disabled={enabledSymbols.length === 0}
          style={{
            width: '100%', padding: '11px 0', borderRadius: 10, border: 'none',
            background: enabledSymbols.length === 0 ? '#1f2937' : '#2563eb',
            color: enabledSymbols.length === 0 ? '#4b5563' : '#fff',
            fontWeight: 700, fontSize: 14, cursor: enabledSymbols.length === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          {enabledSymbols.length === 0
            ? 'No symbols selected'
            : enabledSymbols.map(f => `${symbolSide[f.symbol]} ${f.symbol}`).join(' · ')}
        </button>
      </div>
    </div>
  )
}
