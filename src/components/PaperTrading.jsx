import { useState } from 'react'
import { useStore } from '../store'

const UNIT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const TRADE_LIMIT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

export default function PaperTrading() {
  const {
    futures, livePrice, tradeSettings, updateTradeSetting,
    symbolEnabled, toggleSymbol, symbolSide, setSymbolSide,
    trades,
  } = useStore()

  const [paperOn, setPaperOn] = useState(false)
  const [paperTrades, setPaperTrades] = useState([])
  const openTrades = trades.filter(t => t.status === 'OPEN')
  const units = tradeSettings.paperUnits || 1
  const maxTrades = tradeSettings.paperMaxTrades || 3
  const enabledSymbols = futures.filter(f => symbolEnabled[f.symbol])

  const enterPaperTrade = () => {
    enabledSymbols.forEach(f => {
      const price = livePrice[f.symbol]
      if (!price) return
      setPaperTrades(prev => [...prev, {
        id: Date.now() + Math.random(),
        symbol: f.symbol,
        side: symbolSide[f.symbol],
        entry: price,
        units,
        time: new Date().toLocaleTimeString(),
        status: 'OPEN',
      }])
    })
  }

  const closePaperTrade = (id) => {
    setPaperTrades(prev => prev.map(t =>
      t.id === id ? { ...t, status: 'CLOSED', exit: livePrice[t.symbol], closeTime: new Date().toLocaleTimeString() } : t
    ))
  }

  const openPaper = paperTrades.filter(t => t.status === 'OPEN')
  const closedPaper = paperTrades.filter(t => t.status === 'CLOSED')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>

      {/* Master Switch */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Paper Trading</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
            {paperOn ? 'Simulated trades active — no real money' : 'Paper trading is off'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: paperOn ? '#fbbf24' : '#6b7280' }}>
            {paperOn ? 'ON' : 'OFF'}
          </span>
          <button
            onClick={() => setPaperOn(!paperOn)}
            style={{
              position: 'relative', width: 56, height: 30, borderRadius: 15,
              border: 'none', background: paperOn ? '#a16207' : '#374151',
              cursor: 'pointer', transition: 'background 0.2s',
            }}
          >
            <span style={{
              position: 'absolute', top: 4,
              left: paperOn ? 30 : 4,
              width: 22, height: 22, borderRadius: '50%',
              background: '#fff', transition: 'left 0.2s', display: 'block',
            }} />
          </button>
        </div>
      </div>

      {/* Units per trade */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Units per Trade</div>
        <div style={{ fontSize: 11, color: '#6b7280' }}>How many contracts to simulate per trade</div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {UNIT_OPTIONS.map(n => (
            <button
              key={n}
              onClick={() => updateTradeSetting('paperUnits', n)}
              style={{
                width: 42, height: 38, borderRadius: 8, border: '1px solid',
                borderColor: units === n ? '#a16207' : '#374151',
                background: units === n ? '#451a03' : '#1f2937',
                color: units === n ? '#fbbf24' : '#6b7280',
                fontWeight: 700, fontSize: 14, cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Max trades per day */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Max Trades per Day</div>
        <div style={{ fontSize: 11, color: '#6b7280' }}>Limit how many paper trades can be taken</div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {TRADE_LIMIT_OPTIONS.map(n => (
            <button
              key={n}
              onClick={() => updateTradeSetting('paperMaxTrades', n)}
              style={{
                width: 42, height: 38, borderRadius: 8, border: '1px solid',
                borderColor: maxTrades === n ? '#a16207' : '#374151',
                background: maxTrades === n ? '#451a03' : '#1f2937',
                color: maxTrades === n ? '#fbbf24' : '#6b7280',
                fontWeight: 700, fontSize: 14, cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Symbol list */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Symbols</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {futures.map(f => {
            const price = livePrice[f.symbol]
            const open = openPaper.filter(t => t.symbol === f.symbol).length
            return (
              <div key={f.symbol} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 12px', borderRadius: 8,
                border: '1px solid #1f2937', background: '#111827', gap: 10,
              }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{f.symbol}</div>
                  <div style={{ fontFamily: 'monospace', color: '#fbbf24', fontSize: 12, marginTop: 1 }}>
                    ${price?.toFixed(2)}
                    {open > 0 && <span style={{ color: '#fbbf24', background: '#451a03', padding: '1px 5px', borderRadius: 999, marginLeft: 4, fontSize: 10 }}>{open} paper</span>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {paperOn && (
          <div style={{ fontSize: 11, color: '#fbbf24', background: '#451a03', borderRadius: 6, padding: '6px 10px', textAlign: 'center' }}>
            Paper mode — {units} unit{units !== 1 ? 's' : ''} per trade, max {maxTrades}/day
          </div>
        )}

        <button
          onClick={enterPaperTrade}
          disabled={!paperOn || enabledSymbols.length === 0}
          style={{
            width: '100%', padding: '10px 0', borderRadius: 8, border: 'none',
            background: !paperOn || enabledSymbols.length === 0 ? '#1f2937' : '#a16207',
            color: !paperOn || enabledSymbols.length === 0 ? '#4b5563' : '#fff',
            fontWeight: 700, fontSize: 13, cursor: !paperOn || enabledSymbols.length === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          {!paperOn ? 'Enable paper trading to start'
            : enabledSymbols.length === 0 ? 'No symbols selected'
            : `Paper Trade — ${enabledSymbols.map(f => f.symbol).join(' · ')}`}
        </button>
      </div>

      {/* Open paper trades */}
      {openPaper.length > 0 && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Open Paper Trades</div>
          {openPaper.map(t => (
            <div key={t.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 12px', borderRadius: 6, background: '#0f172a', border: '1px solid #1f2937',
            }}>
              <div>
                <span style={{ fontWeight: 700, fontSize: 12 }}>{t.symbol}</span>
                <span style={{ fontSize: 11, color: t.side === 'LONG' ? '#4ade80' : '#f87171', marginLeft: 8 }}>{t.side}</span>
                <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 8 }}>{t.units} unit{t.units !== 1 ? 's' : ''} @ ${t.entry.toFixed(2)}</span>
                <span style={{ fontSize: 10, color: '#4b5563', marginLeft: 8 }}>{t.time}</span>
              </div>
              <button onClick={() => closePaperTrade(t.id)} style={{
                padding: '4px 10px', borderRadius: 6, border: 'none',
                background: '#dc2626', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer',
              }}>
                Close
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Closed paper trades */}
      {closedPaper.length > 0 && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#6b7280' }}>Closed Paper Trades ({closedPaper.length})</div>
          {closedPaper.slice(-10).reverse().map(t => {
            const pnl = t.side === 'LONG' ? (t.exit - t.entry) : (t.entry - t.exit)
            const pnlColor = pnl >= 0 ? '#4ade80' : '#f87171'
            return (
              <div key={t.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '6px 12px', borderRadius: 6, background: '#111827', border: '1px solid #1f2937',
              }}>
                <div>
                  <span style={{ fontWeight: 700, fontSize: 12 }}>{t.symbol}</span>
                  <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 8 }}>{t.side} {t.units}u</span>
                  <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 8 }}>${t.entry.toFixed(2)} → ${t.exit?.toFixed(2)}</span>
                </div>
                <span style={{ fontWeight: 700, fontSize: 12, color: pnlColor }}>
                  {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} pts
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
