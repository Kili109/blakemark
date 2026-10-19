import type {
  AssetKind,
  AssetRow,
  BestPrice,
  Board,
  Candle,
  ChartPayload,
  CompareSpan,
  FinePrices,
  MarkHistory,
  QuoteCcy,
  VenuePrint,
  XbtBook,
} from "./types";

const UA = "Mozilla/5.0 (compatible; Blakemark/1.0)";
const TTL_MS = 20_000;
const COMPARE_TTL_MS = 10 * 60 * 1000;

type Print = { name: string; price: number; changePct: number | null };

type CryptoSpec = {
  ticker: string;
  name: string;
  kind: "crypto";
  yahoo: string;
  kraken?: string;
  coinbase?: string;
};

const CRYPTOS: CryptoSpec[] = [
  { ticker: "BTC", name: "Bitcoin", kind: "crypto", yahoo: "BTC-USD", kraken: "XBTUSD", coinbase: "BTC-USD" },
  { ticker: "ETH", name: "Ethereum", kind: "crypto", yahoo: "ETH-USD", kraken: "ETHUSD", coinbase: "ETH-USD" },
  { ticker: "SOL", name: "Solana", kind: "crypto", yahoo: "SOL-USD", kraken: "SOLUSD", coinbase: "SOL-USD" },
  { ticker: "XRP", name: "XRP", kind: "crypto", yahoo: "XRP-USD", kraken: "XRPUSD", coinbase: "XRP-USD" },
  { ticker: "BNB", name: "BNB", kind: "crypto", yahoo: "BNB-USD", kraken: "BNBUSD", coinbase: "BNB-USD" },
  { ticker: "ADA", name: "Cardano", kind: "crypto", yahoo: "ADA-USD", kraken: "ADAUSD", coinbase: "ADA-USD" },
  { ticker: "XMR", name: "Monero", kind: "crypto", yahoo: "XMR-USD", kraken: "XMRUSD" },
  { ticker: "BCH", name: "Bitcoin Cash", kind: "crypto", yahoo: "BCH-USD", kraken: "BCHUSD", coinbase: "BCH-USD" },
  { ticker: "BSV", name: "Bitcoin SV", kind: "crypto", yahoo: "BSV-USD" },
  { ticker: "BTG", name: "Bitcoin Gold", kind: "crypto", yahoo: "BTG-USD" },
];

const TECH: Array<[string, string]> = [
  ["NVDA", "NVIDIA"],
  ["AAPL", "Apple"],
  ["MSFT", "Microsoft"],
  ["AMZN", "Amazon"],
  ["GOOGL", "Alphabet"],
  ["META", "Meta"],
  ["AVGO", "Broadcom"],
  ["TSLA", "Tesla"],
];

const FUNDS: Array<[string, string]> = [
  ["SPY", "SPDR S&P 500"],
  ["VOO", "Vanguard S&P 500"],
  ["QQQ", "Invesco Nasdaq-100"],
  ["VTI", "Vanguard Total Market"],
  ["DIA", "SPDR Dow"],
  ["IWM", "iShares Russell 2000"],
];

const FIATS: Array<[string, string]> = [
  ["EUR", "Euro"],
  ["GBP", "Sterling"],
  ["JPY", "Yen"],
  ["CHF", "Franc"],
  ["CAD", "Canadian dollar"],
  ["AUD", "Australian dollar"],
  ["CNY", "Yuan"],
  ["INR", "Rupee"],
];

const EQUITIES = [
  ...TECH.map(([ticker, name]) => ({ ticker, name, kind: "tech" as const })),
  ...FUNDS.map(([ticker, name]) => ({ ticker, name, kind: "fund" as const })),
];

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(/[$,%+\s]/g, "").replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function downsample(values: number[], max = 36): number[] {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length <= max) return clean;
  const out: number[] = [];
  for (let i = 0; i < max; i++) {
    const idx = Math.round((i * (clean.length - 1)) / (max - 1));
    out.push(clean[idx] ?? clean[clean.length - 1]!);
  }
  return out;
}

