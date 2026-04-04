// Vercel serverless function — proxies Polygon.io snapshot quotes
// Keeps POLYGON_API_KEY secret on the server

const POLYGON_BASE = 'https://api.polygon.io'

// Map our app symbols to Polygon futures tickers
const SYMBOL_MAP = {
  ES: 'ES1!',   // S&P 500 E-mini continuous
  NQ: 'NQ1!',   // Nasdaq E-mini continuous
  CL: 'CL1!',   // Crude Oil continuous
  GC: 'GC1!',   // Gold continuous
  ZB: 'ZB1!',   // 30Y T-Bond continuous
  SI: 'SI1!',   // Silver continuous
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')

  const apiKey = process.env.POLYGON_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'POLYGON_API_KEY not configured' })
  }

  const symbols = Object.values(SYMBOL_MAP).join(',')
  const url = `${POLYGON_BASE}/v3/snapshot?ticker.any_of=${symbols}&apiKey=${apiKey}`

  try {
    const response = await fetch(url)
    const data = await response.json()

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error || 'Polygon error' })
    }

    // Normalize to { ES: { price, open, high, low, close, change }, ... }
    const reverseMap = Object.fromEntries(Object.entries(SYMBOL_MAP).map(([k, v]) => [v, k]))
    const quotes = {}

    for (const item of data.results || []) {
      const appSymbol = reverseMap[item.ticker]
      if (!appSymbol) continue
      const session = item.session || {}
      quotes[appSymbol] = {
        price: item.value ?? session.close ?? null,
        open: session.open ?? null,
        high: session.high ?? null,
        low: session.low ?? null,
        close: session.close ?? null,
        prevClose: session.previous_close ?? null,
        change: session.change ?? null,
        changePercent: session.change_percent ?? null,
      }
    }

    res.setHeader('Cache-Control', 's-maxage=1, stale-while-revalidate')
    return res.status(200).json(quotes)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
