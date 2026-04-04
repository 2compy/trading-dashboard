import { useStore } from '../store'

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
  const { futures, livePrice, tradeSettings, updateTradeSetting, enterTrade, trades } = useStore()
  const openTrades = trades.filter(t => t.status === 'OPEN')

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
      {futures.map(f => {
        const s = tradeSettings[f.symbol]
        const price = livePrice[f.symbol]
        const open = openTrades.filter(t => t.symbol === f.symbol)
        const isLong = s.side === 'LONG'

        const riskAmt = s.stopLoss && s.amount
          ? Math.abs(((price - parseFloat(s.stopLoss)) / price) * parseFloat(s.amount)).toFixed(2)
          : null
        const rewardAmt = s.takeProfit && s.amount
          ? Math.abs(((parseFloat(s.takeProfit) - price) / price) * parseFloat(s.amount)).toFixed(2)
          : null

        return (
          <div key={f.symbol} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Title row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 17 }}>{f.symbol}</div>
                <div style={{ color: '#6b7280', fontSize: 11, marginTop: 2 }}>{f.name}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'monospace', color: '#60a5fa', fontSize: 13 }}>${price?.toFixed(2)}</div>
                <div style={{ color: '#6b7280', fontSize: 11, marginTop: 2 }}>{open.length} open</div>
              </div>
            </div>

            {/* Side toggle */}
            <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid #374151' }}>
              {['LONG', 'SHORT'].map(side => (
                <button
                  key={side}
                  onClick={() => updateTradeSetting(f.symbol, 'side', side)}
                  style={{
                    flex: 1, padding: '7px 0', fontSize: 12, fontWeight: 700, border: 'none',
                    background: s.side === side
                      ? (side === 'LONG' ? '#16a34a' : '#dc2626')
                      : '#1f2937',
                    color: s.side === side ? '#fff' : '#6b7280',
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                >
                  {side}
                </button>
              ))}
            </div>

            <Field label="Amount ($)" value={s.amount} onChange={v => updateTradeSetting(f.symbol, 'amount', v)} placeholder="1000" />
            <Field
              label="Stop Loss"
              value={s.stopLoss}
              onChange={v => updateTradeSetting(f.symbol, 'stopLoss', v)}
              placeholder={`e.g. ${(price * 0.99).toFixed(2)}`}
            />
            <Field
              label="Take Profit"
              value={s.takeProfit}
              onChange={v => updateTradeSetting(f.symbol, 'takeProfit', v)}
              placeholder={`e.g. ${(price * 1.02).toFixed(2)}`}
            />

            {/* Risk/Reward preview */}
            {(riskAmt || rewardAmt) && (
              <div style={{ background: '#1f2937', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#9ca3af' }}>
                {riskAmt && <span><span style={{ color: '#f87171' }}>Risk: </span>${riskAmt}</span>}
                {riskAmt && rewardAmt && ' · '}
                {rewardAmt && <span><span style={{ color: '#4ade80' }}>Reward: </span>${rewardAmt}</span>}
                {riskAmt && rewardAmt && (
                  <span style={{ color: '#6b7280' }}> · R/R {(parseFloat(rewardAmt) / parseFloat(riskAmt)).toFixed(2)}</span>
                )}
              </div>
            )}

            <button
              onClick={() => enterTrade(f.symbol)}
              style={{
                width: '100%', padding: '9px 0', borderRadius: 8, border: 'none',
                background: isLong ? '#16a34a' : '#dc2626',
                color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => e.target.style.opacity = '0.85'}
              onMouseLeave={e => e.target.style.opacity = '1'}
            >
              Enter {s.side}
            </button>
          </div>
        )
      })}
    </div>
  )
}
