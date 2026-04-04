import { useState, useEffect } from 'react'
import { useStore } from './store'
import LiveChart from './components/LiveChart'
import TradeManager from './components/TradeManager'
import TradeLogs from './components/TradeLogs'
import Portfolio from './components/Portfolio'
import PnLList from './components/PnLList'

const TABS = [
  { id: 'charts',    label: 'Live Charts',    icon: '📈' },
  { id: 'trades',    label: 'Trade Manager',  icon: '⚙️' },
  { id: 'logs',      label: 'Trade Logs',     icon: '📋' },
  { id: 'pnl',       label: 'P&L List',       icon: '💰' },
  { id: 'portfolio', label: 'Portfolio',       icon: '💼' },
]

const USE_LIVE = !!import.meta.env.VITE_USE_LIVE_API

export default function App() {
  const [tab, setTab] = useState('charts')
  const {
    tickPrice, advanceCandle, pollQuotes, fetchCandles,
    trades, apiError, selectedSymbol, timeframe,
    masterSwitch, toggleMasterSwitch, runAutoTrade,
    marketOpen, refreshMarketStatus,
  } = useStore()

  // Simulated mode
  useEffect(() => {
    if (USE_LIVE) return
    const tick   = setInterval(tickPrice, 500)
    const candle = setInterval(advanceCandle, 60000)
    return () => { clearInterval(tick); clearInterval(candle) }
  }, [])

  // Live API mode
  useEffect(() => {
    if (!USE_LIVE) return
    fetchCandles(selectedSymbol, timeframe)
  }, [selectedSymbol, timeframe])

  useEffect(() => {
    if (!USE_LIVE) return
    pollQuotes()
    const interval = setInterval(pollQuotes, 2000)
    return () => clearInterval(interval)
  }, [])

  // Refresh market status every minute
  useEffect(() => {
    refreshMarketStatus()
    const interval = setInterval(refreshMarketStatus, 60000)
    return () => clearInterval(interval)
  }, [])

  // Auto-trade on interval (30s) when master switch is ON
  useEffect(() => {
    if (!masterSwitch) return
    const interval = setInterval(runAutoTrade, 30000)
    return () => clearInterval(interval)
  }, [masterSwitch])

  const openCount = trades.filter(t => t.status === 'OPEN').length

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-left">
          <div className="logo-badge">T</div>
          <span className="app-title">TradeDash</span>
          <span className="futures-badge">FUTURES</span>
        </div>

        <div className="header-right">
          {/* Market status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: marketOpen ? '#22c55e' : '#ef4444',
              display: 'inline-block',
              animation: marketOpen ? 'pulse 2s ease-in-out infinite' : 'none',
            }} />
            <span style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.5px',
              color: marketOpen ? '#22c55e' : '#ef4444',
            }}>
              {marketOpen ? (USE_LIVE ? 'LIVE' : 'SIM') : 'CLOSED'}
            </span>
          </div>

          {openCount > 0 && (
            <div className="open-badge">{openCount} open position{openCount !== 1 ? 's' : ''}</div>
          )}

          {/* Master Switch */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>AUTO</span>
            <button
              onClick={toggleMasterSwitch}
              style={{
                position: 'relative',
                width: 52, height: 28, borderRadius: 14, border: 'none',
                background: masterSwitch ? '#16a34a' : '#374151',
                cursor: 'pointer', transition: 'background 0.2s',
                flexShrink: 0,
              }}
            >
              <span style={{
                position: 'absolute', top: 4,
                left: masterSwitch ? 28 : 4,
                width: 20, height: 20, borderRadius: '50%',
                background: '#fff', transition: 'left 0.2s',
                display: 'block',
              }} />
            </button>
            <span style={{
              fontSize: 11, fontWeight: 700,
              color: masterSwitch ? '#4ade80' : '#6b7280',
              minWidth: 26,
            }}>
              {masterSwitch ? 'ON' : 'OFF'}
            </span>
          </div>
        </div>
      </header>

      {!marketOpen && (
        <div style={{ background: '#1c1c1c', color: '#6b7280', padding: '5px 20px', fontSize: 12, textAlign: 'center', borderBottom: '1px solid #1f2937' }}>
          Markets closed — CME futures reopen Sunday 6:00 PM ET
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
          <span>Auto-trading is <strong>ON</strong> — strategy running every 30s across all symbols</span>
        </div>
      )}

      <nav className="tab-nav">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`tab-btn ${tab === t.id ? 'tab-btn--active' : ''}`}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      <main className="app-main">
        {tab === 'charts'    && <LiveChart />}
        {tab === 'trades'    && <TradeManager />}
        {tab === 'logs'      && <TradeLogs />}
        {tab === 'pnl'       && <PnLList />}
        {tab === 'portfolio' && <Portfolio />}
      </main>
    </div>
  )
}
