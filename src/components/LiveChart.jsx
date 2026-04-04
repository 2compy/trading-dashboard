import { useEffect, useRef } from 'react'
import { createChart, CrosshairMode } from 'lightweight-charts'
import { useStore } from '../store'

export default function LiveChart() {
  const { futures, selectedSymbol, setSelectedSymbol, candleData, livePrice, priceChange } = useStore()
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
      timeScale: { borderColor: '#1f2937', timeVisible: true },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
    })
    const series = chart.addCandlestickSeries({
      upColor: '#22c55e', downColor: '#ef4444',
      borderUpColor: '#22c55e', borderDownColor: '#ef4444',
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
    })
    chartRef.current = chart
    seriesRef.current = series

    const ro = new ResizeObserver(() => {
      if (!chartContainerRef.current) return
      chart.applyOptions({
        width: chartContainerRef.current.clientWidth,
        height: chartContainerRef.current.clientHeight,
      })
    })
    ro.observe(chartContainerRef.current)
    return () => { chart.remove(); ro.disconnect() }
  }, [])

  useEffect(() => {
    if (!seriesRef.current) return
    seriesRef.current.setData(candleData[selectedSymbol])
    chartRef.current?.timeScale().fitContent()
  }, [selectedSymbol])

  useEffect(() => {
    if (!seriesRef.current) return
    const candles = candleData[selectedSymbol]
    if (candles?.length) seriesRef.current.update(candles[candles.length - 1])
  }, [candleData, selectedSymbol])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
      {/* Symbol selector */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {futures.map(f => {
          const change = priceChange[f.symbol]
          const isUp = change >= 0
          const active = selectedSymbol === f.symbol
          return (
            <button
              key={f.symbol}
              onClick={() => setSelectedSymbol(f.symbol)}
              style={{
                padding: '8px 14px', borderRadius: 10, border: '1px solid',
                borderColor: active ? '#2563eb' : '#1f2937',
                background: active ? '#1d4ed8' : '#111827',
                color: active ? '#fff' : '#9ca3af',
                cursor: 'pointer', textAlign: 'left',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 13 }}>{f.symbol}</div>
              <div style={{ fontSize: 11, color: isUp ? '#4ade80' : '#f87171', marginTop: 2 }}>
                {livePrice[f.symbol]?.toFixed(2)} {isUp ? '▲' : '▼'} {Math.abs(change).toFixed(2)}
              </div>
            </button>
          )
        })}
      </div>

      {/* Chart container */}
      <div
        ref={chartContainerRef}
        style={{ flex: 1, borderRadius: 12, overflow: 'hidden', border: '1px solid #1f2937', background: '#030712' }}
      />
    </div>
  )
}
