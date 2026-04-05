import { useState } from 'react'
import { useStore } from '../store'
import { calcFuturesPnl, CONTRACT_MULTIPLIER } from '../utils/strategy'

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

function LogsView({ trades, closeFn, livePrice, isPaper }) {
  const open = trades.filter(t => t.status === 'OPEN')
  const closed = trades.filter(t => t.status === 'CLOSED')
  const totalPnl = closed.reduce((s, t) => s + (t.pnl || 0), 0)
  const wins = closed.filter(t => (t.pnl || 0) > 0).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="grid-4">
        <StatCard label="Total Trades" value={trades.length} />
        <StatCard label="Open Positions" value={open.length} color="#60a5fa" />
        <StatCard label="Win / Loss" value={`${wins} / ${closed.length - wins}`} color={wins >= closed.length - wins ? '#4ade80' : '#f87171'} />
        <StatCard label="Total P&L" value={`$${totalPnl.toFixed(2)}`} color={totalPnl >= 0 ? '#4ade80' : '#f87171'} />
      </div>

      {open.length > 0 && (
        <section>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
            Open Positions
          </div>
          <div style={{ borderRadius: 12, border: '1px solid #1f2937', overflow: 'auto' }}>
            <table>
              <thead>
                <tr>
                  {['#', 'Symbol', 'Side', 'Units', 'Entry', 'Current', 'Unrealized P&L', 'Signal', 'Entered', 'Action'].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {open.map(t => {
                  const current = livePrice[t.symbol] || t.entryPrice
                  const mult = CONTRACT_MULTIPLIER[t.symbol] || 5
                  const dir = t.side === 'LONG' ? 1 : -1
                  const unr = (current - t.entryPrice) * mult * dir * (t.units || 1)
                  return (
                    <tr key={t.id}>
                      <td style={{ color: '#4b5563' }}>{t.id}</td>
                      <td style={{ fontWeight: 700 }}>{t.symbol}</td>
                      <td><span className={`badge badge-${t.side.toLowerCase()}`}>{t.side}</span></td>
                      <td style={{ fontFamily: 'monospace' }}>{t.units || 1}</td>
                      <td style={{ fontFamily: 'monospace' }}>{t.entryPrice?.toFixed(2)}</td>
                      <td style={{ fontFamily: 'monospace', color: '#60a5fa' }}>{current.toFixed(2)}</td>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600, color: unr >= 0 ? '#4ade80' : '#f87171' }}>
                        {unr >= 0 ? '+' : ''}${unr.toFixed(2)}
                      </td>
                      <td style={{ fontSize: 10, color: '#fbbf24' }}>{t.signal || '—'}</td>
                      <td style={{ color: '#4b5563', fontSize: 12, whiteSpace: 'nowrap' }}>{fmt(t.entryTime)}</td>
                      <td>
                        <button className="btn btn-gray" onClick={() => closeFn(t.id)} style={{ padding: '4px 12px', fontSize: 12 }}>
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
                  {['#', 'Symbol', 'Side', 'Units', 'Entry', 'Exit', 'P&L', 'Signal', 'Entered', 'Exited'].map(h => (
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
                    <td style={{ fontFamily: 'monospace' }}>{t.units || 1}</td>
                    <td style={{ fontFamily: 'monospace' }}>{t.entryPrice?.toFixed(2)}</td>
                    <td style={{ fontFamily: 'monospace' }}>{t.exitPrice?.toFixed(2) ?? '—'}</td>
                    <td style={{ fontFamily: 'monospace', fontWeight: 700, color: (t.pnl || 0) >= 0 ? '#4ade80' : '#f87171' }}>
                      {(t.pnl || 0) >= 0 ? '+' : ''}${(t.pnl || 0).toFixed(2)}
                    </td>
                    <td style={{ fontSize: 10, color: '#fbbf24' }}>{t.signal || '—'}</td>
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

export default function TradeLogs() {
  const { trades, paperTrades, closeTrade, closePaperTrade, livePrice } = useStore()
  const [view, setView] = useState('live')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 4, background: '#111827', borderRadius: 10, padding: 4, alignSelf: 'flex-start' }}>
        {[
          { id: 'live', label: 'Live', color: '#4ade80' },
          { id: 'paper', label: 'Paper', color: '#fbbf24' },
        ].map(t => (
          <button key={t.id} onClick={() => setView(t.id)} style={{
            padding: '8px 24px', borderRadius: 8, border: 'none',
            background: view === t.id ? (t.id === 'live' ? '#14532d' : '#451a03') : 'transparent',
            color: view === t.id ? t.color : '#6b7280',
            fontWeight: 700, fontSize: 13, cursor: 'pointer', transition: 'all 0.15s',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {view === 'live' && <LogsView trades={trades} closeFn={closeTrade} livePrice={livePrice} isPaper={false} />}
      {view === 'paper' && <LogsView trades={paperTrades || []} closeFn={closePaperTrade} livePrice={livePrice} isPaper={true} />}
    </div>
  )
}
