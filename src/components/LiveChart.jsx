import { useEffect, useRef, useState, useMemo } from 'react'
import { createChart, CrosshairMode, CandlestickSeries } from 'lightweight-charts'
import { useStore, TIMEFRAMES } from '../store'
import { detectFVGs, isKillZone, getSignalDebugInfo } from '../utils/strategy'

const USE_LIVE = !!import.meta.env.VITE_USE_LIVE_API

// Step → color mapping for the debug panel
const STEP_COLOR = {
  no_data:   '#6b7280',
  no_ts:     '#6b7280',
  kill_zone: '#f59e0b',
  prev_day:  '#f59e0b',
  sweep:     '#fb923c',
  bos_data:  '#fb923c',
  bos:       '#fb923c',
  fvg_data:  '#a78bfa',
  fvg:       '#a78bfa',
  fvg_width: '#a78bfa',
  ifvg:      '#60a5fa',
  signal:    '#4ade80',
}

const STEP_DOT = {
  no_data: '#374151', no_ts: '#374151', kill_zone: '#f59e0b', prev_day: '#f59e0b',
  sweep: '#fb923c', bos_data: '#fb923c', bos: '#fb923c',
  fvg_data: '#a78bfa', fvg: '#a78bfa', fvg_width: '#a78bfa',
  ifvg: '#60a5fa', signal: '#22c55e',
}

