import { useStore, calcFuturesPnl } from '../store'

function fmt(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  }) + ' ET'
}

function StatCard({ label, value, color }) {
  return (
    <div className="card">
      <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 6, color: color || '#f9fafb' }}>{value}</div>
    </div>
  )
}

export default function TradeLogs() {
  const { trades, closeTrade, livePrice } = useStore()
  const open = trades.filter(t => t.status === 'OPEN')
  const closed = trades.filter(t => t.status === 'CLOSED')
  const totalPnl = closed.reduce((s, t) => s + (t.pnl || 0), 0)
  const wins = closed.filter(t => t.pnl > 0).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Summary */}
      <div className="grid-4">
        <StatCard label="Total Trades" value={trades.length} />
        <StatCard label="Open Positions" value={open.length} color="#60a5fa" />
        <StatCard label="Win / Loss" value={`${wins} / ${closed.length - wins}`} color={wins >= closed.length - wins ? '#4ade80' : '#f87171'} />
        <StatCard label="Total P&L" value={`$${totalPnl.toFixed(2)}`} color={totalPnl >= 0 ? '#4ade80' : '#f87171'} />
      </div>

      {/* Open positions */}
      {open.length > 0 && (
        <section>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
            Open Positions
          </div>
          <div style={{ borderRadius: 12, border: '1px solid #1f2937', overflow: 'auto' }}>
            <table>
              <thead>
                <tr>
                  {['#', 'Symbol', 'Side', 'Entry', 'Current', 'Unrealized P&L', 'Amount', 'Stop Loss', 'Take Profit', 'Entered', 'Action'].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {open.map(t => {
                  const current = livePrice[t.symbol] || t.entryPrice
                  const unr = calcFuturesPnl(t.entryPrice, current, t.symbol, t.side)
                  return (
                    <tr key={t.id}>
                      <td style={{ color: '#4b5563' }}>{t.id}</td>
                      <td style={{ fontWeight: 700 }}>{t.symbol}</td>
                      <td><span className={`badge badge-${t.side.toLowerCase()}`}>{t.side}</span></td>
                      <td style={{ fontFamily: 'monospace' }}>{t.entryPrice.toFixed(2)}</td>
                      <td style={{ fontFamily: 'monospace', color: '#60a5fa' }}>{current.toFixed(2)}</td>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600, color: unr >= 0 ? '#4ade80' : '#f87171' }}>
                        {unr >= 0 ? '+' : ''}${unr.toFixed(2)}
                      </td>
                      <td>${t.amount.toFixed(2)}</td>
                      <td style={{ fontFamily: 'monospace', color: '#f87171' }}>{t.stopLoss ?? '—'}</td>
                      <td style={{ fontFamily: 'monospace', color: '#4ade80' }}>{t.takeProfit ?? '—'}</td>
                      <td style={{ color: '#4b5563', fontSize: 12, whiteSpace: 'nowrap' }}>{fmt(t.entryTime)}</td>
                      <td>
                        <button
                          className="btn btn-gray"
                          onClick={() => closeTrade(t.id)}
                          style={{ padding: '4px 12px', fontSize: 12 }}
                        >
                          Close
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Trade history */}
      <section>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
          Trade History
        </div>
        {closed.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#374151', border: '1px solid #1f2937', borderRadius: 12 }}>
            No closed trades yet
          </div>
        ) : (
          <div style={{ borderRadius: 12, border: '1px solid #1f2937', overflow: 'auto' }}>
            <table>
              <thead>
                <tr>
                  {['#', 'Symbol', 'Side', 'Entry', 'Exit', 'Amount', 'P&L', 'Stop Loss', 'Take Profit', 'Entered', 'Exited'].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {closed.map(t => (
                  <tr key={t.id}>
                    <td style={{ color: '#4b5563' }}>{t.id}</td>
                    <td style={{ fontWeight: 700 }}>{t.symbol}</td>
                    <td><span className={`badge badge-${t.side.toLowerCase()}`}>{t.side}</span></td>
                    <td style={{ fontFamily: 'monospace' }}>{t.entryPrice.toFixed(2)}</td>
                    <td style={{ fontFamily: 'monospace' }}>{t.exitPrice?.toFixed(2) ?? '—'}</td>
                    <td>${t.amount.toFixed(2)}</td>
                    <td style={{ fontFamily: 'monospace', fontWeight: 700, color: t.pnl >= 0 ? '#4ade80' : '#f87171' }}>
                      {t.pnl >= 0 ? '+' : ''}${t.pnl?.toFixed(2)}
                    </td>
                    <td style={{ fontFamily: 'monospace', color: '#f87171' }}>{t.stopLoss ?? '—'}</td>
                    <td style={{ fontFamily: 'monospace', color: '#4ade80' }}>{t.takeProfit ?? '—'}</td>
                    <td style={{ color: '#4b5563', fontSize: 12, whiteSpace: 'nowrap' }}>{fmt(t.entryTime)}</td>
                    <td style={{ color: '#4b5563', fontSize: 12, whiteSpace: 'nowrap' }}>{fmt(t.exitTime)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
