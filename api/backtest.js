// Fetches 1h, 5m, and 1m candles for a symbol in one call for backtesting

const SYMBOL_MAP = {
  'MES1!': 'MES=F',
  'MNQ1!': 'MNQ=F',
  'MGC1!': 'MGC=F',
  'MSL1!': 'SIL=F',
}

async function fetchTF(ticker, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=false`
  const res  = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  const data = await res.json()
  const result = data?.chart?.result?.[0]
  if (!result) return []

  const timestamps = result.timestamp || []
  const q = result.indicators?.quote?.[0] || {}
  const candles = []

  for (let i = 0; i < timestamps.length; i++) {
    if (q.close[i] == null) continue
    candles.push({
      time:  timestamps[i],
      open:  parseFloat((q.open[i]  ?? q.close[i]).toFixed(4)),
      high:  parseFloat((q.high[i]  ?? q.close[i]).toFixed(4)),
      low:   parseFloat((q.low[i]   ?? q.close[i]).toFixed(4)),
      close: parseFloat(q.close[i].toFixed(4)),
    })
  }

  return candles
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')

  const { symbol } = req.query
  const ticker = SYMBOL_MAP[symbol]
  if (!ticker) return res.status(400).json({ error: 'Unknown symbol' })

  try {
    const [candles1h, candles5m, candles1m] = await Promise.all([
      fetchTF(ticker, '1h',  '6mo'),
      fetchTF(ticker, '5m',  '60d'),
      fetchTF(ticker, '1m',  '7d'),
    ])

    res.setHeader('Cache-Control', 's-maxage=60')
    return res.status(200).json({ symbol, candles1h, candles5m, candles1m })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
