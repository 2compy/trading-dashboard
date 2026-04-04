import { useStore, calcFuturesPnl } from '../store'
import PnLList from './PnLList'

function StatCard({ label, value, color }) {
  return (
    <div className="card">
      <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 6, color: color || '#f9fafb' }}>{value}</div>
    </div>
  )
}

function PnlBar({ label, pnl, max }) {
  const pct = Math.min(100, Math.abs(pnl / max) * 100)
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: '#9ca3af' }}>{label}</span>
        <span style={{ color: pnl >= 0 ? '#4ade80' : '#f87171', fontFamily: 'monospace' }}>
          {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
        </span>
      </div>
      <div style={{ height: 4, background: '#1f2937', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: pnl >= 0 ? '#22c55e' : '#ef4444', borderRadius: 4 }} />
      </div>
    </div>
  )
}

export default function Portfolio() {
  const { futures, trades, livePrice, priceChange } = useStore()
  const open = trades.filter(t => t.status === 'OPEN')
  const closed = trades.filter(t => t.status === 'CLOSED')

  const totalInvested = open.reduce((s, t) => s + t.amount, 0)
  const totalPnl = closed.reduce((s, t) => s + (t.pnl || 0), 0)
  const unrealizedPnl = open.reduce((s, t) => {
    const current = livePrice[t.symbol] || t.entryPrice
    return s + calcFuturesPnl(t.entryPrice, current, t.symbol, t.side)
  }, 0)

  const wins = closed.filter(t => t.pnl > 0).length
  const winRate = closed.length > 0 ? ((wins / closed.length) * 100).toFixed(1) : '0.0'
  const avgWin = wins > 0 ? closed.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0) / wins : 0
  const avgLoss = (closed.length - wins) > 0
    ? closed.filter(t => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0) / (closed.length - wins)
    : 0

  const bySymbol = futures.map(f => {
    const symOpen = open.filter(t => t.symbol === f.symbol)
    const symClosed = closed.filter(t => t.symbol === f.symbol)
    const symUnr = symOpen.reduce((s, t) => {
      const current = livePrice[t.symbol] || t.entryPrice
      return s + calcFuturesPnl(t.entryPrice, current, t.symbol, t.side)
    }, 0)
    const symReal = symClosed.reduce((s, t) => s + (t.pnl || 0), 0)
    return { ...f, symOpen, symClosed, symUnr, symReal }
  })

  const maxPnl = Math.max(...closed.map(t => Math.abs(t.pnl || 0)), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Top stats */}
      <div className="grid-4">
        <StatCard label="Open Positions" value={open.length} color="#60a5fa" />
        <StatCard label="Capital Deployed" value={`$${totalInvested.toFixed(2)}`} />
        <StatCard label="Unrealized P&L" value={`$${unrealizedPnl.toFixed(2)}`} color={unrealizedPnl >= 0 ? '#4ade80' : '#f87171'} />
        <StatCard label="Realized P&L" value={`$${totalPnl.toFixed(2)}`} color={totalPnl >= 0 ? '#4ade80' : '#f87171'} />
      </div>

      <div className="grid-2">
        {/* Performance */}
        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: 14 }}>Performance</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'Win Rate', value: `${winRate}%`, color: parseFloat(winRate) >= 50 ? '#4ade80' : '#f87171' },
              { label: 'Avg Win', value: `$${avgWin.toFixed(2)}`, color: '#4ade80' },
              { label: 'Avg Loss', value: `$${avgLoss.toFixed(2)}`, color: '#f87171' },
            ].map(s => (
              <div key={s.label} style={{ background: '#1f2937', borderRadius: 8, padding: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#6b7280' }}>{s.label}</div>
                <div style={{ fontWeight: 700, fontSize: 16, marginTop: 4, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>
          {closed.length > 0 && closed.slice(0, 6).map(t => (
            <PnlBar key={t.id} label={`#${t.id} ${t.symbol} ${t.side}`} pnl={t.pnl} max={maxPnl} />
          ))}
          {closed.length === 0 && (
            <div style={{ textAlign: 'center', color: '#374151', padding: '20px 0', fontSize: 13 }}>No closed trades yet</div>
          )}
        </div>

        {/* Market overview */}
        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: 14 }}>Market Overview</div>
          {futures.map(f => {
            const change = priceChange[f.symbol]
            const isUp = change >= 0
            return (
              <div key={f.symbol} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 0', borderBottom: '1px solid #1f2937',
              }}>
                <div>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{f.symbol}</span>
                  <span style={{ color: '#6b7280', fontSize: 11, marginLeft: 8 }}>{f.name}</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 14 }}>{livePrice[f.symbol]?.toFixed(2)}</span>
                  <span style={{ fontSize: 12, marginLeft: 8, color: isUp ? '#4ade80' : '#f87171' }}>
                    {isUp ? '+' : ''}{change.toFixed(2)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Symbol breakdown */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>
          Symbol Breakdown
        </div>
        <div className="grid-3">
          {bySymbol.map(f => (
            <div key={f.symbol} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontWeight: 700 }}>{f.symbol}</span>
                <span style={{ fontSize: 11, color: '#6b7280' }}>{f.symOpen.length} open · {f.symClosed.length} closed</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                <span style={{ color: '#6b7280' }}>Unrealized</span>
                <span style={{ fontFamily: 'monospace', color: f.symUnr >= 0 ? '#4ade80' : '#f87171' }}>
                  {f.symUnr >= 0 ? '+' : ''}${f.symUnr.toFixed(2)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: '#6b7280' }}>Realized</span>
                <span style={{ fontFamily: 'monospace', color: f.symReal >= 0 ? '#4ade80' : '#f87171' }}>
                  {f.symReal >= 0 ? '+' : ''}${f.symReal.toFixed(2)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* P&L List */}
      <PnLList />
    </div>
  )
}
