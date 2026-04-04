// Fetches live quotes for all futures from Yahoo Finance

const SYMBOL_MAP = {
  'MES1!': 'MES=F',
  'MNQ1!': 'MNQ=F',
  'MGC1!': 'MGC=F',
  'SL1!': 'SIL=F',
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')

  const tickers = Object.values(SYMBOL_MAP).join(',')
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${tickers}`

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    })
    const data = await response.json()

    const results = data?.quoteResponse?.result || []
    const reverseMap = Object.fromEntries(Object.entries(SYMBOL_MAP).map(([k, v]) => [v, k]))

    const quotes = {}
    for (const item of results) {
      const appSymbol = reverseMap[item.symbol]
      if (!appSymbol) continue
      quotes[appSymbol] = {
        price:         item.regularMarketPrice ?? null,
        open:          item.regularMarketOpen ?? null,
        high:          item.regularMarketDayHigh ?? null,
        low:           item.regularMarketDayLow ?? null,
        close:         item.regularMarketPreviousClose ?? null,
        change:        item.regularMarketChange ?? null,
        changePercent: item.regularMarketChangePercent ?? null,
      }
    }

    res.setHeader('Cache-Control', 's-maxage=2, stale-while-revalidate')
    return res.status(200).json(quotes)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
