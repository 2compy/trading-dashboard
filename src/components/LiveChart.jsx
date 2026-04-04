import { useEffect, useRef } from 'react'
import { createChart, CrosshairMode, CandlestickSeries } from 'lightweight-charts'
import { useStore, TIMEFRAMES } from '../store'

export default function LiveChart() {
  const {
    futures, selectedSymbol, setSelectedSymbol,
    candleData, livePrice, priceChange,
    timeframe, setTimeframe, fetchCandles,
  } = useStore()

  const chartContainerRef = useRef(null)
  const chartRef = useRef(null)
  const seriesRef = useRef(null)

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

  // Reload candles when symbol or timeframe changes
  useEffect(() => {
    if (!seriesRef.current) return
    seriesRef.current.setData(candleData[selectedSymbol] || [])
    chartRef.current?.timeScale().fitContent()
  }, [selectedSymbol, candleData])

  // Fetch live candles on symbol/timeframe change
  useEffect(() => {
    fetchCandles(selectedSymbol, timeframe)
  }, [selectedSymbol, timeframe])

  const handleTimeframe = (tf) => {
    setTimeframe(tf)
    fetchCandles(selectedSymbol, tf)
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

        {/* Timeframe buttons */}
        <div style={{ display: 'flex', gap: 4 }}>
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
    </div>
  )
}
