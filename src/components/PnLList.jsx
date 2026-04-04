import { useStore, calcFuturesPnl } from '../store'

export default function PnLList() {
  const { trades, livePrice, closeTrade } = useStore()

  const open   = trades.filter(t => t.status === 'OPEN')
  const closed  = trades.filter(t => t.status === 'CLOSED')
  const totalRealized   = closed.reduce((s, t) => s + (t.pnl || 0), 0)
  const totalUnrealized = open.reduce((s, t) => {
    const current = livePrice[t.symbol] || t.entryPrice
    return s + calcFuturesPnl(t.entryPrice, current, t.symbol, t.side)
  }, 0)

  const allEntries = trades.map(t => {
    if (t.status === 'OPEN') {
      const current = livePrice[t.symbol] || t.entryPrice
      const unr = calcFuturesPnl(t.entryPrice, current, t.symbol, t.side)
      return { ...t, displayPnl: unr, isOpen: true }
    }
    return { ...t, displayPnl: t.pnl, isOpen: false }
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Summary totals */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {[
          { label: 'Unrealized P&L', value: totalUnrealized, color: totalUnrealized >= 0 ? '#4ade80' : '#f87171' },
          { label: 'Realized P&L',   value: totalRealized,   color: totalRealized   >= 0 ? '#4ade80' : '#f87171' },
          { label: 'Total P&L',      value: totalRealized + totalUnrealized, color: (totalRealized + totalUnrealized) >= 0 ? '#4ade80' : '#f87171' },
        ].map(s => (
          <div key={s.label} className="card" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6, color: s.color, fontFamily: 'monospace' }}>
              {s.value >= 0 ? '+' : ''}${s.value.toFixed(2)}
            </div>
          </div>
        ))}
      </div>

      {/* P&L entries list */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #1f2937', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 600 }}>All Trades — P&L</span>
          <span style={{ fontSize: 12, color: '#6b7280' }}>{trades.length} total</span>
        </div>

        {allEntries.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#374151', fontSize: 13 }}>
            No trades yet — enter a trade to see P&L here
          </div>
        )}

        <div style={{ maxHeight: 520, overflowY: 'auto' }}>
          {allEntries.map(t => {
            const pnl = t.displayPnl
            const isPos = pnl >= 0
            return (
              <div key={t.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 16px', borderBottom: '1px solid #111827',
                background: t.isOpen ? '#0a0f1a' : 'transparent',
              }}>
                {/* Left: trade info */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', fontWeight: 700, fontSize: 11,
                    background: isPos ? '#14532d' : '#450a0a',
                    color: isPos ? '#4ade80' : '#f87171',
                  }}>
                    {isPos ? '▲' : '▼'}
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 700 }}>#{t.id} {t.symbol}</span>
                      <span className={`badge badge-${t.side.toLowerCase()}`}>{t.side}</span>
                      {t.auto && <span style={{ fontSize: 10, color: '#fbbf24', background: '#451a03', padding: '1px 6px', borderRadius: 4 }}>AUTO</span>}
                      {t.isOpen && <span style={{ fontSize: 10, color: '#60a5fa', background: '#1e3a5f', padding: '1px 6px', borderRadius: 4 }}>OPEN</span>}
                    </div>
                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                      Entry: <span style={{ fontFamily: 'monospace', color: '#9ca3af' }}>{t.entryPrice.toFixed(2)}</span>
                      {!t.isOpen && t.exitPrice && (
                        <> → Exit: <span style={{ fontFamily: 'monospace', color: '#9ca3af' }}>{t.exitPrice.toFixed(2)}</span></>
                      )}
                      {t.isOpen && (
                        <> · Live: <span style={{ fontFamily: 'monospace', color: '#60a5fa' }}>{(livePrice[t.symbol] || t.entryPrice).toFixed(2)}</span></>
                      )}
                      {' · '}${t.amount.toFixed(0)}
                    </div>
                  </div>
                </div>

                {/* Right: P&L + close button */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{
                      fontSize: 15, fontWeight: 700, fontFamily: 'monospace',
                      color: isPos ? '#4ade80' : '#f87171',
                    }}>
                      {isPos ? '+' : ''}${pnl.toFixed(2)}
                    </div>
                    <div style={{ fontSize: 10, color: '#4b5563', marginTop: 1 }}>
                      {t.isOpen ? 'unrealized' : 'realized'}
                    </div>
                  </div>
                  {t.isOpen && (
                    <button
                      onClick={() => closeTrade(t.id)}
                      className="btn btn-gray"
                      style={{ padding: '4px 12px', fontSize: 12 }}
                    >
                      Close
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