export default function LiveChart() {
  const {
    futures, selectedSymbol, setSelectedSymbol,
    candleData, livePrice, priceChange,
    timeframe, setTimeframe, fetchCandles,
    trades, mtfCandles,
  } = useStore()

  const chartContainerRef = useRef(null)
  const chartRef          = useRef(null)
  const seriesRef         = useRef(null)
  const priceLinesRef     = useRef([])

  // Kill zone live indicator
  const [inKillZone, setInKillZone] = useState(() => isKillZone(Math.floor(Date.now() / 1000)))
  useEffect(() => {
    const check = () => setInKillZone(isKillZone(Math.floor(Date.now() / 1000)))
    const interval = setInterval(check, 30000)
    return () => clearInterval(interval)
  }, [])

  // Signal debug — computed from mtfCandles (live mode only)
  const signalDebug = useMemo(() => {
    const c5m = mtfCandles[selectedSymbol]?.['5m'] || []
    const c1m = mtfCandles[selectedSymbol]?.['1m'] || []
    return getSignalDebugInfo(c5m, c1m)
  }, [mtfCandles, selectedSymbol])

  // ── Create chart once on mount ────────────────────────────────────────────
  useEffect(() => {
    if (!chartContainerRef.current) return
    const chart = createChart(chartContainerRef.current, {
      layout: { background: { color: '#030712' }, textColor: '#9ca3af' },
      grid: { vertLines: { color: '#111827' }, horzLines: { color: '#111827' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#1f2937' },
      timeScale: {
        borderColor: '#1f2937',
        timeVisible: true,
        timezone: 'America/New_York',
        tickMarkFormatter: (time) => {
          const d = new Date(time * 1000)
          return d.toLocaleString('en-US', {
            timeZone: 'America/New_York',
            hour: '2-digit', minute: '2-digit',
            hour12: false,
          })
        },
      },
      localization: {
        timeFormatter: (time) => {
          const d = new Date(time * 1000)
          return d.toLocaleString('en-US', {
            timeZone: 'America/New_York',
            month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
            hour12: false,
          })
        },
      },
      width:  chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
    })
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e', downColor: '#ef4444',
      borderUpColor: '#22c55e', borderDownColor: '#ef4444',
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
    })
    chartRef.current  = chart
    seriesRef.current = series

    const ro = new ResizeObserver(() => {
      if (!chartContainerRef.current) return
      chart.applyOptions({
        width:  chartContainerRef.current.clientWidth,
        height: chartContainerRef.current.clientHeight,
      })
    })
    ro.observe(chartContainerRef.current)
    return () => { chart.remove(); ro.disconnect() }
  }, [])

  // ── Load candle data when symbol or data changes ──────────────────────────
  useEffect(() => {
    if (!seriesRef.current) return
    seriesRef.current.setData(candleData[selectedSymbol] || [])
    chartRef.current?.timeScale().fitContent()
  }, [selectedSymbol, candleData])

  // ── Fetch live candles on symbol/timeframe change (live mode only) ─────────
  // FIX: Only fetch here. handleTimeframe no longer calls fetchCandles directly,
  // eliminating the double-fetch that occurred on every timeframe button click.
  useEffect(() => {
    fetchCandles(selectedSymbol, timeframe)
  }, [selectedSymbol, timeframe])

  // ── FVG overlays + trade markers ─────────────────────────────────────────
  useEffect(() => {
    if (!seriesRef.current) return

    // Clear old price lines
    priceLinesRef.current.forEach(pl => {
      try { seriesRef.current.removePriceLine(pl) } catch (_) {}
    })
    priceLinesRef.current = []

    // FVG overlays: show the 6 most recent FVGs on the current chart data
    const candles = candleData[selectedSymbol] || []
    if (candles.length >= 3) {
      const fvgs = detectFVGs(candles).slice(-6)
      fvgs.forEach(fvg => {
        const color = fvg.type === 'bullish' ? '#22c55e' : '#ef4444'
        const label = fvg.type === 'bullish' ? 'BFVG' : 'BFVG'
        try {
          const top = seriesRef.current.createPriceLine({
            price: fvg.top, color, lineWidth: 1, lineStyle: 2,
            axisLabelVisible: true,
            title: fvg.type === 'bullish' ? '▲FVG' : '▼FVG',
          })
          const bot = seriesRef.current.createPriceLine({
            price: fvg.bottom, color, lineWidth: 1, lineStyle: 2,
            axisLabelVisible: false, title: '',
          })
          priceLinesRef.current.push(top, bot)
        } catch (_) {}
      })
    }

    // Trade markers: entry arrows + exit circles for the selected symbol
    const markers = []
    trades.forEach(t => {
      if (t.symbol !== selectedSymbol) return
      const entryTs = Math.floor(new Date(t.entryTime).getTime() / 1000)
      markers.push({
        time: entryTs,
        position: t.side === 'LONG' ? 'belowBar' : 'aboveBar',
        color: '#3b82f6',
        shape: t.side === 'LONG' ? 'arrowUp' : 'arrowDown',
        text: `#${t.id}${t.auto ? ' ⚡' : ''}`,
      })
      if (t.status === 'CLOSED' && t.exitTime) {
        const exitTs = Math.floor(new Date(t.exitTime).getTime() / 1000)
        const isWin = (t.pnl || 0) >= 0
        markers.push({
          time: exitTs + 1,   // +1s to avoid collision with an entry at the same bar
          position: isWin ? 'aboveBar' : 'belowBar',
          color: isWin ? '#22c55e' : '#ef4444',
          shape: 'circle',
          text: `${isWin ? '✓' : '✗'} $${Math.abs(t.pnl || 0).toFixed(0)}`,
        })
      }
    })

    // Sort and dedup by time (lightweight-charts requires ascending order)
    markers.sort((a, b) => a.time - b.time)
    const seen = new Set()
    const unique = markers.filter(m => {
      if (seen.has(m.time)) { m.time += 1; }  // shift by 1s if collision
      seen.add(m.time)
      return true
    })

    try { seriesRef.current.setMarkers(unique) } catch (_) {}

  }, [selectedSymbol, candleData, trades])

  // FIX: handleTimeframe only updates state — the useEffect above handles the fetch
  const handleTimeframe = (tf) => {
    setTimeframe(tf)
    // fetchCandles is triggered by the [selectedSymbol, timeframe] useEffect
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 10 }}>

      {/* Top bar: symbols + timeframes */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
        {/* Symbol buttons */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {futures.map(f => {
            const change = priceChange[f.symbol]
            const isUp   = change >= 0
            const active = selectedSymbol === f.symbol
            return (
              <button
                key={f.symbol}
                onClick={() => setSelectedSymbol(f.symbol)}
                style={{
                  padding: '7px 12px', borderRadius: 9, border: '1px solid',
                  borderColor: active ? '#2563eb' : '#1f2937',
                  background:  active ? '#1d4ed8' : '#111827',
                  color: active ? '#fff' : '#9ca3af',
                  cursor: 'pointer', textAlign: 'left',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 12 }}>{f.symbol}</div>
                <div style={{ fontSize: 11, color: isUp ? '#4ade80' : '#f87171', marginTop: 2 }}>
                  {livePrice[f.symbol]?.toFixed(2)} {isUp ? '▲' : '▼'} {Math.abs(change).toFixed(2)}
                </div>
              </button>
            )
          })}
        </div>

        {/* Timeframe buttons + kill zone indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Kill zone pill */}
          <div style={{
            fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 999,
            background: inKillZone ? '#451a03' : '#1f2937',
            color: inKillZone ? '#fbbf24' : '#4b5563',
            border: `1px solid ${inKillZone ? '#92400e' : '#374151'}`,
            letterSpacing: '0.5px',
          }}>
            {inKillZone ? '⚡ KILL ZONE' : 'Kill Zone: OFF'}
          </div>

          {TIMEFRAMES.map(tf => (
            <button
              key={tf}
              onClick={() => handleTimeframe(tf)}
              style={{
                padding: '6px 12px', borderRadius: 7, border: '1px solid',
                borderColor: timeframe === tf ? '#2563eb' : '#1f2937',
                background:  timeframe === tf ? '#1d4ed8' : '#111827',
                color: timeframe === tf ? '#fff' : '#9ca3af',
                cursor: 'pointer', fontSize: 12, fontWeight: 600,
              }}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div
        ref={chartContainerRef}
        style={{ flex: 1, borderRadius: 12, overflow: 'hidden', border: '1px solid #1f2937', background: '#030712' }}
      />

      {/* Signal debug panel — live mode only */}
      {USE_LIVE && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          background: '#0d1117', border: '1px solid #1f2937', borderRadius: 10,
          padding: '8px 14px',
        }}>
          <span style={{ fontSize: 10, color: '#4b5563', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', flexShrink: 0 }}>
            Signal — {selectedSymbol}
          </span>

          {/* Progress pips */}
          {['kill_zone','sweep','bos','fvg','ifvg','signal'].map((step, i, arr) => {
            const steps = ['no_data','no_ts','kill_zone','prev_day','sweep','bos_data','bos','fvg_data','fvg','fvg_width','ifvg','signal']
            const currentIdx = steps.indexOf(signalDebug.step)
            const thisIdx    = steps.indexOf(step)
            const passed = currentIdx > thisIdx || signalDebug.step === step
            const labels = ['Kill Zone','Sweep','BOS','FVG','IFVG','Signal']
            return (
              <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {i > 0 && <div style={{ width: 16, height: 1, background: passed ? '#374151' : '#1f2937' }} />}
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: signalDebug.step === step ? STEP_DOT[step] : (passed ? '#374151' : '#1f2937'),
                  border: `1px solid ${signalDebug.step === step ? STEP_DOT[step] : 'transparent'}`,
                  boxShadow: signalDebug.step === step ? `0 0 6px ${STEP_DOT[step]}` : 'none',
                }} />
                <span style={{ fontSize: 10, color: signalDebug.step === step ? STEP_COLOR[step] : '#374151', fontWeight: 600 }}>
                  {labels[i]}
                </span>
              </div>
            )
          })}

          <span style={{
            marginLeft: 'auto', fontSize: 11, color: STEP_COLOR[signalDebug.step] || '#6b7280',
            fontStyle: 'italic',
          }}>
            {signalDebug.label}
          </span>
        </div>
      )}

      {/* FVG legend */}
      <div style={{ display: 'flex', gap: 16, paddingLeft: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#6b7280' }}>
          <div style={{ width: 16, height: 1, borderTop: '1px dashed #22c55e' }} />
          <span>Bullish FVG</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#6b7280' }}>
          <div style={{ width: 16, height: 1, borderTop: '1px dashed #ef4444' }} />
          <span>Bearish FVG</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#6b7280' }}>
          <span style={{ color: '#3b82f6' }}>↑↓</span>
          <span>Trade entries</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#6b7280' }}>
          <span style={{ color: '#22c55e' }}>●</span>
          <span>Win exit</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#6b7280' }}>
          <span style={{ color: '#ef4444' }}>●</span>
          <span>Loss exit</span>
        </div>
      </div>
    </div>
  )
}
