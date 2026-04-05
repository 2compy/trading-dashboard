import { useState } from 'react'
import { useStore } from '../store'
import { CONTRACT_MULTIPLIER } from '../utils/strategy'

const UNIT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const TRADE_LIMIT_OPTIONS = [1, 2, 3, 4, 5, '∞']

const MARGIN_PER_CONTRACT = {
  'MES1!': 1500,
  'MNQ1!': 1850,
  'MGC1!': 1000,
}

const STARTING_BALANCE = 100000

export default function PaperTrading() {
  const {
    futures, livePrice, tradeSettings, updateTradeSetting,
    symbolEnabled, toggleSymbol, symbolSide,
  } = useStore()

  const [paperOn, setPaperOn] = useState(false)
  const [paperTrades, setPaperTrades] = useState([])
  const units = tradeSettings.paperUnits || 1
  const paperMaxPerSymbol = tradeSettings.paperMaxPerSymbol || {}
  const enabledSymbols = futures.filter(f => symbolEnabled[f.symbol])

  const getMaxForSymbol = (sym) => paperMaxPerSymbol[sym] || 3

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
        date: new Date().toLocaleDateString(),
        status: 'OPEN',
      }])
    })
  }

  const closePaperTrade = (id) => {
    setPaperTrades(prev => prev.map(t => {
      if (t.id !== id) return t
      const exitPrice = livePrice[t.symbol]
      const mult = CONTRACT_MULTIPLIER[t.symbol] || 5
      const dir = t.side === 'LONG' ? 1 : -1
      const pnlDollars = (exitPrice - t.entry) * mult * dir * t.units
      return { ...t, status: 'CLOSED', exit: exitPrice, closeTime: new Date().toLocaleTimeString(), pnl: parseFloat(pnlDollars.toFixed(2)) }
    }))
  }

  const openPaper = paperTrades.filter(t => t.status === 'OPEN')
  const closedPaper = paperTrades.filter(t => t.status === 'CLOSED')
  const wins = closedPaper.filter(t => t.pnl > 0).length
  const losses = closedPaper.filter(t => t.pnl <= 0).length
  const winRate = closedPaper.length > 0 ? ((wins / closedPaper.length) * 100).toFixed(1) : null
  const totalPnl = closedPaper.reduce((sum, t) => sum + t.pnl, 0)
  const balance = STARTING_BALANCE + totalPnl
  const openMargin = openPaper.reduce((sum, t) => sum + (MARGIN_PER_CONTRACT[t.symbol] || 1000) * t.units, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>

      {/* Master Switch + Balance */}
      <div className="card" style={{ padding: '14px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
        {/* Balance bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 12, padding: '10px 14px', borderRadius: 8, background: '#0f172a', border: '1px solid #1f2937' }}>
          <div>
            <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Account Balance</div>
            <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'monospace', color: balance >= STARTING_BALANCE ? '#4ade80' : '#f87171', marginTop: 2 }}>
              ${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, color: '#6b7280' }}>P&L</div>
            <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'monospace', color: totalPnl >= 0 ? '#4ade80' : '#f87171' }}>
              {totalPnl >= 0 ? '+' : ''}${totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            {openMargin > 0 && (
              <div style={{ fontSize: 9, color: '#6b7280', marginTop: 2 }}>${openMargin.toLocaleString()} in use</div>
            )}
          </div>
        </div>
      </div>

      {/* Units per trade */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Units per Trade</div>
          <div style={{ fontSize: 12, color: '#fbbf24', fontFamily: 'monospace' }}>
            ${(units * (MARGIN_PER_CONTRACT['MES1!'] || 1000)).toLocaleString()} / trade (ES)
          </div>
        </div>
        <div style={{ fontSize: 11, color: '#6b7280' }}>Each unit = 1 contract of margin</div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {UNIT_OPTIONS.map(n => {
            const cost = n * (MARGIN_PER_CONTRACT['MES1!'] || 1000)
            return (
              <button
                key={n}
                onClick={() => updateTradeSetting('paperUnits', n)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  width: 52, padding: '6px 0', borderRadius: 8, border: '1px solid',
                  borderColor: units === n ? '#a16207' : '#374151',
                  background: units === n ? '#451a03' : '#1f2937',
                  color: units === n ? '#fbbf24' : '#6b7280',
                  fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                <span style={{ fontSize: 14 }}>{n}</span>
                <span style={{ fontSize: 8, opacity: 0.7 }}>${(cost / 1000).toFixed(1)}k</span>
              </button>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 2 }}>
          {futures.map(f => (
            <div key={f.symbol} style={{ fontSize: 10, color: '#6b7280' }}>
              {f.symbol}: <span style={{ color: '#fbbf24', fontFamily: 'monospace' }}>${((MARGIN_PER_CONTRACT[f.symbol] || 1000) * units).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Active Symbols with per-symbol max trades */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Active Symbols</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {futures.map(f => {
            const enabled = symbolEnabled[f.symbol]
            const open = openPaper.filter(t => t.symbol === f.symbol).length
            const price = livePrice[f.symbol]
            const symMax = getMaxForSymbol(f.symbol)
            const selectedMax = symMax === 'infinite' ? '∞' : symMax
            const margin = MARGIN_PER_CONTRACT[f.symbol] || 1000
            return (
              <div key={f.symbol} style={{
                padding: '10px 12px', borderRadius: 8,
                border: `1px solid ${enabled ? '#a16207' : '#1f2937'}`,
                background: enabled ? '#0f172a' : '#111827',
                transition: 'all 0.15s',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>
                      {f.symbol}
                      <span style={{ fontSize: 10, color: '#6b7280', fontWeight: 400, marginLeft: 6 }}>${margin.toLocaleString()}/contract</span>
                    </div>
                    <div style={{ fontSize: 10, color: '#6b7280' }}>{f.name}</div>
                    <div style={{ fontFamily: 'monospace', color: '#fbbf24', fontSize: 12, marginTop: 1 }}>
                      ${price?.toFixed(2)}
                      {open > 0 && <span style={{ color: '#fbbf24', background: '#451a03', padding: '1px 5px', borderRadius: 999, marginLeft: 4, fontSize: 10 }}>{open} paper</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <button
                      onClick={() => toggleSymbol(f.symbol)}
                      style={{
                        position: 'relative', width: 44, height: 24, borderRadius: 12,
                        border: 'none', background: enabled ? '#a16207' : '#374151',
                        cursor: 'pointer', transition: 'background 0.2s',
                      }}
                    >
                      <span style={{
                        position: 'absolute', top: 3,
                        left: enabled ? 23 : 3,
                        width: 18, height: 18, borderRadius: '50%',
                        background: '#fff', transition: 'left 0.2s', display: 'block',
                      }} />
                    </button>
                  </div>
                </div>
                {/* Per-symbol trades per day */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, color: '#6b7280', fontWeight: 600, minWidth: 70 }}>Trades/day</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {TRADE_LIMIT_OPTIONS.map(c => {
                      const val = c === '∞' ? 'infinite' : c
                      return (
                        <button
                          key={c}
                          onClick={() => updateTradeSetting('paperMaxPerSymbol', { ...paperMaxPerSymbol, [f.symbol]: val })}
                          style={{
                            width: 34, height: 28, borderRadius: 6, border: '1px solid',
                            borderColor: selectedMax === c ? '#a16207' : '#374151',
                            background: selectedMax === c ? '#451a03' : '#1f2937',
                            color: selectedMax === c ? '#fbbf24' : '#6b7280',
                            fontWeight: 700, fontSize: 12, cursor: 'pointer',
                            transition: 'all 0.15s',
                          }}
                        >
                          {c}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {paperOn && (
          <div style={{ fontSize: 11, color: '#fbbf24', background: '#451a03', borderRadius: 6, padding: '6px 10px', textAlign: 'center' }}>
            Paper mode — {units} unit{units !== 1 ? 's' : ''} per trade on {enabledSymbols.length} symbol{enabledSymbols.length !== 1 ? 's' : ''}
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

      {/* Trade Tracker / Performance */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Trade Tracker</div>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, padding: '10px', borderRadius: 8, background: '#0f172a', border: '1px solid #1f2937', textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#e5e7eb', marginTop: 2 }}>{closedPaper.length}</div>
          </div>
          <div style={{ flex: 1, padding: '10px', borderRadius: 8, background: '#0f172a', border: '1px solid #14532d', textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Wins</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#4ade80', marginTop: 2 }}>{wins}</div>
          </div>
          <div style={{ flex: 1, padding: '10px', borderRadius: 8, background: '#0f172a', border: '1px solid #450a0a', textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Losses</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#f87171', marginTop: 2 }}>{losses}</div>
          </div>
          <div style={{ flex: 1, padding: '10px', borderRadius: 8, background: '#0f172a', border: `1px solid ${winRate && parseFloat(winRate) >= 50 ? '#14532d' : '#450a0a'}`, textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Win Rate</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: winRate && parseFloat(winRate) >= 50 ? '#4ade80' : winRate ? '#f87171' : '#6b7280', marginTop: 2 }}>
              {winRate ? `${winRate}%` : '—'}
            </div>
          </div>
        </div>

        {/* Win rate bar */}
        {closedPaper.length > 0 && (
          <div style={{ height: 8, borderRadius: 4, background: '#450a0a', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${winRate}%`, background: '#16a34a', borderRadius: 4, transition: 'width 0.3s' }} />
          </div>
        )}

        {/* Per-symbol breakdown */}
        {closedPaper.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {futures.map(f => {
              const symTrades = closedPaper.filter(t => t.symbol === f.symbol)
              const symWins = symTrades.filter(t => t.pnl > 0).length
              const symPnl = symTrades.reduce((s, t) => s + t.pnl, 0)
              const symWR = symTrades.length > 0 ? ((symWins / symTrades.length) * 100).toFixed(0) : null
              if (symTrades.length === 0) return null
              return (
                <div key={f.symbol} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', borderRadius: 6, background: '#111827' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 12 }}>{f.symbol}</span>
                    <span style={{ fontSize: 10, color: '#6b7280' }}>{symTrades.length} trades</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: symWR && parseInt(symWR) >= 50 ? '#4ade80' : '#f87171' }}>
                      {symWR}% WR
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'monospace', color: symPnl >= 0 ? '#4ade80' : '#f87171' }}>
                      {symPnl >= 0 ? '+' : ''}${symPnl.toFixed(2)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Open paper trades */}
      {openPaper.length > 0 && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Open Paper Trades</div>
          {openPaper.map(t => {
            const currentPrice = livePrice[t.symbol]
            const mult = CONTRACT_MULTIPLIER[t.symbol] || 5
            const dir = t.side === 'LONG' ? 1 : -1
            const unrealized = currentPrice ? ((currentPrice - t.entry) * mult * dir * t.units) : 0
            return (
              <div key={t.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px', borderRadius: 6, background: '#0f172a', border: '1px solid #1f2937',
              }}>
                <div>
                  <span style={{ fontWeight: 700, fontSize: 12 }}>{t.symbol}</span>
                  <span style={{ fontSize: 11, color: t.side === 'LONG' ? '#4ade80' : '#f87171', marginLeft: 8 }}>{t.side}</span>
                  <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 8 }}>{t.units}u @ ${t.entry.toFixed(2)}</span>
                  <span style={{ fontSize: 11, fontFamily: 'monospace', marginLeft: 8, color: unrealized >= 0 ? '#4ade80' : '#f87171' }}>
                    {unrealized >= 0 ? '+' : ''}${unrealized.toFixed(2)}
                  </span>
                </div>
                <button onClick={() => closePaperTrade(t.id)} style={{
                  padding: '4px 10px', borderRadius: 6, border: 'none',
                  background: '#dc2626', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                }}>
                  Close
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Closed paper trades */}
      {closedPaper.length > 0 && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#6b7280' }}>Trade History ({closedPaper.length})</div>
          {closedPaper.slice(-15).reverse().map(t => (
            <div key={t.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '6px 12px', borderRadius: 6, background: '#111827', border: '1px solid #1f2937',
            }}>
              <div>
                <span style={{ fontWeight: 700, fontSize: 12 }}>{t.symbol}</span>
                <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 8 }}>{t.side} {t.units}u</span>
                <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 8 }}>${t.entry.toFixed(2)} → ${t.exit?.toFixed(2)}</span>
              </div>
              <span style={{ fontWeight: 700, fontSize: 12, fontFamily: 'monospace', color: t.pnl >= 0 ? '#4ade80' : '#f87171' }}>
                {t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
