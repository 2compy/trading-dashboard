import { useState, useEffect } from 'react'
import { useStore } from './store'
import LiveChart from './components/LiveChart'
import TradeManager from './components/TradeManager'
import TradeLogs from './components/TradeLogs'
import Portfolio from './components/Portfolio'

const TABS = [
  { id: 'charts', label: 'Live Charts', icon: '📈' },
  { id: 'trades', label: 'Trade Manager', icon: '⚙️' },
  { id: 'logs', label: 'Trade Logs', icon: '📋' },
  { id: 'portfolio', label: 'Portfolio', icon: '💼' },
]

const USE_LIVE_API = !!import.meta.env.VITE_USE_LIVE_API

export default function App() {
  const [tab, setTab] = useState('charts')
  const { tickPrice, advanceCandle, pollQuotes, fetchCandles, trades, apiError, selectedSymbol } = useStore()

  // Simulated mode
  useEffect(() => {
    if (USE_LIVE_API) return
    const tick = setInterval(tickPrice, 500)
    const candle = setInterval(advanceCandle, 60000)
    return () => { clearInterval(tick); clearInterval(candle) }
  }, [])

  // Live API mode — poll quotes every 2s, fetch candles on symbol change
  useEffect(() => {
    if (!USE_LIVE_API) return
    fetchCandles(selectedSymbol)
  }, [selectedSymbol])

  useEffect(() => {
    if (!USE_LIVE_API) return
    pollQuotes()
    const interval = setInterval(pollQuotes, 2000)
    return () => clearInterval(interval)
  }, [])

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
          <div className="live-indicator">
            <span className="live-dot" />
            <span className="live-label">LIVE</span>
          </div>
          {openCount > 0 && (
            <div className="open-badge">{openCount} open position{openCount !== 1 ? 's' : ''}</div>
          )}
        </div>
      </header>

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

      {apiError && (
        <div style={{ background: '#450a0a', color: '#fca5a5', padding: '6px 20px', fontSize: 12 }}>
          API error: {apiError} — showing simulated data
        </div>
      )}

      <main className="app-main">
        {tab === 'charts' && <LiveChart />}
        {tab === 'trades' && <TradeManager />}
        {tab === 'logs' && <TradeLogs />}
        {tab === 'portfolio' && <Portfolio />}
      </main>
    </div>
  )
}
