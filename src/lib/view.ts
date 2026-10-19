import type { AssetKind, CompareSpan, QuoteCcy } from "@/lib/market/types";

export type ChartSide = "xbt" | "asset" | "fiat";
export type SortKey = "listed" | "performance";
export type ChartMode = "tape" | "history";
export type CandleInterval = "15m" | "1h" | "4h" | "1d";

export type ViewState = {
  kind: AssetKind;
  span: CompareSpan;
  sort: SortKey;
  side: ChartSide;
  openTicker: string | null;
  notes: boolean;
  chartMode: ChartMode;
  quote: QuoteCcy;
  interval: CandleInterval;
  scale: "linear" | "log";
};

export const DEFAULT_VIEW: ViewState = {
  kind: "fiat",
  span: "1m",
  sort: "listed",
  side: "asset",
  openTicker: null,
  notes: false,
  chartMode: "history",
  quote: "USDC",
  interval: "1h",
  scale: "linear",
};

const KEY = "blakemark-view";

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function loadView(): ViewState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_VIEW;
    const parsed = JSON.parse(raw) as Partial<ViewState>;
    return {
      kind: oneOf(parsed.kind, ["fiat", "crypto", "tech", "fund"], DEFAULT_VIEW.kind),
      span: oneOf(parsed.span, ["24h", "1w", "1m"], DEFAULT_VIEW.span),
      sort: oneOf(parsed.sort, ["listed", "performance"], DEFAULT_VIEW.sort),
      side: oneOf(parsed.side, ["xbt", "asset", "fiat"], DEFAULT_VIEW.side),
      openTicker: typeof parsed.openTicker === "string" && parsed.openTicker ? parsed.openTicker : null,
      notes: parsed.notes === true,
      chartMode: oneOf(parsed.chartMode, ["history", "tape"], DEFAULT_VIEW.chartMode),
      quote: oneOf(parsed.quote, ["USDC", "USDT", "BTC"], DEFAULT_VIEW.quote),
      interval: oneOf(parsed.interval, ["15m", "1h", "4h", "1d"], DEFAULT_VIEW.interval),
      scale: oneOf(parsed.scale, ["linear", "log"], DEFAULT_VIEW.scale),
    };
  } catch {
    return DEFAULT_VIEW;
  }
}

export function saveView(view: ViewState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(view));
  } catch {
    // Private mode can refuse storage. The buttons still work for this visit.
  }
}
