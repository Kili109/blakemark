import type {
  AssetKind,
  AssetRow,
  BestPrice,
  Board,
  Candle,
  ChartPayload,
  CompareSpan,
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

type YahooPoint = { price: number | null; changePct: number | null; spark: number[]; weekPct: number | null; monthPct: number | null };

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

type FiatPoint = { price: number; changes: Record<CompareSpan, number | null>; spark: number[] };

async function loadFiat(): Promise<Map<string, FiatPoint> | null> {
  const codes = FIATS.map(([code]) => code).join(",");
  const start = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
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
    });
  }
  return out.size ? out : null;
}

type CompareSlice = { assets: AssetRow[]; warnings: string[] };

async function buildCompare(): Promise<CompareSlice> {
  const symbols = [...EQUITIES.map((e) => e.ticker), ...CRYPTOS.map((c) => c.yahoo)];
  const warnings: string[] = [];
  const listed = CRYPTOS.filter((c) => c.kraken || c.coinbase);
  const krakenJobs = listed.filter((c) => c.kraken).map(async (c) => ({
    ticker: c.ticker,
    print: await grab(kraken(c.kraken!)),
  }));
  const coinbaseJobs = listed.filter((c) => c.coinbase).map(async (c) => ({
    ticker: c.ticker,
    print: await grab(coinbase(c.coinbase!)),
  }));

  const [yahoo, cnbc, fiat, krakenPrints, coinbasePrints] = await Promise.all([
    loadYahooMany(symbols),
    grab(loadCnbc(EQUITIES.map((e) => e.ticker))),
    grab(loadFiat()),
    Promise.all(krakenJobs),
    Promise.all(coinbaseJobs),
  ]);

  const direct = new Map<string, Print[]>();
  for (const row of [...krakenPrints, ...coinbasePrints]) {
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

  const nk = new Map<QuoteCcy, Record<string, unknown> | null>([
    ["USDT", nkUsdt ? rec(nkUsdt) : null],
    ["BTC", nkBtc ? rec(nkBtc) : null],
  ]);
  if (!nkUsdt && !nkBtc) warnings.push("NonKYC did not respond.");
  if (!neoxBody) warnings.push("Neoxa did not respond.");

  const books = buildXbtBooks({
    neox: neoxBody ? parseNeox(neoxBody) : null,
    nk: !nkUsdt && !nkBtc && !nkUsdc ? new Map() : nk,
    depth: new Map([
      ["BTCB2_USDC", depthUsdc],
      ["BTCB2_USDT", depthUsdt],
      ["BTCB2_BTC", depthBtc],
    ]),
    btcUsd: btcSummary.price,
    usdtUsd,
  });

  if (!nkUsdt && !nkBtc && !nkUsdc) {
    for (const book of books) {
      if (book.venue === "NonKYC") {
        book.status = "error";
        book.note = "NonKYC did not respond.";
      }
    }
  }

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
  warnings.push(...compare.warnings);
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

const chartCache = new Map<string, { at: number; data: ChartPayload }>();

const LIMITS: Record<ChartPayload["interval"], number> = {
  "15m": 96,
  "1h": 72,
  "4h": 48,
  "1d": 90,
};

export async function loadChart(quote: QuoteCcy, interval: ChartPayload["interval"]): Promise<ChartPayload> {
  const key = `${quote}:${interval}`;
  const hit = chartCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.data;
  const pair = `BTCB2_${quote}`;
  const body = rec(
    await getJson(
      `https://neoxa.exchange/api/exchange/candles/${pair}?interval=${interval}&limit=${LIMITS[interval]}`,
    ),
  );
  const candles: Candle[] = arr(body?.candles)
    .map((item) => {
      const row = rec(item);
      const t = num(row?.time);
      const o = num(row?.open);
      const h = num(row?.high);
      const l = num(row?.low);
      const c = num(row?.close);
      const v = num(row?.volume) ?? 0;
      if (t == null || o == null || h == null || l == null || c == null) return null;
      return { t: t * 1000, o, h, l, c, v };
    })
    .filter((c): c is Candle => c != null);

  const data: ChartPayload = {
    quote,
    interval,
    pairLabel: `XBT/${quote}`,
    source: "Neoxa",
    candles,
  };
  chartCache.set(key, { at: Date.now(), data });
  return data;
}