async function getJson(url: string, ms = 9000): Promise<unknown> {
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": UA },
    signal: AbortSignal.timeout(ms),
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

async function grab<T>(work: Promise<T>): Promise<T | null> {
  try {
    return await work;
  } catch {
    return null;
  }
}

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function nySession(now: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const wd = parts.weekday ?? "";
  const mins = Number(parts.hour ?? "0") * 60 + Number(parts.minute ?? "0");
  if (wd === "Sat" || wd === "Sun") return "US market closed";
  if (mins >= 9 * 60 + 30 && mins < 16 * 60) return "US regular session";
  if (mins >= 4 * 60 && mins < 9 * 60 + 30) return "US premarket";
  if (mins >= 16 * 60 && mins < 20 * 60) return "US after hours";
  return "US market closed";
}

async function kraken(pair: string): Promise<Print | null> {
  const body = rec(await getJson(`https://api.kraken.com/0/public/Ticker?pair=${pair}`));
  const result = rec(body?.result);
  const row = result ? rec(Object.values(result)[0]) : null;
  if (!row) return null;
  const last = Array.isArray(row.c) ? num(row.c[0]) : null;
  const open = num(row.o);
  if (last == null) return null;
  const changePct = open && open > 0 ? ((last - open) / open) * 100 : null;
  return { name: "Kraken", price: last, changePct };
}

async function krakenMany(pairs: Array<{ ticker: string; pair: string }>): Promise<Array<{ ticker: string; print: Print }>> {
  const body = rec(await getJson(`https://api.kraken.com/0/public/Ticker?pair=${pairs.map((item) => item.pair).join(",")}`));
  const result = rec(body?.result);
  if (!result) return [];
  const alias: Record<string, string> = {
    XXBTZUSD: "BTC",
    XBTUSD: "BTC",
    XETHZUSD: "ETH",
    ETHUSD: "ETH",
    SOLUSD: "SOL",
    XXRPZUSD: "XRP",
    XRPUSD: "XRP",
    BNBUSD: "BNB",
    ADAUSD: "ADA",
    XXMRZUSD: "XMR",
    XMRUSD: "XMR",
    BCHUSD: "BCH",
  };
  const out: Array<{ ticker: string; print: Print }> = [];
  for (const [key, value] of Object.entries(result)) {
    const ticker = alias[key];
    const row = rec(value);
    if (!ticker || !row) continue;
    const last = Array.isArray(row.c) ? num(row.c[0]) : null;
    const open = num(row.o);
    if (last == null) continue;
    const changePct = open && open > 0 ? ((last - open) / open) * 100 : null;
    out.push({ ticker, print: { name: "Kraken", price: last, changePct } });
  }
  return out;
}

const BITSTAMP: Record<string, string> = {
  "BTC/USD": "BTC",
  "ETH/USD": "ETH",
  "SOL/USD": "SOL",
  "XRP/USD": "XRP",
  "BNB/USD": "BNB",
  "ADA/USD": "ADA",
  "BCH/USD": "BCH",
};

async function bitstamp(): Promise<Array<{ ticker: string; print: Print }>> {
  const list = arr(await getJson("https://www.bitstamp.net/api/v2/ticker/"));
  const out: Array<{ ticker: string; print: Print }> = [];
  for (const item of list) {
    const row = rec(item);
    const ticker = typeof row?.pair === "string" ? BITSTAMP[row.pair] : undefined;
    const last = num(row?.last);
    if (!ticker || last == null) continue;
    out.push({ ticker, print: { name: "Bitstamp", price: last, changePct: num(row?.percent_change_24) } });
  }
  return out;
}

async function coinbase(product: string): Promise<Print | null> {
  const row = rec(await getJson(`https://api.exchange.coinbase.com/products/${product}/stats`));
  const last = num(row?.last);
  const open = num(row?.open);
  if (last == null) return null;
  const changePct = open && open > 0 ? ((last - open) / open) * 100 : null;
  return { name: "Coinbase", price: last, changePct };
}

function summarize(prints: Print[], spreadWarn: number): {
  price: number | null;
  changePct: number | null;
  spreadPct: number | null;
} {
  const prices = prints.map((p) => p.price).filter((p) => p > 0);
  const price = mean(prices);
  const changes = prints.map((p) => p.changePct).filter((n): n is number => n != null);
  const min = prices.length ? Math.min(...prices) : null;
  const max = prices.length ? Math.max(...prices) : null;
  const spreadPct = price && min != null && max != null ? ((max - min) / price) * 100 : null;
  return {
    price,
    changePct: mean(changes),
    spreadPct: spreadPct != null && spreadPct >= spreadWarn ? spreadPct : spreadPct,
  };
}

function cautionFor(venues: number, spreadPct: number | null, threshold: number, extra: string | null): string | null {
  const bits: string[] = [];
  if (venues === 1) bits.push("Only one market had a price for this.");
  if (spreadPct != null && spreadPct >= threshold) {
    bits.push(`Those prices disagree by ${spreadPct.toFixed(1)}%.`);
  }
  if (extra) bits.push(extra);
  return bits.length ? bits.join(" ") : null;
}

type YahooPoint = {
  price: number | null;
  changePct: number | null;
  spark: number[];
  daily: Array<{ t: number; c: number }>;
  weekPct: number | null;
  monthPct: number | null;
};

function changeOver(points: Array<{ t: number; c: number }>, days: number, nowPrice?: number): number | null {
  if (!points.length) return null;
  const last = points[points.length - 1]!;
  const now = nowPrice ?? last.c;
  const target = last.t - days * 86400;
  let pick: { t: number; c: number } | null = null;
  for (const point of points) {
    if (point.t <= target) pick = point;
  }
  if (!pick && last.t - points[0]!.t >= days * 86400 * 0.75) pick = points[0]!;
  if (!pick || pick.t >= last.t || pick.c <= 0 || now <= 0) return null;
  if (last.t - pick.t < days * 86400 * 0.7) return null;
  return ((now - pick.c) / pick.c) * 100;
}

function changesFor(day: number | null, week: number | null, month: number | null): Record<CompareSpan, number | null> {
  return { "24h": day, "1w": week, "1m": month };
}

function dailyCloses(points: Array<{ t: number; c: number }>): Array<{ t: number; c: number }> {
  const map = new Map<number, number>();
  for (const point of points) {
    if (point.c <= 0) continue;
    const ms = point.t > 1e12 ? point.t : point.t * 1000;
    const day = new Date(ms);
    map.set(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()), point.c);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([t, c]) => ({ t, c }));
}

async function loadYahoo(symbols: string[]): Promise<Map<string, YahooPoint>> {
  const url =
    "https://query1.finance.yahoo.com/v7/finance/spark?symbols=" +
    symbols.join(",") +
    "&range=1mo&interval=1d";
  const body = rec(await getJson(url, 12000));
  const spark = rec(body?.spark);
  const map = new Map<string, YahooPoint>();
  for (const item of arr(spark?.result)) {
    const row = rec(item);
    const symbol = typeof row?.symbol === "string" ? row.symbol : null;
    const response = rec(arr(row?.response)[0]);
    const meta = rec(response?.meta);
    const quote = rec(arr(rec(response?.indicators)?.quote)[0]);
    const times = arr(response?.timestamp).map(num);
    const rawCloses = arr(quote?.close);
    const points: Array<{ t: number; c: number }> = [];
    for (let i = 0; i < rawCloses.length; i += 1) {
      const close = num(rawCloses[i]);
      const time = times[i];
      if (close != null && time != null) points.push({ t: time, c: close });
    }
    if (!symbol) continue;
    map.set(symbol, {
      price: num(meta?.regularMarketPrice),
      changePct: num(meta?.regularMarketChangePercent),
      spark: downsample(points.map((point) => point.c)),
      daily: dailyCloses(points),
      weekPct: changeOver(points, 7),
      monthPct: changeOver(points, 30),
    });
  }
  return map;
}

async function loadYahooMany(symbols: string[]): Promise<Map<string, YahooPoint>> {
  const merged = new Map<string, YahooPoint>();
  const chunks: string[][] = [];
  for (let i = 0; i < symbols.length; i += 18) chunks.push(symbols.slice(i, i + 18));
  const parts = await Promise.all(chunks.map((chunk) => grab(loadYahoo(chunk))));
  for (const part of parts) {
    if (!part) continue;
    for (const [key, value] of part) merged.set(key, value);
  }
  return merged;
}

async function loadCnbc(symbols: string[]): Promise<Map<string, Print>> {
  const url =
    "https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=" +
    symbols.join("|") +
    "&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json";
  const body = rec(await getJson(url));
  const result = rec(body?.FormattedQuoteResult);
  const raw = result?.FormattedQuote;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const map = new Map<string, Print>();
  for (const item of list) {
    const row = rec(item);
    const symbol = typeof row?.symbol === "string" ? row.symbol : null;
    const price = num(row?.last);
    if (!symbol || price == null) continue;
    map.set(symbol, { name: "CNBC", price, changePct: num(row?.change_pct) });
  }
  return map;
}

