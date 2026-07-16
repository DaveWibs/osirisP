export interface MarketQuote {
  price: number;
  change_percent: number;
  up: boolean;
}

export interface MarketsResponse {
  stocks: Record<string, MarketQuote>;
  oil: Record<string, MarketQuote>;
  commodities: Record<string, MarketQuote>;
  crypto: Record<string, MarketQuote>;
  indices: Record<string, MarketQuote>;
  scm_alerts: string[];
  timestamp: string;
}

const DEFENSE_STOCKS = new Set(['RTX', 'LMT', 'NOC', 'GD', 'BA', 'PLTR']);
const OIL_NAMES: Record<string, string> = { 'CL=F': 'WTI Crude', 'BZ=F': 'Brent Crude' };
const COMMODITY_NAMES: Record<string, string> = {
  'GC=F': 'Gold',
  'SI=F': 'Silver',
  'HG=F': 'Copper',
  'NG=F': 'Natural Gas',
  'ZW=F': 'Wheat',
  'ZC=F': 'Corn',
};
const CRYPTO_NAMES: Record<string, string> = { 'BTC-USD': 'Bitcoin', 'ETH-USD': 'Ethereum' };
const INDEX_NAMES: Record<string, string> = { 'ES=F': 'S&P 500', 'NQ=F': 'Nasdaq 100' };

export interface MarketObservation {
  symbol: string;
  displayName: string;
  price: number;
  changePercent: number;
  up: boolean;
}

function quote(observation: MarketObservation): MarketQuote {
  return {
    price: observation.price,
    change_percent: observation.changePercent,
    up: observation.up,
  };
}

export function buildMarketsResponse(
  observations: MarketObservation[],
  generatedAt: Date,
  scmAlerts: string[] = [],
): MarketsResponse {
  const stocks: Record<string, MarketQuote> = {};
  const oil: Record<string, MarketQuote> = {};
  const commodities: Record<string, MarketQuote> = {};
  const crypto: Record<string, MarketQuote> = {};
  const indices: Record<string, MarketQuote> = {};

  for (const observation of observations) {
    if (DEFENSE_STOCKS.has(observation.symbol)) {
      stocks[observation.symbol] = quote(observation);
    } else if (OIL_NAMES[observation.symbol] !== undefined) {
      oil[OIL_NAMES[observation.symbol]] = quote(observation);
    } else if (COMMODITY_NAMES[observation.symbol] !== undefined) {
      commodities[COMMODITY_NAMES[observation.symbol]] = quote(observation);
    } else if (CRYPTO_NAMES[observation.symbol] !== undefined) {
      crypto[CRYPTO_NAMES[observation.symbol]] = quote(observation);
    } else if (INDEX_NAMES[observation.symbol] !== undefined) {
      indices[INDEX_NAMES[observation.symbol]] = quote(observation);
    }
  }

  return {
    stocks,
    oil,
    commodities,
    crypto,
    indices,
    scm_alerts: scmAlerts,
    timestamp: generatedAt.toISOString(),
  };
}
