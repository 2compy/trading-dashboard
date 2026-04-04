// Returns 1-minute candles for a futures symbol via Polygon.io aggregates

const POLYGON_BASE = 'https://api.polygon.io'

const SYMBOL_MAP = {
  ES: 'ES1!',
  NQ: 'NQ1!',
  CL: 'CL1!',
  GC: 'GC1!',
  ZB: 'ZB1!',
  SI: 'SI1!',
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')

  const apiKey = process.env.POLYGON_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'POLYGON_API_KEY not configured' })

  const { symbol, from, to } = req.query
  const ticker = SYMBOL_MAP[symbol?.toUpperCase()]
  if (!ticker) return res.status(400).json({ error: 'Unknown symbol' })

  // Default: last 3 hours of 1-minute bars
  const toDate = to || new Date().toISOString().split('T')[0]
  const fromDate = from || (() => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return d.toISOString().split('T')[0]
  })()

  const url = `${POLYGON_BASE}/v2/aggs/ticker/${ticker}/range/1/minute/${fromDate}/${toDate}?adjusted=true&sort=asc&limit=300&apiKey=${apiKey}`

  try {
    const response = await fetch(url)
    const data = await response.json()

    if (!response.ok) return res.status(response.status).json({ error: data.error || 'Polygon error' })

    const candles = (data.results || []).map(bar => ({
      time: Math.floor(bar.t / 1000), // convert ms to seconds for lightweight-charts
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
    }))

    res.setHeader('Cache-Control', 's-maxage=30')
    return res.status(200).json({ symbol, candles })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
