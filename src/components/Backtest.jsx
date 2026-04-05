import { useState } from 'react'
import { useStore, FUTURES } from '../store'

function fmt(ts) {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

// ── Results Display Component ────────────────────────────────────────────────
function ResultsDisplay({ results, error, loading }) {
  if (error) {
    return (
      <div style={{ background: '#450a0a', color: '#fca5a5', padding: '12px 16px', borderRadius: 10, fontSize: 13 }}>
        Error: {error}
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0', color: '#6b7280' }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>⏳</div>
        Fetching multi-timeframe data and running strategy…
      </div>
    )
  }

  if (!results) {
    return null
  }

  return (
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
                {['#', 'Time', 'Bias', 'Signal', 'Units', 'Entry', 'Stop', 'Target', 'Exit', 'R:R', 'P&L $', 'Result'].map(h => (
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
                  <td style={{ fontFamily: 'monospace' }}>{t.contracts || 1}</td>
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
  )
}

// ── Main Backtest component ───────────────────────────────────────────────────
export default function Backtest({ onBack }) {
  const [symbol, setSymbol]       = useState(FUTURES[0].symbol)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const [results, setResults]     = useState(null)

  const [longSymbol, setLongSymbol]       = useState(FUTURES[0].symbol)
  const [longLoading, setLongLoading]     = useState(false)
  const [longError, setLongError]         = useState(null)
  const [longResults, setLongResults]     = useState(null)

  async function runShortTest() {
    setLoading(true)
    setError(null)
    setResults(null)

    try {
      const res  = await fetch(`/api/backtest?symbol=${encodeURIComponent(symbol)}&side=short&_t=${Date.now()}`)
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

  async function runLongTest() {
    setLongLoading(true)
    setLongError(null)
    setLongResults(null)

    try {
      const res  = await fetch(`/api/backtest?symbol=${encodeURIComponent(longSymbol)}&side=long&_t=${Date.now()}`)
      const text = await res.text()
      let data
      try { data = JSON.parse(text) }
      catch { throw new Error(text.slice(0, 200)) }
      if (data.error) throw new Error(data.error)
      setLongResults(data)
    } catch (err) {
      setLongError(err.message)
    } finally {
      setLongLoading(false)
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

      {/* SHORT SECTION */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* SHORT Controls */}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 4, background: '#450a0a', color: '#f87171', letterSpacing: '0.5px' }}>SHORT</span>
              <span style={{ fontSize: 11, color: '#6b7280' }}>5M (60d) · 1M (7d) · RR ≥ 2:1 · ICT Kill Zones</span>
            </div>
            <button
              onClick={runShortTest}
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

        {/* SHORT Results */}
        <ResultsDisplay results={results} error={error} loading={loading} />
      </div>

      {/* LONG SECTION */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
        {/* LONG Controls */}
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Symbol</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {FUTURES.map(f => (
                <button key={f.symbol} onClick={() => setLongSymbol(f.symbol)} style={{
                  padding: '7px 14px', borderRadius: 8, border: '1px solid',
                  borderColor: longSymbol === f.symbol ? '#2563eb' : '#374151',
                  background:  longSymbol === f.symbol ? '#1d4ed8' : '#1f2937',
                  color: longSymbol === f.symbol ? '#fff' : '#9ca3af',
                  fontWeight: 700, fontSize: 12, cursor: 'pointer',
                }}>
                  {f.symbol}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginLeft: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 4, background: '#052e16', color: '#4ade80', letterSpacing: '0.5px' }}>LONG</span>
              <span style={{ fontSize: 11, color: '#6b7280' }}>5M (60d) · 1M (7d) · RR ≥ 2:1 · ICT Kill Zones</span>
            </div>
            <button
              onClick={runLongTest}
              disabled={longLoading}
              style={{
                padding: '10px 28px', borderRadius: 10, border: 'none',
                background: longLoading ? '#374151' : '#2563eb',
                color: '#fff', fontWeight: 700, fontSize: 14,
                cursor: longLoading ? 'not-allowed' : 'pointer',
              }}
            >
              {longLoading ? 'Running…' : 'Run Backtest'}
            </button>
          </div>
        </div>

        {/* LONG Results */}
        <ResultsDisplay results={longResults} error={longError} loading={longLoading} />
      </div>
    </div>
  )
}
