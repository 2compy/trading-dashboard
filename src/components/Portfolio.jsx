import { useState } from 'react'
import { useStore } from '../store'
import { calcFuturesPnl, CONTRACT_MULTIPLIER } from '../utils/strategy'

function StatCard({ label, value, color }) {
  return (
    <div className="card">
      <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 6, color: color || '#f9fafb' }}>{value}</div>
    </div>
  )
}

function Section({ title, color, trades, livePrice, futures }) {
  const open = trades.filter(t => t.status === 'OPEN')
  const closed = trades.filter(t => t.status === 'CLOSED')
  const totalPnl = closed.reduce((s, t) => s + (t.pnl || 0), 0)
  const unrealizedPnl = open.reduce((s, t) => {
    const current = livePrice[t.symbol] || t.entryPrice
    const mult = CONTRACT_MULTIPLIER[t.symbol] || 5
    const dir = t.side === 'LONG' ? 1 : -1
    return s + (current - t.entryPrice) * mult * dir * (t.units || 1)
  }, 0)
  const wins = closed.filter(t => (t.pnl || 0) > 0).length
  const losses = closed.length - wins
  const winRate = closed.length > 0 ? ((wins / closed.length) * 100).toFixed(1) : '0.0'
  const avgWin = wins > 0 ? closed.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0) / wins : 0
  const avgLoss = losses > 0 ? closed.filter(t => (t.pnl || 0) <= 0).reduce((s, t) => s + (t.pnl || 0), 0) / losses : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontWeight: 800, fontSize: 16, color, borderBottom: `2px solid ${color}`, paddingBottom: 6 }}>{title}</div>

      <div className="grid-4">
        <StatCard label="Open" value={open.length} color="#60a5fa" />
        <StatCard label="Unrealized" value={`$${unrealizedPnl.toFixed(2)}`} color={unrealizedPnl >= 0 ? '#4ade80' : '#f87171'} />
        <StatCard label="Realized" value={`$${totalPnl.toFixed(2)}`} color={totalPnl >= 0 ? '#4ade80' : '#f87171'} />
        <StatCard label="Win Rate" value={`${winRate}%`} color={parseFloat(winRate) >= 50 ? '#4ade80' : '#f87171'} />
      </div>

      <div className="grid-2">
        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: 10 }}>Performance</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
            {[
              { label: 'Wins', value: wins, color: '#4ade80' },
              { label: 'Losses', value: losses, color: '#f87171' },
              { label: 'Avg Win', value: `$${avgWin.toFixed(2)}`, color: '#4ade80' },
            ].map(s => (
              <div key={s.label} style={{ background: '#1f2937', borderRadius: 8, padding: 8, textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#6b7280' }}>{s.label}</div>
                <div style={{ fontWeight: 700, fontSize: 15, marginTop: 2, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: 10 }}>By Symbol</div>
          {futures.map(f => {
            const symClosed = closed.filter(t => t.symbol === f.symbol)
            const symWins = symClosed.filter(t => (t.pnl || 0) > 0).length
            const symPnl = symClosed.reduce((s, t) => s + (t.pnl || 0), 0)
            const symWR = symClosed.length > 0 ? ((symWins / symClosed.length) * 100).toFixed(0) : null
            return (
              <div key={f.symbol} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #1f2937' }}>
                <div>
                  <span style={{ fontWeight: 700, fontSize: 12 }}>{f.symbol}</span>
                  <span style={{ fontSize: 10, color: '#6b7280', marginLeft: 6 }}>{symClosed.length} trades</span>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  {symWR && <span style={{ fontSize: 11, fontWeight: 700, color: parseInt(symWR) >= 50 ? '#4ade80' : '#f87171' }}>{symWR}%</span>}
                  <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'monospace', color: symPnl >= 0 ? '#4ade80' : '#f87171' }}>
                    {symPnl >= 0 ? '+' : ''}${symPnl.toFixed(2)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Recent closed trades */}
      {closed.length > 0 && (
        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Recent Trades</div>
          {closed.slice(-8).reverse().map(t => (
            <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #111827', fontSize: 12 }}>
              <div>
                <span style={{ fontWeight: 700 }}>{t.symbol}</span>
                <span style={{ color: '#6b7280', marginLeft: 6 }}>{t.side} {t.units || 1}u</span>
                {t.signal && <span style={{ fontSize: 9, color: '#fbbf24', marginLeft: 6 }}>{t.signal}</span>}
              </div>
              <span style={{ fontFamily: 'monospace', fontWeight: 700, color: (t.pnl || 0) >= 0 ? '#4ade80' : '#f87171' }}>
                {(t.pnl || 0) >= 0 ? '+' : ''}${(t.pnl || 0).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Portfolio() {
  const { futures, trades, paperTrades, livePrice, priceChange } = useStore()
  const [view, setView] = useState('live')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Toggle */}
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

      {/* Market overview */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {futures.map(f => {
          const change = priceChange[f.symbol]
          const isUp = change >= 0
          return (
            <div key={f.symbol} style={{ flex: 1, minWidth: 140, background: '#0f172a', borderRadius: 8, padding: '8px 12px', border: '1px solid #1f2937' }}>
              <div style={{ fontWeight: 700, fontSize: 12 }}>{f.symbol}</div>
              <div style={{ fontFamily: 'monospace', fontSize: 14, marginTop: 2 }}>{livePrice[f.symbol]?.toFixed(2)}</div>
              <div style={{ fontSize: 11, color: isUp ? '#4ade80' : '#f87171' }}>{isUp ? '+' : ''}{change?.toFixed(2)}</div>
            </div>
          )
        })}
      </div>

      {view === 'live' && <Section title="Live Portfolio" color="#4ade80" trades={trades} livePrice={livePrice} futures={futures} />}
      {view === 'paper' && <Section title="Paper Portfolio" color="#fbbf24" trades={paperTrades || []} livePrice={livePrice} futures={futures} />}
    </div>
  )
}
