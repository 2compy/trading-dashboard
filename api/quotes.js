// Fetches live quotes for all futures from Yahoo Finance
// Uses v8 chart endpoint (v7 quote endpoint was deprecated/blocked)

const SYMBOL_MAP = {
  'MES1!': 'MES=F',
  'MNQ1!': 'MNQ=F',
  'MGC1!': 'MGC=F',
}

async function fetchQuote(ticker) {
  // Use v8 chart endpoint with 1d range to get current price data
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1m&range=1d&includePrePost=false`
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  })
  if (!response.ok) return null
  const data = await response.json()
  const result = data?.chart?.result?.[0]
  if (!result) return null

  const meta = result.meta || {}
  const timestamps = result.timestamp || []
  const quote = result.indicators?.quote?.[0] || {}
  const closes = quote.close || []

  // Get latest non-null close
  let latestPrice = meta.regularMarketPrice
  for (let i = closes.length - 1; i >= 0; i--) {
    if (closes[i] != null) { latestPrice = closes[i]; break }
  }

  return {
    price:         latestPrice ?? null,
    open:          meta.regularMarketOpen ?? (quote.open?.[0] ?? null),
    high:          meta.regularMarketDayHigh ?? null,
    low:           meta.regularMarketDayLow ?? null,
    close:         meta.previousClose ?? null,
    change:        latestPrice && meta.previousClose ? parseFloat((latestPrice - meta.previousClose).toFixed(4)) : null,
    changePercent: latestPrice && meta.previousClose ? parseFloat((((latestPrice - meta.previousClose) / meta.previousClose) * 100).toFixed(4)) : null,
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')

  try {
    const entries = Object.entries(SYMBOL_MAP)
    const results = await Promise.all(entries.map(([, ticker]) => fetchQuote(ticker)))

    const quotes = {}
    entries.forEach(([appSymbol], i) => {
      if (results[i]) quotes[appSymbol] = results[i]
    })

    if (Object.keys(quotes).length === 0) {
      return res.status(502).json({ error: 'No data from Yahoo Finance' })
    }

    res.setHeader('Cache-Control', 's-maxage=2, stale-while-revalidate')
    return res.status(200).json(quotes)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
