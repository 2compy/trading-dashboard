import { useState, useMemo } from 'react'
import { useStore, FUTURES } from '../store'

function fmt(ts) {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

// ── Equity Curve SVG ──────────────────────────────────────────────────────────
function EquityCurve({ trades }) {
  const sorted = useMemo(() => {
    return [...trades]
      .filter(t => t.exitTime)
      .sort((a, b) => a.exitTime - b.exitTime)
  }, [trades])

  if (sorted.length < 2) {
    return (
      <div className="card" style={{ textAlign: 'center', color: '#4b5563', padding: '24px 0', fontSize: 13 }}>
        Need at least 2 trades to display equity curve
      </div>
    )
  }

  let running = 0
  const data = sorted.map(t => {
    running += t.pnlDollars
    return { t: t.exitTime, pnl: running, win: t.outcome === 'win' }
  })

  const W = 800, H = 140
  const pnls   = data.map(d => d.pnl)
  const minPnl = Math.min(0, ...pnls)
  const maxPnl = Math.max(0, ...pnls)
  const pnlRange = maxPnl - minPnl || 1
  const tMin = data[0].t
  const tMax = data[data.length - 1].t
  const tRange = tMax - tMin || 1

  const xOf = (t)   => ((t - tMin) / tRange * W)
  const yOf = (pnl) => H - ((pnl - minPnl) / pnlRange * H)

  const linePath  = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xOf(d.t).toFixed(1)},${yOf(d.pnl).toFixed(1)}`).join(' ')
  const zeroY     = yOf(0)
  const finalPnl  = data[data.length - 1].pnl
  const isPositive = finalPnl >= 0
  const lineColor  = isPositive ? '#22c55e' : '#ef4444'

  // Drawdown shading: find peak and shade below it
  let peak = 0
  const ddPath = data.map((d, i) => {
    if (d.pnl > peak) peak = d.pnl
    const ddY = yOf(peak)
    return `${i === 0 ? 'M' : 'L'}${xOf(d.t).toFixed(1)},${ddY.toFixed(1)}`
  }).join(' ') + ' ' + data.slice().reverse().map((d, i) => `${i === 0 ? 'L' : 'L'}${xOf(d.t).toFixed(1)},${yOf(d.pnl).toFixed(1)}`).join(' ') + ' Z'

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontWeight: 600 }}>Equity Curve</span>
        <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
          <span style={{ color: '#6b7280' }}>{data.length} trades plotted</span>
          <span style={{ fontFamily: 'monospace', fontWeight: 700, color: lineColor }}>
            Final: {isPositive ? '+' : ''}${finalPnl.toLocaleString()}
          </span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 140, display: 'block' }}
        preserveAspectRatio="none"
      >
        {/* Drawdown shading */}
        <path d={ddPath} fill="#ef4444" opacity={0.07} />

        {/* Area fill under/over zero */}
        <path
          d={`${linePath} L${xOf(tMax).toFixed(1)},${zeroY.toFixed(1)} L${xOf(tMin).toFixed(1)},${zeroY.toFixed(1)} Z`}
          fill={lineColor}
          opacity={0.12}
        />

        {/* Zero baseline */}
        <line
          x1={0} y1={zeroY.toFixed(1)}
          x2={W} y2={zeroY.toFixed(1)}
          stroke="#374151" strokeWidth={1} strokeDasharray="4 2"
        />

        {/* Equity line */}
        <path d={linePath} fill="none" stroke={lineColor} strokeWidth={2} />

        {/* Trade dots — colored by outcome */}
        {data.map((d, i) => (
          <circle
            key={i}
            cx={xOf(d.t).toFixed(1)}
            cy={yOf(d.pnl).toFixed(1)}
            r={3}
            fill={d.win ? '#22c55e' : '#ef4444'}
            opacity={0.85}
          />
        ))}
      </svg>

      {/* X-axis labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#4b5563', marginTop: 4 }}>
        <span>{fmt(data[0].t)}</span>
        {data.length > 2 && <span>{fmt(data[Math.floor(data.length / 2)].t)}</span>}
        <span>{fmt(data[data.length - 1].t)}</span>
      </div>
    </div>
  )
}

// ── Extended stats computation ────────────────────────────────────────────────
function computeExtendedStats(trades) {
  if (!trades.length) return null

  const wins   = trades.filter(t => t.outcome === 'win')
  const losses = trades.filter(t => t.outcome === 'loss')

  const grossWin  = wins.reduce((s, t) => s + t.pnlDollars, 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlDollars, 0))
  const profitFactor = grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : '∞'

  // Max drawdown
  let peak = 0, running = 0, maxDD = 0, ddStart = null, ddEnd = null, tempStart = null
  const sorted = [...trades].sort((a, b) => (a.time || 0) - (b.time || 0))
  for (const t of sorted) {
    running += t.pnlDollars
    if (running > peak) { peak = running; tempStart = t.time }
    const dd = peak - running
    if (dd > maxDD) { maxDD = dd; ddStart = tempStart; ddEnd = t.time }
  }

  // Streaks
  let curStreak = 1, maxWinStreak = 0, maxLossStreak = 0, lastOutcome = null
  for (const t of sorted) {
    if (t.outcome === lastOutcome) curStreak++
    else curStreak = 1
    lastOutcome = t.outcome
    if (t.outcome === 'win'  && curStreak > maxWinStreak)  maxWinStreak  = curStreak
    if (t.outcome === 'loss' && curStreak > maxLossStreak) maxLossStreak = curStreak
  }

  const avgRR   = (trades.reduce((s, t) => s + (t.rr || 0), 0) / trades.length).toFixed(2)
  const best    = Math.max(...trades.map(t => t.pnlDollars))
  const worst   = Math.min(...trades.map(t => t.pnlDollars))
  const avgWin  = wins.length  ? (grossWin  / wins.length).toFixed(2)  : '0'
  const avgLoss = losses.length ? (grossLoss / losses.length).toFixed(2) : '0'

  return { profitFactor, maxDD, maxWinStreak, maxLossStreak, avgRR, best, worst, avgWin, avgLoss }
}

// ── Stat grid cards ───────────────────────────────────────────────────────────
function MiniStat({ label, value, color, mono }) {
  return (
    <div style={{ background: '#111827', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{
        fontSize: 16, fontWeight: 700, color: color || '#f9fafb',
        fontFamily: mono ? 'monospace' : 'inherit',
      }}>
        {value}
      </div>
    </div>
  )
}

// ── Main Backtest component ───────────────────────────────────────────────────
export default function Backtest({ onBack }) {
  const [symbol, setSymbol]   = useState(FUTURES[0].symbol)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [results, setResults] = useState(null)

  const ext = useMemo(() => results ? computeExtendedStats(results.trades) : null, [results])

  async function runTest() {
    setLoading(true)
    setError(null)
    setResults(null)

    try {
      const res  = await fetch(`/api/backtest?symbol=${encodeURIComponent(symbol)}`)
      const text = await res.text()
      let data
      try { data = JSON.parse(text) }
      catch { throw new Error(text.slice(0, 200)) }
      if (data.error) throw new Error(data.error)
      setResults(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Back button */}
      <div>
        <button
          onClick={onBack}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'none', border: '1px solid #374151',
            color: '#9ca3af', borderRadius: 8, padding: '6px 14px',
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#6b7280'; e.currentTarget.style.color = '#f9fafb' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#374151'; e.currentTarget.style.color = '#9ca3af' }}
        >
          ← Back to Live
        </button>
      </div>

      {/* Controls */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Symbol</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {FUTURES.map(f => (
              <button key={f.symbol} onClick={() => setSymbol(f.symbol)} style={{
                padding: '7px 14px', borderRadius: 8, border: '1px solid',
                borderColor: symbol === f.symbol ? '#2563eb' : '#374151',
                background:  symbol === f.symbol ? '#1d4ed8' : '#1f2937',
                color: symbol === f.symbol ? '#fff' : '#9ca3af',
                fontWeight: 700, fontSize: 12, cursor: 'pointer',
              }}>
                {f.symbol}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginLeft: 'auto' }}>
          <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>
            Data: 5M (60d) · 1M (7d) · RR ≥ 2:1 · ICT Kill Zones
          </div>
          <button
            onClick={runTest}
            disabled={loading}
            style={{
              padding: '10px 28px', borderRadius: 10, border: 'none',
              background: loading ? '#374151' : '#2563eb',
              color: '#fff', fontWeight: 700, fontSize: 14,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Running…' : 'Run Backtest'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: '#450a0a', color: '#fca5a5', padding: '12px 16px', borderRadius: 10, fontSize: 13 }}>
          Error: {error}
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#6b7280' }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>⏳</div>
          Fetching multi-timeframe data and running strategy…
        </div>
      )}

      {results && (
        <>
          {/* Primary summary stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
            {[
              { label: 'Win Rate',     value: `${results.winRate}%`,  color: parseFloat(results.winRate) >= 50 ? '#4ade80' : '#f87171', big: true },
              { label: 'Total Trades', value: results.trades.length,  color: '#f9fafb' },
              { label: 'Wins',         value: results.wins,           color: '#4ade80' },
              { label: 'Losses',       value: results.losses,         color: '#f87171' },
              { label: 'Net P&L',      value: `${results.totalPnl >= 0 ? '+' : ''}$${results.totalPnl.toLocaleString()}`, color: results.totalPnl >= 0 ? '#4ade80' : '#f87171', big: true },
            ].map(s => (
              <div key={s.label} className="card" style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{s.label}</div>
                <div style={{ fontSize: s.big ? 28 : 20, fontWeight: 700, marginTop: 6, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Equity curve */}
          <EquityCurve trades={results.trades} />

          {/* Extended stats */}
          {ext && (
            <div>
              <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600, marginBottom: 10 }}>
                Extended Analytics
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
                <MiniStat label="Profit Factor" value={ext.profitFactor} color={parseFloat(ext.profitFactor) >= 1.5 ? '#4ade80' : '#f87171'} />
                <MiniStat label="Max Drawdown"  value={`-$${ext.maxDD.toFixed(0)}`} color="#f87171" mono />
                <MiniStat label="Avg R:R"       value={`${ext.avgRR}:1`} color="#60a5fa" />
                <MiniStat label="Avg Win"       value={`+$${ext.avgWin}`} color="#4ade80" mono />
                <MiniStat label="Avg Loss"      value={`-$${ext.avgLoss}`} color="#f87171" mono />
                <MiniStat label="Best Trade"    value={`+$${ext.best.toFixed(0)}`} color="#4ade80" mono />
                <MiniStat label="Worst Trade"   value={`-$${Math.abs(ext.worst).toFixed(0)}`} color="#f87171" mono />
                <MiniStat label="Win Streak"    value={`${ext.maxWinStreak}W`} color="#4ade80" />
                <MiniStat label="Loss Streak"   value={`${ext.maxLossStreak}L`} color="#f87171" />
              </div>
            </div>
          )}

          {/* Data note */}
          {results.dataNote && (
            <div style={{ fontSize: 11, color: '#374151', textAlign: 'center' }}>{results.dataNote}</div>
          )}

          {/* Trades table */}
          {results.trades.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#4b5563', border: '1px solid #1f2937', borderRadius: 12 }}>
              No trade setups found in the data range. Try a different symbol or check back when market has more data.
            </div>
          ) : (
            <div style={{ borderRadius: 12, border: '1px solid #1f2937', overflow: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    {['#', 'Time', 'Bias', 'Signal', 'Entry', 'Stop', 'Target', 'Exit', 'R:R', 'P&L $', 'Result'].map(h => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.trades.map(t => (
                    <tr key={t.id}>
                      <td style={{ color: '#4b5563' }}>{t.id}</td>
                      <td style={{ fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap' }}>{fmt(t.time)}</td>
                      <td>
                        <span className={`badge badge-${t.bias === 'bullish' ? 'long' : 'short'}`}>
                          {t.bias === 'bullish' ? 'LONG' : 'SHORT'}
                        </span>
                      </td>
                      <td>
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                          background: t.signal?.includes('IFVG') ? '#1e3a5f' : '#1f2937',
                          color: t.signal?.includes('IFVG') ? '#93c5fd' : '#9ca3af',
                        }}>
                          {t.signal}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'monospace' }}>{t.entryPrice}</td>
                      <td style={{ fontFamily: 'monospace', color: '#f87171' }}>{t.stopPrice}</td>
                      <td style={{ fontFamily: 'monospace', color: '#4ade80' }}>{t.targetPrice}</td>
                      <td style={{ fontFamily: 'monospace' }}>{t.exitPrice}</td>
                      <td style={{ fontFamily: 'monospace', color: '#60a5fa' }}>{t.rr}</td>
                      <td style={{ fontFamily: 'monospace', fontWeight: 700, color: t.pnlDollars >= 0 ? '#4ade80' : '#f87171' }}>
                        {t.pnlDollars >= 0 ? '+' : ''}${t.pnlDollars}
                      </td>
                      <td>
                        <span style={{
                          padding: '2px 10px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                          background: t.outcome === 'win' ? '#14532d' : '#450a0a',
                          color: t.outcome === 'win' ? '#4ade80' : '#f87171',
                        }}>
                          {t.outcome === 'win' ? 'WIN' : 'LOSS'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
