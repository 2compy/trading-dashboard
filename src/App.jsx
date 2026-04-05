import { useState, useEffect } from 'react'
import { useStore, FUTURES } from './store'
import LiveChart from './components/LiveChart'
import LiveTrading from './components/LiveTrading'
import PaperTrading from './components/PaperTrading'
import TradeLogs from './components/TradeLogs'
import Portfolio from './components/Portfolio'
import Backtest from './components/Backtest'
import Strategy from './components/Strategy'
import ErrorBoundary from './components/ErrorBoundary'

const TABS = [
  { id: 'charts',    label: 'Live Charts',    icon: '📈' },
  { id: 'live',      label: 'Live',           icon: '⚡' },
  { id: 'paper',     label: 'Paper',          icon: '📝' },
  { id: 'logs',      label: 'Trade Logs',     icon: '📋' },
  { id: 'portfolio', label: 'Portfolio',      icon: '💼' },
  { id: 'backtest',  label: 'Backtest',       icon: '🔬' },
  { id: 'strategy',  label: 'Strategy',       icon: '🧠' },
]

const USE_LIVE = !!import.meta.env.VITE_USE_LIVE_API

export default function App() {
  const [tab, setTab] = useState('charts')
  const {
    tickPrice, advanceCandle, pollQuotes, fetchMTFCandles,
    trades, apiError,
    masterSwitch, toggleMasterSwitch, runAutoTrade,
    paperSwitch, runPaperAutoTrade,
    marketOpen, refreshMarketStatus,
  } = useStore()

  // Simulated mode
  useEffect(() => {
    if (USE_LIVE) return
    const tick   = setInterval(tickPrice, 500)
    const candle = setInterval(advanceCandle, 60000)
    return () => { clearInterval(tick); clearInterval(candle) }
  }, [])

  // Live API — chart candles handled by LiveChart.jsx useEffect

  // Live API — quotes
  useEffect(() => {
    if (!USE_LIVE) return
    pollQuotes(true)
    const interval = setInterval(pollQuotes, 2000)
    return () => clearInterval(interval)
  }, [])

  // Fetch MTF candles for strategy on load and every 5 min
  useEffect(() => {
    if (!USE_LIVE) return
    FUTURES.forEach(f => fetchMTFCandles(f.symbol))
    const interval = setInterval(() => {
      FUTURES.forEach(f => fetchMTFCandles(f.symbol))
    }, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  // Market status refresh
  useEffect(() => {
    refreshMarketStatus()
    const interval = setInterval(refreshMarketStatus, 60000)
    return () => clearInterval(interval)
  }, [])

  // Auto-trade every 30s when master switch is ON
  useEffect(() => {
    if (!masterSwitch) return
    const interval = setInterval(runAutoTrade, 30000)
    return () => clearInterval(interval)
  }, [masterSwitch])

  // Paper auto-trade every 30s when paper switch is ON
  useEffect(() => {
    if (!paperSwitch) return
    const interval = setInterval(runPaperAutoTrade, 30000)
    return () => clearInterval(interval)
  }, [paperSwitch])

  const openCount  = trades.filter(t => t.status === 'OPEN').length
  const closed     = trades.filter(t => t.status === 'CLOSED')
  const wins       = closed.filter(t => t.pnl > 0).length
  const winRate    = closed.length ? ((wins / closed.length) * 100).toFixed(0) : null

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-left">
          <div className="logo-badge">T</div>
          <span className="app-title">TradeDash</span>
          <span className="futures-badge">FUTURES</span>
        </div>

        <div className="header-right">
          {/* Win rate badge */}
          {winRate !== null && (
            <div style={{
              fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 999,
              background: parseInt(winRate) >= 50 ? '#14532d' : '#450a0a',
              color: parseInt(winRate) >= 50 ? '#4ade80' : '#f87171',
            }}>
              {winRate}% WR
            </div>
          )}

          {/* Market status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: marketOpen ? '#22c55e' : '#ef4444',
              display: 'inline-block',
              animation: marketOpen ? 'pulse 2s ease-in-out infinite' : 'none',
            }} />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.5px', color: marketOpen ? '#22c55e' : '#ef4444' }}>
              {marketOpen ? (USE_LIVE ? 'LIVE' : 'SIM') : 'CLOSED'}
            </span>
          </div>

          {openCount > 0 && (
            <div className="open-badge">{openCount} open position{openCount !== 1 ? 's' : ''}</div>
          )}

        </div>
      </header>

      {!marketOpen && (
        <div style={{ background: '#1c1c1c', color: '#6b7280', padding: '5px 20px', fontSize: 12, textAlign: 'center', borderBottom: '1px solid #1f2937' }}>
          Markets closed — closed Fri 16:00 ET through Sun 18:00 ET
        </div>
      )}
      {apiError && (
        <div style={{ background: '#450a0a', color: '#fca5a5', padding: '6px 20px', fontSize: 12 }}>
          API error: {apiError} — showing simulated data
        </div>
      )}
      {masterSwitch && (
        <div style={{ background: '#14532d', color: '#bbf7d0', padding: '5px 20px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>⚡</span>
          <span>Auto-trading <strong>ON</strong> — ICT strategy running every 30s</span>
        </div>
      )}

      <nav className="tab-nav">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`tab-btn ${tab === t.id ? 'tab-btn--active' : ''}`}>
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      <main className="app-main">
        <ErrorBoundary key={tab}>
          {tab === 'charts'    && <LiveChart />}
          {tab === 'live'      && <LiveTrading />}
          {tab === 'paper'     && <PaperTrading />}
          {tab === 'logs'      && <TradeLogs />}
          {tab === 'portfolio' && <Portfolio />}
          {tab === 'backtest'  && <Backtest onBack={() => setTab('charts')} />}
          {tab === 'strategy' && <Strategy />}
        </ErrorBoundary>
      </main>
    </div>
  )
}