type FiatPoint = { price: number; changes: Record<CompareSpan, number | null>; spark: number[]; daily: Array<{ t: number; c: number }> };

async function loadFiat(): Promise<Map<string, FiatPoint> | null> {
  const codes = FIATS.map(([code]) => code).join(",");
  const start = new Date(Date.now() - 130 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const body = rec(await getJson(`https://api.frankfurter.dev/v1/${start}..?from=USD&to=${codes}`, 12000));
  const rates = rec(body?.rates);
  if (!rates) return null;
  const days = Object.keys(rates).sort();
  const out = new Map<string, FiatPoint>();
  for (const [code] of FIATS) {
    const points: Array<{ t: number; c: number }> = [];
    for (const day of days) {
      const perDollar = num(rec(rates[day])?.[code]);
      if (perDollar == null || perDollar <= 0) continue;
      points.push({ t: Date.parse(day) / 1000, c: 1 / perDollar });
    }
    const price = points.at(-1)?.c;
    if (price == null) continue;
    out.set(code, {
      price,
      changes: changesFor(changeOver(points, 1), changeOver(points, 7), changeOver(points, 30)),
      spark: points.map((point) => point.c),
      daily: dailyCloses(points),
    });
  }
  return out.size ? out : null;
}

type CompareSlice = { assets: AssetRow[]; warnings: string[] };

async function buildCompare(): Promise<CompareSlice> {
  const symbols = [...EQUITIES.map((e) => e.ticker), ...CRYPTOS.map((c) => c.yahoo)];
  const warnings: string[] = [];
  const krakenPairs = CRYPTOS.filter((coin) => coin.kraken).map((coin) => ({ ticker: coin.ticker, pair: coin.kraken! }));
  const coinbaseJobs = CRYPTOS.filter((coin) => coin.coinbase).map(async (coin) => ({
    ticker: coin.ticker,
    print: await grab(coinbase(coin.coinbase!)),
  }));

  const [yahoo, cnbc, fiat, krakenPrints, coinbasePrints, bitstampPrints] = await Promise.all([
    loadYahooMany(symbols),
    grab(loadCnbc(EQUITIES.map((e) => e.ticker))),
    grab(loadFiat()),
    grab(krakenMany(krakenPairs)),
    Promise.all(coinbaseJobs),
    grab(bitstamp()),
  ]);

  const direct = new Map<string, Print[]>();
  for (const row of [...(krakenPrints ?? []), ...coinbasePrints, ...(bitstampPrints ?? [])]) {
    if (!row.print) continue;
    const list = direct.get(row.ticker) ?? [];
    list.push(row.print);
    direct.set(row.ticker, list);
  }

  const assets: AssetRow[] = [];
  for (const spec of CRYPTOS) {
    const prints = [...(direct.get(spec.ticker) ?? [])];
    const shape = yahoo.get(spec.yahoo);
    if (!prints.length && shape?.price != null) {
      prints.push({ name: "Yahoo", price: shape.price, changePct: shape.changePct });
    }
    const summary = summarize(prints, 8);
    const yahooOnly = prints.length === 1 && prints[0]?.name === "Yahoo";
    assets.push({
      ticker: spec.ticker,
      name: spec.name,
      kind: spec.kind,
      price: summary.price,
      changePct: summary.changePct,
      changes: changesFor(summary.changePct, shape?.weekPct ?? null, shape?.monthPct ?? null),
      spreadPct: summary.spreadPct,
      spark: shape?.spark ?? [],
      sparkLabel: "1m",
      daily: shape?.daily ?? [],
      venues: prints.map((p) => ({ name: p.name, price: p.price, changePct: p.changePct })),
      caution: yahooOnly ? "A backup quote. The usual exchanges do not list this." : cautionFor(prints.length, summary.spreadPct, 2, null),
    });
  }

  for (const spec of EQUITIES) {
    const prints: Print[] = [];
    const cn = cnbc?.get(spec.ticker);
    if (cn) prints.push(cn);
    const yh = yahoo?.get(spec.ticker);
    if (yh?.price != null) prints.push({ name: "Yahoo", price: yh.price, changePct: yh.changePct });
    const summary = summarize(prints, 1.5);
    assets.push({
      ticker: spec.ticker,
      name: spec.name,
      kind: spec.kind satisfies AssetKind,
      price: summary.price,
      changePct: summary.changePct,
      changes: changesFor(summary.changePct, yh?.weekPct ?? null, yh?.monthPct ?? null),
      spreadPct: summary.spreadPct,
      spark: yh?.spark ?? [],
      sparkLabel: "1m",
      daily: yh?.daily ?? [],
      venues: prints.map((p) => ({ name: p.name, price: p.price, changePct: p.changePct })),
      caution: cautionFor(prints.length, summary.spreadPct, 1, null),
    });
  }
  if (yahoo.size === 0) warnings.push("Yahoo charts did not respond.");
  if (!cnbc) warnings.push("CNBC quotes did not respond.");
  if (!fiat) warnings.push("Currency rates did not respond.");
  for (const [ticker, name] of FIATS) {
    const row = fiat?.get(ticker);
    assets.push({
      ticker,
      name,
      kind: "fiat",
      price: row?.price ?? null,
      changePct: row?.changes["24h"] ?? null,
      changes: row?.changes ?? changesFor(null, null, null),
      spreadPct: null,
      spark: row?.spark ?? [],
      sparkLabel: "1m",
      daily: row?.daily ?? [],
      venues: row ? [{ name: "ECB", price: row.price, changePct: row.changes["24h"] }] : [],
      caution: null,
    });
  }
  return { assets, warnings };
}

let compareCache: { at: number; data: CompareSlice } | null = null;
let compareFlight: Promise<CompareSlice> | null = null;

function loadCompare(): Promise<CompareSlice> {
  if (compareCache && Date.now() - compareCache.at < COMPARE_TTL_MS) return Promise.resolve(compareCache.data);
  if (!compareFlight) {
    compareFlight = buildCompare()
      .then((data) => {
        compareCache = { at: Date.now(), data };
        return data;
      })
      .catch(() => {
        if (compareCache) return compareCache.data;
        return { assets: [] as AssetRow[], warnings: ["Comparison quotes did not respond."] };
      })
      .finally(() => {
        compareFlight = null;
      });
  }
  return compareFlight;
}

async function buildBoard(): Promise<Board> {
  const warnings: string[] = [];

  const [
    neoxBody,
    nkUsdt,
    nkBtc,
    depthUsdc,
    depthUsdt,
    depthBtc,
    btcCb,
    btcKr,
    usdtCb,
    usdtKr,
    compare,
  ] = await Promise.all([
    grab(getJson("https://neoxa.exchange/api/exchange/tickers")),
    grab(getJson("https://api.nonkyc.io/api/v2/market/getbysymbol/BTCB2_USDT")),
    grab(getJson("https://api.nonkyc.io/api/v2/market/getbysymbol/BTCB2_BTC")),
    grab(neoxBook("BTCB2_USDC")),
    grab(neoxBook("BTCB2_USDT")),
    grab(neoxBook("BTCB2_BTC")),
    grab(coinbase("BTC-USD")),
    grab(kraken("XBTUSD")),
    grab(coinbase("USDT-USD")),
    grab(kraken("USDTUSD")),
    loadCompare(),
  ]);

  const btcPrints = [btcCb, btcKr].filter((p): p is Print => p != null && p.price > 0);
  const btcSummary = summarize(btcPrints, 3);
  const usdtPrints = [usdtCb, usdtKr].filter((p): p is Print => p != null && p.price > 0);
  const usdtUsd = mean(usdtPrints.map((p) => p.price));

  if (btcSummary.price == null) warnings.push("No BTC/USD reference, so BTC-quoted XBT books stay out of the dollar mark.");
  if (usdtUsd == null) warnings.push("No USDT/USD rate. USDT books are left unscaled.");

  const nk = new Map<QuoteCcy, Record<string, unknown> | null>();
  if (nkUsdt) nk.set("USDT", rec(nkUsdt));
  if (nkBtc) nk.set("BTC", rec(nkBtc));
  if (!nkUsdt && !nkBtc) warnings.push("NonKYC did not respond.");
  if (!neoxBody) warnings.push("Neoxa did not respond.");

  const books = buildXbtBooks({
    neox: neoxBody ? parseNeox(neoxBody) : null,
    nk,
    depth: new Map([
      ["BTCB2_USDC", depthUsdc],
      ["BTCB2_USDT", depthUsdt],
      ["BTCB2_BTC", depthBtc],
    ]),
    btcUsd: btcSummary.price,
    usdtUsd,
  });

  const usable = books.filter((b) => b.status === "ok" && b.usdPrice != null && b.usdPrice > 0);
  if (!usable.length) {
    throw new Error("Neoxa and NonKYC did not return a usable XBT / BTCB2 price.");
  }

  const equalUsd = mean(usable.map((b) => b.usdPrice!));
  let volSum = 0;
  let volPx = 0;
  for (const book of usable) {
    const vol = book.volumeUsd ?? 0;
    if (vol > 0 && book.usdPrice != null) {
      volSum += vol;
      volPx += vol * book.usdPrice;
    }
  }
  const vwapUsd = volSum > 0 ? volPx / volSum : null;
  const btcAvg = quoteAverage(books, "BTC");
  const usdtAvg = quoteAverage(books, "USDT");
  const usdcAvg = quoteAverage(books, "USDC");
  const dayPct = mean(
    usable
      .map((book) => usdChange(book.quote, book.changePct, btcSummary.changePct))
      .filter((n): n is number => n != null),
  );
  const liveUsdt = books.find((book) => book.venue === "Neoxa" && book.quote === "USDT" && book.status === "ok")?.rawPrice ?? null;
  const longer = (await grab(xbtSpanChanges(liveUsdt))) ?? changesFor(null, null, null);

  const now = new Date();
  return {
    asOf: now.getTime(),
    session: nySession(now),
    fx: {
      btcUsd: btcSummary.price,
      btcChangePct: btcSummary.changePct,
      btcVenues: btcPrints.length,
      usdtUsd,
    },
    mark: {
      equalUsd,
      vwapUsd,
      changePct: dayPct,
      booksUsed: usable.length,
      btcAvg: btcAvg.avg,
      btcVenues: btcAvg.venues,
      usdtAvg: usdtAvg.avg,
      usdtVenues: usdtAvg.venues,
      usdcAvg: usdcAvg.avg,
      usdcVenues: usdcAvg.venues,
    },
    spans: { ...longer, "24h": dayPct },
    books,
    best: bestBuy(books),
    assets: compare.assets,
    warnings,
  };
}

type NeoxTicker = {
  pair: string;
  lastPrice: number | null;
  changePercent24h: number | null;
  quoteVolume24h: number | null;
};

function parseNeox(body: unknown): Map<string, NeoxTicker> {
  const root = rec(body);
  const map = new Map<string, NeoxTicker>();
  for (const item of arr(root?.tickers)) {
    const row = rec(item);
    const pair = typeof row?.pair === "string" ? row.pair : null;
    if (!pair) continue;
    map.set(pair, {
      pair,
      lastPrice: num(row?.lastPrice),
      changePercent24h: num(row?.changePercent24h),
      quoteVolume24h: num(row?.quoteVolume24h),
    });
  }
  return map;
}

function bestOf(levels: unknown[], side: "bid" | "ask"): number | null {
  const prices = arr(levels)
    .map((level) => num(rec(level)?.price))
    .filter((n): n is number => n != null && n > 0);
  if (!prices.length) return null;
  return side === "bid" ? Math.max(...prices) : Math.min(...prices);
}

async function neoxBook(pair: string): Promise<{ bid: number | null; ask: number | null } | null> {
  const body = rec(await getJson(`https://neoxa.exchange/api/exchange/orderbook/${pair}`));
  if (!body) return null;
  return { bid: bestOf(arr(body.bids), "bid"), ask: bestOf(arr(body.asks), "ask") };
}

function usdChange(quote: QuoteCcy, bookChange: number | null, btcChange: number | null): number | null {
  if (bookChange == null) return null;
  if (quote !== "BTC") return bookChange;
  if (btcChange == null) return null;
  return ((1 + bookChange / 100) * (1 + btcChange / 100) - 1) * 100;
}

function buildXbtBooks(input: {
  neox: Map<string, NeoxTicker> | null;
  nk: Map<QuoteCcy, Record<string, unknown> | null>;
  depth: Map<string, { bid: number | null; ask: number | null } | null>;
  btcUsd: number | null;
  usdtUsd: number | null;
}): XbtBook[] {
  const specs: Array<{
    id: string;
    venue: "Neoxa" | "NonKYC";
    pair: string;
    quote: QuoteCcy;
    url: string;
  }> = [
    { id: "nx-usdc", venue: "Neoxa", pair: "BTCB2_USDC", quote: "USDC", url: "https://neoxa.exchange/trade/BTCB2_USDC" },
    { id: "nx-usdt", venue: "Neoxa", pair: "BTCB2_USDT", quote: "USDT", url: "https://neoxa.exchange/trade/BTCB2_USDT" },
    { id: "nx-btc", venue: "Neoxa", pair: "BTCB2_BTC", quote: "BTC", url: "https://neoxa.exchange/trade/BTCB2_BTC" },
    { id: "nk-usdt", venue: "NonKYC", pair: "BTCB2_USDT", quote: "USDT", url: "https://nonkyc.io/market/BTCB2_USDT" },
    { id: "nk-btc", venue: "NonKYC", pair: "BTCB2_BTC", quote: "BTC", url: "https://nonkyc.io/market/BTCB2_BTC" },
  ];

  return specs.map((spec) => {
    const pairLabel = `${spec.venue === "Neoxa" ? "XBT" : "BTCB2"}/${spec.quote}`;
    const base: XbtBook = {
      id: spec.id,
      venue: spec.venue,
      pairLabel,
      quote: spec.quote,
      rawPrice: null,
      usdPrice: null,
      changePct: null,
      volumeUsd: null,
      bid: null,
      ask: null,
      tradeUrl: spec.url,
      status: "missing",
      note: null,
    };

    if (spec.venue === "Neoxa") {
      if (!input.neox) {
        return { ...base, status: "error", note: "Neoxa did not respond." };
      }
      const row = input.neox.get(spec.pair);
      if (!row || row.lastPrice == null || row.lastPrice <= 0) {
        return { ...base, note: "No active book." };
      }
      const fx = spec.quote === "BTC" ? input.btcUsd : spec.quote === "USDT" ? input.usdtUsd : 1;
      const depth = input.depth.get(spec.pair);
      const usd = fx != null ? row.lastPrice * fx : null;
      return {
        ...base,
        status: "ok",
        rawPrice: row.lastPrice,
        usdPrice: usd,
        changePct: row.changePercent24h,
        volumeUsd: row.quoteVolume24h != null && fx != null ? row.quoteVolume24h * fx : null,
        bid: depth?.bid ?? null,
        ask: depth?.ask ?? null,
        note: fx == null ? "Waiting on a dollar rate for this quote." : null,
      };
    }

    const row = input.nk.get(spec.quote);
    if (row === undefined) {
      return { ...base, status: "error", note: "NonKYC did not respond." };
    }
    if (!row || row.error) {
      return { ...base, note: "No active book." };
    }
    const last = num(row.lastPriceNumber ?? row.lastPrice);
    if (last == null || last <= 0) return { ...base, note: "No last trade." };
    const fx = spec.quote === "BTC" ? input.btcUsd : spec.quote === "USDT" ? input.usdtUsd : 1;
    const change = num(row.changePercentNumber ?? row.changePercent);
    const traded = num(row.lastTradeAt);
    const stale =
      traded != null && Date.now() - traded > 6 * 60 * 60 * 1000 ? "Last trade is more than 6 hours old." : null;
    return {
      ...base,
      status: "ok",
      rawPrice: last,
      usdPrice: fx != null ? last * fx : null,
      changePct: change,
      volumeUsd: num(row.volumeUsdNumber),
      bid: num(row.bestBidNumber ?? row.bestBid),
      ask: num(row.bestAskNumber ?? row.bestAsk),
      note: fx == null ? "Waiting on a dollar rate for this quote." : stale,
    };
  });
}

function quoteAverage(books: XbtBook[], quote: QuoteCcy): { avg: number | null; venues: number } {
  const live = books.filter((b) => b.status === "ok" && b.quote === quote && b.rawPrice != null);
  return { avg: mean(live.map((b) => b.rawPrice!)), venues: live.length };
}

function bestBuy(books: XbtBook[]): BestPrice | null {
  let best: BestPrice | null = null;
  for (const book of books) {
    if (book.status !== "ok" || book.rawPrice == null || book.rawPrice <= 0) continue;
    if (book.usdPrice == null || book.usdPrice <= 0) continue;
    if (best && book.usdPrice >= best.usd) continue;
    best = {
      venue: book.venue,
      quote: book.quote,
      price: book.rawPrice,
      usd: book.usdPrice,
      tradeUrl: book.tradeUrl,
      fromAsk: false,
    };
  }
  return best;
}

const xbtCandleCache: { at: number; points: Array<{ t: number; c: number }> } = { at: 0, points: [] };

async function xbtSpanChanges(liveUsdt: number | null): Promise<Record<CompareSpan, number | null>> {
  if (Date.now() - xbtCandleCache.at > COMPARE_TTL_MS) {
    const body = rec(await getJson("https://neoxa.exchange/api/exchange/candles/BTCB2_USDT?interval=1d&limit=120"));
    const points = arr(body?.candles)
      .map((item) => {
        const row = rec(item);
        const t = num(row?.time);
        const c = num(row?.close);
        if (t == null || c == null || c <= 0) return null;
        return { t, c };
      })
      .filter((point): point is { t: number; c: number } => point != null)
      .sort((a, b) => a.t - b.t);
    if (points.length) xbtCandleCache.points = points;
    xbtCandleCache.at = Date.now();
  }
  const now = liveUsdt ?? xbtCandleCache.points.at(-1)?.c ?? null;
  return changesFor(
    null,
    now == null ? null : changeOver(xbtCandleCache.points, 7, now),
    now == null ? null : changeOver(xbtCandleCache.points, 30, now),
  );
}
let boardCache: { at: number; data: Board } | null = null;
let boardFlight: Promise<Board> | null = null;

export function loadBoard(): Promise<Board> {
  if (boardCache && Date.now() - boardCache.at < TTL_MS) return Promise.resolve(boardCache.data);
  if (!boardFlight) {
    boardFlight = buildBoard()
      .then((data) => {
        boardCache = { at: Date.now(), data };
        return data;
      })
      .finally(() => {
        boardFlight = null;
      });
  }
  return boardFlight;
}

const HISTORY_TTL_MS = 60 * 60 * 1000;
let historyCache: { at: number; data: MarkHistory } | null = null;

function dayKey(ms: number): number {
  const day = new Date(ms);
  return Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
}

function neoxDays(body: unknown): Map<number, number> {
  const map = new Map<number, number>();
  for (const item of arr(rec(body)?.candles)) {
    const row = rec(item);
    const t = num(row?.time);
    const c = num(row?.close);
    if (t == null || c == null || c <= 0) continue;
    map.set(dayKey(t * 1000), c);
  }
  return map;
}

function nonkycDays(body: unknown): Map<number, number> {
  const map = new Map<number, number>();
  for (const item of arr(rec(body)?.bars)) {
    const row = rec(item);
    const t = num(row?.time);
    const c = num(row?.close);
    if (t == null || c == null || c <= 0) continue;
    map.set(dayKey(t > 1e12 ? t : t * 1000), c);
  }
  return map;
}

function coinbaseDays(body: unknown): Map<number, number> {
  const map = new Map<number, number>();
  for (const item of arr(body)) {
    if (!Array.isArray(item)) continue;
    const t = num(item[0]);
    const c = num(item[4]);
    if (t == null || c == null || c <= 0) continue;
    map.set(dayKey(t * 1000), c);
  }
  return map;
}


const FINE_TTL_MS = 5 * 60 * 1000;

function rememberClose(map: Map<number, number>, time: number | null, close: number | null, step: number) {
  if (time == null || close == null || close <= 0) return;
  const ms = time > 1e12 ? time : time * 1000;
  map.set(Math.floor(ms / step) * step, close);
}

function neoxFine(body: unknown, step: number): Map<number, number> {
  const map = new Map<number, number>();
  for (const item of arr(rec(body)?.candles)) {
    const row = rec(item);
    rememberClose(map, num(row?.time), num(row?.close), step);
  }
  return map;
}

function nonkycFine(body: unknown, step: number): Map<number, number> {
  const map = new Map<number, number>();
  for (const item of arr(rec(body)?.bars)) {
    const row = rec(item);
    rememberClose(map, num(row?.time), num(row?.close), step);
  }
  return map;
}

function coinbaseFine(body: unknown, step: number): Map<number, number> {
  const map = new Map<number, number>();
  for (const item of arr(body)) {
    if (!Array.isArray(item)) continue;
    rememberClose(map, num(item[0]), num(item[4]), step);
  }
  return map;
}

function carried(map: Map<number, number>, times: number[], t: number, cursor: { i: number; rate: number | null }): number | null {
  while (cursor.i < times.length && times[cursor.i]! <= t) {
    cursor.rate = map.get(times[cursor.i]!) ?? cursor.rate;
    cursor.i += 1;
  }
  return cursor.rate;
}

async function loadFineMark(hourly: boolean): Promise<Array<{ t: number; c: number }>> {
  const step = hourly ? 60 * 60 * 1000 : 15 * 60 * 1000;
  const now = Math.floor(Date.now() / 1000);
  const from = now - (hourly ? 8 : 5) * 86400;
  const gran = hourly ? 3600 : 900;
  const coinbase = hourly
    ? [
        grab(getJson(`https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=${gran}&start=${now - 300 * gran}&end=${now}`)),
        grab(getJson(`https://api.exchange.coinbase.com/products/USDT-USD/candles?granularity=${gran}&start=${now - 300 * gran}&end=${now}`)),
      ]
    : [
        grab(getJson(`https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=${gran}&start=${now - 300 * gran}&end=${now}`)),
        grab(getJson(`https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=${gran}&start=${now - 600 * gran}&end=${now - 300 * gran}`)),
        grab(getJson(`https://api.exchange.coinbase.com/products/USDT-USD/candles?granularity=${gran}&start=${now - 300 * gran}&end=${now}`)),
        grab(getJson(`https://api.exchange.coinbase.com/products/USDT-USD/candles?granularity=${gran}&start=${now - 600 * gran}&end=${now - 300 * gran}`)),
      ];
  const [nxUsdc, nxUsdt, nxBtc, nkUsdt, nkBtc, ...fxBodies] = await Promise.all([
    grab(getJson(`https://neoxa.exchange/api/exchange/candles/BTCB2_USDC?interval=${hourly ? "1h" : "15m"}&limit=${hourly ? 200 : 500}`)),
    grab(getJson(`https://neoxa.exchange/api/exchange/candles/BTCB2_USDT?interval=${hourly ? "1h" : "15m"}&limit=${hourly ? 200 : 500}`)),
    grab(getJson(`https://neoxa.exchange/api/exchange/candles/BTCB2_BTC?interval=${hourly ? "1h" : "15m"}&limit=${hourly ? 200 : 500}`)),
    grab(getJson(`https://api.nonkyc.io/api/v2/market/candles?symbol=BTCB2_USDT&resolution=${hourly ? 60 : 15}&from=${from}&to=${now}`)),
    grab(getJson(`https://api.nonkyc.io/api/v2/market/candles?symbol=BTCB2_BTC&resolution=${hourly ? 60 : 15}&from=${from}&to=${now}`)),
    ...coinbase,
  ]);
  const usdc = neoxFine(nxUsdc, step);
  const neoxUsdt = neoxFine(nxUsdt, step);
  const neoxBtc = neoxFine(nxBtc, step);
  const nonkycUsdt = nonkycFine(nkUsdt, step);
  const nonkycBtc = nonkycFine(nkBtc, step);
  const btcUsd = new Map<number, number>();
  const usdtUsd = new Map<number, number>();
  fxBodies.forEach((body, index) => {
    const parsed = coinbaseFine(body, step);
    const target = hourly ? (index === 0 ? btcUsd : usdtUsd) : index < 2 ? btcUsd : usdtUsd;
    for (const [time, price] of parsed) target.set(time, price);
  });
  const btcTimes = [...btcUsd.keys()].sort((a, b) => a - b);
  const usdtTimes = [...usdtUsd.keys()].sort((a, b) => a - b);
  const btcCursor = { i: 0, rate: null as number | null };
  const usdtCursor = { i: 0, rate: null as number | null };
  const buckets = [...new Set<number>([...usdc.keys(), ...neoxUsdt.keys(), ...neoxBtc.keys(), ...nonkycUsdt.keys(), ...nonkycBtc.keys()])].sort(
    (a, b) => a - b,
  );
  const points: Array<{ t: number; c: number }> = [];
  for (const t of buckets) {
    const prices: number[] = [];
    const usdcClose = usdc.get(t);
    if (usdcClose != null) prices.push(usdcClose);
    const usdtFx = carried(usdtUsd, usdtTimes, t, usdtCursor) ?? 1;
    const neoxUsdtClose = neoxUsdt.get(t);
    if (neoxUsdtClose != null) prices.push(neoxUsdtClose * usdtFx);
    const nonkycUsdtClose = nonkycUsdt.get(t);
    if (nonkycUsdtClose != null) prices.push(nonkycUsdtClose * usdtFx);
    const btcFx = carried(btcUsd, btcTimes, t, btcCursor);
    if (btcFx != null) {
      const neoxBtcClose = neoxBtc.get(t);
      if (neoxBtcClose != null) prices.push(neoxBtcClose * btcFx);
      const nonkycBtcClose = nonkycBtc.get(t);
      if (nonkycBtcClose != null) prices.push(nonkycBtcClose * btcFx);
    }
    if (!prices.length) continue;
    points.push({ t, c: prices.reduce((sum, price) => sum + price, 0) / prices.length });
  }
  return points;
}

async function loadYahooFine(
  jobs: Array<{ ticker: string; symbol: string; invert: boolean }>,
  range: string,
  interval: string,
): Promise<Record<string, Array<{ t: number; c: number }>>> {
  const url =
    "https://query1.finance.yahoo.com/v7/finance/spark?symbols=" +
    jobs.map((job) => job.symbol).join(",") +
    `&range=${range}&interval=${interval}`;
  const body = rec(await getJson(url, 12000));
  const invert = new Map(jobs.map((job) => [job.symbol, job.invert]));
  const ticker = new Map(jobs.map((job) => [job.symbol, job.ticker]));
  const series: Record<string, Array<{ t: number; c: number }>> = {};
  for (const item of arr(rec(body?.spark)?.result)) {
    const row = rec(item);
    const symbol = typeof row?.symbol === "string" ? row.symbol : null;
    const name = symbol ? ticker.get(symbol) : null;
    if (!symbol || !name) continue;
    const response = rec(arr(row?.response)[0]);
    const quote = rec(arr(rec(response?.indicators)?.quote)[0]);
    const times = arr(response?.timestamp).map(num);
    const closes = arr(quote?.close);
    const points: Array<{ t: number; c: number }> = [];
    for (let i = 0; i < closes.length; i += 1) {
      const close = num(closes[i]);
      const time = times[i];
      if (close == null || time == null || close <= 0) continue;
      const ms = time > 1e12 ? time : time * 1000;
      points.push({ t: ms, c: invert.get(symbol) ? 1 / close : close });
    }
    points.sort((a, b) => a.t - b.t);
    if (points.length) series[name] = points;
  }
  return series;
}

const EMPTY_FINE: FinePrices = { mark15: [], markHour: [], series15: {}, seriesHour: {} };

async function buildFinePrices(): Promise<FinePrices> {
  const fxJobs: Array<{ ticker: string; symbol: string; invert: boolean }> = [
    { ticker: "EUR", symbol: "EURUSD=X", invert: false },
    { ticker: "GBP", symbol: "GBPUSD=X", invert: false },
    { ticker: "AUD", symbol: "AUDUSD=X", invert: false },
    { ticker: "JPY", symbol: "JPY=X", invert: true },
    { ticker: "CHF", symbol: "CHF=X", invert: true },
    { ticker: "CAD", symbol: "CAD=X", invert: true },
    { ticker: "CNY", symbol: "CNY=X", invert: true },
    { ticker: "INR", symbol: "INR=X", invert: true },
  ];
  const jobs = [
    ...EQUITIES.map((item) => ({ ticker: item.ticker, symbol: item.ticker, invert: false })),
    ...CRYPTOS.map((item) => ({ ticker: item.ticker, symbol: item.yahoo, invert: false })),
    ...fxJobs,
  ];
  const chunks: Array<typeof jobs> = [];
  for (let i = 0; i < jobs.length; i += 12) chunks.push(jobs.slice(i, i + 12));
  const [mark15, markHour, ...parts] = await Promise.all([
    loadFineMark(false),
    loadFineMark(true),
    ...chunks.map((chunk) => grab(loadYahooFine(chunk, "5d", "15m"))),
    ...chunks.map((chunk) => grab(loadYahooFine(chunk, "7d", "1h"))),
  ]);
  const series15: FinePrices["series15"] = {};
  const seriesHour: FinePrices["seriesHour"] = {};
  parts.forEach((part, index) => {
    if (!part) return;
    Object.assign(index < chunks.length ? series15 : seriesHour, part);
  });
  return { mark15, markHour, series15, seriesHour };
}

let fineCache: { at: number; data: FinePrices } | null = null;
let fineFlight: Promise<FinePrices> | null = null;

export function loadFinePrices(): Promise<FinePrices> {
  if (fineCache && Date.now() - fineCache.at < FINE_TTL_MS) return Promise.resolve(fineCache.data);
  if (!fineFlight) {
    fineFlight = buildFinePrices()
      .then((data) => {
        if (data.mark15.length >= 3 || data.markHour.length >= 3) fineCache = { at: Date.now(), data };
        return data;
      })
      .catch(() => fineCache?.data ?? EMPTY_FINE)
      .finally(() => {
        fineFlight = null;
      });
  }
  return fineFlight;
}

export async function loadMarkHistory(): Promise<MarkHistory> {
  if (historyCache && Date.now() - historyCache.at < HISTORY_TTL_MS) return historyCache.data;
  const now = Math.floor(Date.now() / 1000);
  const from = now - 120 * 86400;
  const start = new Date(from * 1000).toISOString();
  const end = new Date(now * 1000).toISOString();
  const [nxUsdc, nxUsdt, nxBtc, nkUsdt, nkBtc, btcUsdBody, usdtUsdBody] = await Promise.all([
    grab(getJson("https://neoxa.exchange/api/exchange/candles/BTCB2_USDC?interval=1d&limit=120")),
    grab(getJson("https://neoxa.exchange/api/exchange/candles/BTCB2_USDT?interval=1d&limit=120")),
    grab(getJson("https://neoxa.exchange/api/exchange/candles/BTCB2_BTC?interval=1d&limit=120")),
    grab(getJson(`https://api.nonkyc.io/api/v2/market/candles?symbol=BTCB2_USDT&resolution=1440&from=${from}&to=${now}`)),
    grab(getJson(`https://api.nonkyc.io/api/v2/market/candles?symbol=BTCB2_BTC&resolution=1440&from=${from}&to=${now}`)),
    grab(getJson(`https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400&start=${start}&end=${end}`)),
    grab(getJson(`https://api.exchange.coinbase.com/products/USDT-USD/candles?granularity=86400&start=${start}&end=${end}`)),
  ]);
  const usdc = neoxDays(nxUsdc);
  const neoxUsdt = neoxDays(nxUsdt);
  const neoxBtc = neoxDays(nxBtc);
  const nonkycUsdt = nonkycDays(nkUsdt);
  const nonkycBtc = nonkycDays(nkBtc);
  const btcUsd = coinbaseDays(btcUsdBody);
  const usdtUsd = coinbaseDays(usdtUsdBody);
  const days = new Set<number>([...usdc.keys(), ...neoxUsdt.keys(), ...neoxBtc.keys(), ...nonkycUsdt.keys(), ...nonkycBtc.keys()]);
  const points = [...days]
    .sort((a, b) => a - b)
    .map((day) => {
      const prices: number[] = [];
      const usdcClose = usdc.get(day);
      if (usdcClose != null) prices.push(usdcClose);
      const usdtFx = usdtUsd.get(day) ?? 1;
      const neoxUsdtClose = neoxUsdt.get(day);
      if (neoxUsdtClose != null) prices.push(neoxUsdtClose * usdtFx);
      const nonkycUsdtClose = nonkycUsdt.get(day);
      if (nonkycUsdtClose != null) prices.push(nonkycUsdtClose * usdtFx);
      const btcFx = btcUsd.get(day);
      if (btcFx != null) {
        const neoxBtcClose = neoxBtc.get(day);
        if (neoxBtcClose != null) prices.push(neoxBtcClose * btcFx);
        const nonkycBtcClose = nonkycBtc.get(day);
        if (nonkycBtcClose != null) prices.push(nonkycBtcClose * btcFx);
      }
      if (!prices.length) return null;
      const c = prices.reduce((sum, price) => sum + price, 0) / prices.length;
      return { t: day, c, books: prices.length };
    })
    .filter((point): point is MarkHistory["points"][number] => point != null);

  if (points.length < 2) throw new Error("No history");
  const data: MarkHistory = {
    from: points[0]?.t ?? from * 1000,
    to: points.at(-1)?.t ?? now * 1000,
    points,
  };
  if (points.length) historyCache = { at: Date.now(), data };
  return data;
}

const chartCache = new Map<string, { at: number; data: ChartPayload }>();

const LIMITS: Record<ChartPayload["interval"], number> = {
  "15m": 96,
  "1h": 72,
  "4h": 48,
  "1d": 90,
};

const STEP_SEC: Record<ChartPayload["interval"], number> = {
  "15m": 15 * 60,
  "1h": 60 * 60,
  "4h": 4 * 60 * 60,
  "1d": 24 * 60 * 60,
};

/** Same clock for every quote. Quiet buckets keep the last price, so a gap cannot shift the window. */
function onTheClock(
  raw: Candle[],
  interval: ChartPayload["interval"],
): { from: number; to: number; candles: Candle[] } {
  const step = STEP_SEC[interval];
  const bars = LIMITS[interval];
  const end = Math.floor(Date.now() / 1000 / step) * step;
  const start = end - (bars - 1) * step;
  const byTime = new Map<number, Candle>();
  for (const candle of raw) {
    const bucket = Math.floor(candle.t / 1000 / step) * step;
    byTime.set(bucket, candle);
  }
  let carry: number | null = null;
  for (const candle of raw) {
    if (candle.t / 1000 <= start) carry = candle.c;
  }
  const candles: Candle[] = [];
  let started = carry != null;
  for (let t = start; t <= end; t += step) {
    const hit = byTime.get(t);
    if (hit) {
      started = true;
      carry = hit.c;
      candles.push({ ...hit, t: t * 1000 });
    } else if (started && carry != null) {
      candles.push({ t: t * 1000, o: carry, h: carry, l: carry, c: carry, v: 0 });
    }
  }
  const first = candles[0]?.t ?? start * 1000;
  // A short book should fill the card. A full window already starts on the first candle.
  return { from: first, to: end * 1000, candles };
}

const NK_RES: Record<ChartPayload["interval"], string> = {
  "15m": "15",
  "1h": "60",
  "4h": "240",
  "1d": "1440",
};

function candleRows(items: unknown[], timeInMs: boolean): Candle[] {
  return items
    .map((item) => {
      const row = rec(item);
      const t = num(row?.time);
      const o = num(row?.open);
      const h = num(row?.high);
      const l = num(row?.low);
      const c = num(row?.close);
      const v = num(row?.volume) ?? 0;
      if (t == null || o == null || h == null || l == null || c == null) return null;
      return { t: timeInMs ? t : t * 1000, o, h, l, c, v };
    })
    .filter((c): c is Candle => c != null)
    .sort((a, b) => a.t - b.t);
}

export async function loadChart(quote: QuoteCcy, interval: ChartPayload["interval"]): Promise<ChartPayload> {
  const key = `${quote}:${interval}`;
  const hit = chartCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.data;

  let source = "Neoxa";
  let pairLabel = `XBT/${quote}`;
  let raw: Candle[] = [];

  if (quote === "USDT") {
    const step = STEP_SEC[interval];
    const end = Math.floor(Date.now() / 1000 / step) * step;
    const start = end - (LIMITS[interval] - 1) * step;
    const body = rec(
      await getJson(
        `https://api.nonkyc.io/api/v2/market/candles?symbol=BTCB2_USDT&resolution=${NK_RES[interval]}&from=${start - step * 2}&to=${Math.floor(Date.now() / 1000)}`,
      ),
    );
    source = "NonKYC";
    pairLabel = "BTCB2/USDT";
    raw = candleRows(arr(body?.bars), true);
  } else {
    const fetchLimit = Math.min(LIMITS[interval] * 8, 800);
    const body = rec(
      await getJson(
        `https://neoxa.exchange/api/exchange/candles/BTCB2_${quote}?interval=${interval}&limit=${fetchLimit}`,
      ),
    );
    raw = candleRows(arr(body?.candles), false);
  }

  const clock = onTheClock(raw, interval);
  const data: ChartPayload = {
    quote,
    interval,
    pairLabel,
    source,
    from: clock.from,
    to: clock.to,
    candles: clock.candles,
  };
  chartCache.set(key, { at: Date.now(), data });
  return data;
}
