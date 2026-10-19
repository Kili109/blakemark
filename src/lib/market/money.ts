import type { AssetRow, CompareSpan } from "./types";
import { formatUsd } from "./format";

export const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "CNY", "INR"] as const;
export type Currency = (typeof CURRENCIES)[number];

export type DayClose = { t: number; c: number };

export function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && (CURRENCIES as readonly string[]).includes(value);
}

const symbols = new Map<string, string>();

function currencySymbol(currency: Currency): string {
  const cached = symbols.get(currency);
  if (cached) return cached;
  const symbol =
    new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "narrowSymbol" })
      .formatToParts(1)
      .find((part) => part.type === "currency")?.value ?? currency;
  symbols.set(currency, symbol);
  return symbol;
}

export function formatMoney(n: number | null, currency: Currency): string {
  if (currency === "USD") return formatUsd(n);
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs > 0 && abs < 0.01) return currencySymbol(currency) + n.toPrecision(abs < 0.0001 ? 2 : 3);
  const digits = currency === "JPY" ? 0 : abs < 1 ? 4 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

/** `fx` closes are dollars per one unit of the chosen currency. A day with no print keeps the previous rate. */
export function traceConvert(points: DayClose[], fx: DayClose[]): DayClose[] {
  const rates = [...fx].filter((point) => point.c > 0).sort((a, b) => a.t - b.t);
  const out: DayClose[] = [];
  let index = 0;
  let rate: number | null = null;
  for (const point of [...points].sort((a, b) => a.t - b.t)) {
    while (index < rates.length && rates[index]!.t <= point.t) {
      rate = rates[index]!.c;
      index += 1;
    }
    if (rate == null || point.c <= 0) continue;
    out.push({ t: point.t, c: point.c / rate });
  }
  return out;
}

export function convertSpot(usd: number | null, fx: DayClose[]): number | null {
  if (usd == null || !Number.isFinite(usd)) return null;
  const rate = [...fx].reverse().find((point) => point.c > 0)?.c;
  if (rate == null) return null;
  return usd / rate;
}

export function tracedChange(points: DayClose[], days: number): number | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1]!;
  const target = last.t - days * 86_400_000;
  let pick: DayClose | null = null;
  for (const point of points) {
    if (point.t <= target) pick = point;
  }
  if (!pick && last.t - points[0]!.t >= days * 86_400_000 * 0.75) pick = points[0]!;
  if (!pick || pick.c <= 0 || last.c <= 0) return null;
  if (last.t - pick.t < days * 86_400_000 * 0.7) return null;
  return ((last.c - pick.c) / pick.c) * 100;
}

export function tracedSpans(points: DayClose[]): Record<CompareSpan, number | null> {
  return {
    "24h": tracedChange(points, 1),
    "1w": tracedChange(points, 7),
    "1m": tracedChange(points, 30),
  };
}

export function presentAsset(asset: AssetRow, currency: Currency, fx: DayClose[] | null): AssetRow {
  if (currency === "USD" || !fx?.length) return asset;
  if (asset.kind === "fiat" && asset.ticker === currency) {
    const priced = fx
      .filter((point) => point.c > 0)
      .map((point) => ({ t: point.t, c: 1 / point.c }));
    const last = priced[priced.length - 1]?.c ?? null;
    return {
      ...asset,
      ticker: "USD",
      name: "US dollar",
      price: last,
      changes: tracedSpans(priced),
      spark: priced.map((point) => point.c),
      daily: fx.map((point) => ({ t: point.t, c: 1 })),
      venues: last == null ? [] : [{ name: "ECB", price: last, changePct: null }],
    };
  }
  const priced = traceConvert(asset.daily, fx);
  return {
    ...asset,
    price: convertSpot(asset.price, fx),
    changes: tracedSpans(priced),
    spark: priced.map((point) => point.c),
    venues: asset.venues.map((venue) => ({
      ...venue,
      price: convertSpot(venue.price, fx) ?? venue.price,
      changePct: null,
    })),
  };
}
