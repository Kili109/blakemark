export type QuoteCcy = "BTC" | "USDT" | "USDC";

export type BookStatus = "ok" | "missing" | "error";

export type XbtBook = {
  id: string;
  venue: "Neoxa" | "NonKYC";
  pairLabel: string;
  quote: QuoteCcy;
  rawPrice: number | null;
  usdPrice: number | null;
  changePct: number | null;
  volumeUsd: number | null;
  bid: number | null;
  ask: number | null;
  tradeUrl: string;
  status: BookStatus;
  note: string | null;
};

export type VenuePrint = {
  name: string;
  price: number;
  changePct: number | null;
};

export type AssetKind = "tech" | "crypto" | "fund" | "fiat";

export const COMPARE_SPANS = ["24h", "1w", "1m"] as const;
export type CompareSpan = (typeof COMPARE_SPANS)[number];

export type AssetRow = {
  ticker: string;
  name: string;
  kind: AssetKind;
  price: number | null;
  changePct: number | null;
  changes: Record<CompareSpan, number | null>;
  spreadPct: number | null;
  spark: number[];
  sparkLabel: string;
  venues: VenuePrint[];
  caution: string | null;
};

export type BestPrice = {
  venue: XbtBook["venue"];
  quote: QuoteCcy;
  price: number;
  usd: number;
  tradeUrl: string;
  fromAsk: boolean;
};

export type Board = {
  asOf: number;
  session: string;
  fx: {
    btcUsd: number | null;
    btcChangePct: number | null;
    btcVenues: number;
    usdtUsd: number | null;
  };
  mark: {
    equalUsd: number | null;
    vwapUsd: number | null;
    changePct: number | null;
    booksUsed: number;
    btcAvg: number | null;
    btcVenues: number;
    usdtAvg: number | null;
    usdtVenues: number;
    usdcAvg: number | null;
    usdcVenues: number;
  };
  spans: Record<CompareSpan, number | null>;
  best: BestPrice | null;
  books: XbtBook[];
  assets: AssetRow[];
  warnings: string[];
};

export type Candle = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export type ChartPayload = {
  quote: QuoteCcy;
  interval: "15m" | "1h" | "4h" | "1d";
  pairLabel: string;
  source: string;
  candles: Candle[];
};
