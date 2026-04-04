// Fetches OHLC candles from Yahoo Finance (free, no API key needed)
// Supports timeframes: 1m, 5m, 15m, 1h, 1d

const SYMBOL_MAP = {
  'MES1!': 'MES=F',
  'MNQ1!': 'MNQ=F',
  'MGC1!': 'MGC=F',
}

const RANGE_MAP = {
  '1m':  '7d',    // Yahoo Finance max for 1m
  '5m':  '60d',   // Yahoo Finance max for 5m
  '15m': '60d',   // Yahoo Finance max for 15m
  '1h':  '2y',
  '1d':  '2y',
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')

  const { symbol, timeframe = '1m' } = req.query
  const ticker = SYMBOL_MAP[symbol?.toUpperCase()]
  if (!ticker) return res.status(400).json({ error: 'Unknown symbol' })

  const interval = timeframe
  const range = RANGE_MAP[timeframe] || '1d'
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=false`

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    })
    const data = await response.json()

    const result = data?.chart?.result?.[0]
    if (!result) return res.status(502).json({ error: 'No data from Yahoo Finance' })

    const timestamps = result.timestamp || []
    const quote = result.indicators?.quote?.[0] || {}
    const { open, high, low, close } = quote

    const candles = []
    for (let i = 0; i < timestamps.length; i++) {
      if (close[i] == null) continue
      candles.push({
        time: timestamps[i],
        open:  parseFloat((open[i]  ?? close[i]).toFixed(4)),
        high:  parseFloat((high[i]  ?? close[i]).toFixed(4)),
        low:   parseFloat((low[i]   ?? close[i]).toFixed(4)),
        close: parseFloat(close[i].toFixed(4)),
      })
    }

    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate')
    return res.status(200).json({ symbol, candles })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
