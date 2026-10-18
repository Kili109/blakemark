import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getMarkHistory, getXbtChart } from "@/lib/market/board.functions";
import { formatPlain, formatUsd } from "@/lib/market/format";
import { formatMoney, traceConvert, type Currency, type DayClose } from "@/lib/market/money";
import type { QuoteCcy } from "@/lib/market/types";

const QUOTES: QuoteCcy[] = ["USDC", "USDT", "BTC"];
const INTERVALS = ["15m", "1h", "4h", "1d"] as const;
const WINDOW_LABEL: Record<(typeof INTERVALS)[number], string> = {
  "15m": "last 24 hours",
  "1h": "last 3 days",
  "4h": "last 8 days",
  "1d": "daily",
};

function formatAxisTime(ms: number, interval: (typeof INTERVALS)[number]): string {
  if (interval === "1d") {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(ms);
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(ms);
}

function formatDay(ms: number): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(ms);
}

const AXIS_TICK = { fill: "var(--color-muted)", fontSize: 10 };

function axisTime(ms: number, withHour: boolean): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(withHour ? { hour: "2-digit" as const, hourCycle: "h23" as const } : {}),
    timeZone: "UTC",
  }).format(ms);
}

function axisPrice(n: number, quote: QuoteCcy): string {
  if (quote === "BTC") return n >= 0.01 ? n.toFixed(4) : n.toPrecision(2);
  if (n >= 100) return "$" + Math.round(n).toLocaleString("en-US");
  if (n >= 1) return "$" + n.toFixed(2);
  return "$" + n.toPrecision(2);
}

export function XbtChart({
  axes = false,
  currency = "USD",
  fx = null,
}: {
  axes?: boolean;
  currency?: Currency;
  fx?: DayClose[] | null;
}) {
  const [mode, setMode] = useState<"tape" | "history">("tape");
  const [quote, setQuote] = useState<QuoteCcy>("USDC");
  const [interval, setInterval] = useState<(typeof INTERVALS)[number]>("1h");
  const [scale, setScale] = useState<"linear" | "log">("linear");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  const tape = useQuery({
    queryKey: ["xbt-chart", quote, interval],
    queryFn: () => getXbtChart({ data: { quote, interval } }),
    enabled: mode === "tape",
    networkMode: "always",
    gcTime: 24 * 60 * 60 * 1000,
    refetchInterval: mode === "tape" ? 60_000 : false,
  });
  const history = useQuery({
    queryKey: ["mark-history"],
    queryFn: () => getMarkHistory(),
    enabled: mode === "history" || currency !== "USD",
    networkMode: "always",
    gcTime: 24 * 60 * 60 * 1000,
    staleTime: 60 * 60 * 1000,
  });

  const candles = tape.data?.candles ?? [];
  const points = useMemo(() => {
    const raw = history.data?.points ?? [];
    if (currency === "USD" || !fx?.length) return raw;
    const priced = traceConvert(raw, fx);
    const books = new Map(raw.map((point) => [point.t, point.books]));
    return priced.map((point) => ({ ...point, books: books.get(point.t) ?? 0 }));
  }, [history.data, currency, fx]);
  const tapeWaiting = !tape.data && (tape.isPending || tape.isFetching);
  const historyWaiting = !history.data && (history.isPending || history.isFetching);
  const series = mode === "tape" ? candles : points;
  const first = series[0]?.c ?? null;
  const last = series[series.length - 1]?.c ?? null;
  const rising = first != null && last != null ? last >= first : true;
  const stroke = rising ? "var(--color-up)" : "var(--color-down)";
  const lows = points.map((point) => point.c).filter((price) => price > 0);
  const min = lows.length ? Math.min(...lows) : 1;
  const max = lows.length ? Math.max(...lows) : 1;
  const pad = max > min ? Math.pow(max / min, 0.08) : 1.05;
  const domain: [number, number] | ["auto", "auto"] = scale === "log" ? [min / pad, max * pad] : ["auto", "auto"];

  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div>
        <h2 className="font-display text-xl text-fg">Chart</h2>
        <p className="mt-1 text-sm text-muted">
          {mode === "tape"
            ? `${tape.data ? `${tape.data.pairLabel} · ${tape.data.source}` : "XBT"} · ${WINDOW_LABEL[interval]}`
            : `Equal-weight daily close${currency === "USD" ? "" : ` · ${currency}`}`}
        </p>
      </div>
      <div className="mt-4 grid gap-2">
        <div className="grid grid-cols-2 gap-1 rounded-full bg-raised p-1" role="group" aria-label="Chart">
          {(
            [
              ["tape", "Tape"],
              ["history", "Historical"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={mode === id}
              onClick={() => setMode(id)}
              className={"min-h-11 rounded-full px-2 text-sm " + (mode === id ? "bg-accent text-bg" : "text-muted")}
            >
              {label}
            </button>
          ))}
        </div>
        {mode === "tape" ? (
          <>
            <div className="grid grid-cols-3 gap-1 rounded-full bg-raised p-1" role="group" aria-label="Quote currency">
              {QUOTES.map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={quote === item}
                  onClick={() => setQuote(item)}
                  className={"min-h-11 rounded-full px-2 text-sm " + (quote === item ? "bg-accent text-bg" : "text-muted")}
                >
                  {item}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-4 gap-1 rounded-full bg-raised p-1" role="group" aria-label="Candle interval">
              {INTERVALS.map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={interval === item}
                  onClick={() => setInterval(item)}
                  className={"min-h-11 rounded-full px-2 text-sm " + (interval === item ? "bg-fg text-bg" : "text-muted")}
                >
                  {item}
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-1 rounded-full bg-raised p-1" role="group" aria-label="Price scale">
            {(
              [
                ["linear", "Linear"],
                ["log", "Log"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={scale === id}
                onClick={() => setScale(id)}
                className={"min-h-11 rounded-full px-2 text-sm " + (scale === id ? "bg-fg text-bg" : "text-muted")}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 h-56">
        {mode === "tape" ? (
          !ready || tapeWaiting ? (
            <div className="flex h-full items-center justify-center text-sm text-muted">Loading candles…</div>
          ) : candles.length < 2 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted">No data available.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={candles} margin={{ top: 8, right: axes ? 4 : 0, left: 0, bottom: 0 }}>
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={[tape.data?.from ?? "dataMin", tape.data?.to ?? "dataMax"]}
                  hide={!axes}
                  tick={AXIS_TICK}
                  axisLine={{ stroke: "var(--color-line)" }}
                  tickLine={false}
                  minTickGap={28}
                  tickFormatter={(value: number) => axisTime(value, interval === "15m" || interval === "1h")}
                />
                <YAxis
                  hide={!axes}
                  orientation="right"
                  width={axes ? 52 : 0}
                  domain={["auto", "auto"]}
                  tick={AXIS_TICK}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(value: number) => axisPrice(value, quote)}
                />
                <Tooltip
                  cursor={{ stroke: "var(--color-line)" }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload as { t: number; c: number; h: number; l: number };
                    const price = quote === "BTC" ? formatPlain(row.c, 8) + " BTC" : formatUsd(row.c);
                    return (
                      <div className="rounded-xl border border-line bg-raised px-3 py-2 text-xs text-fg">
                        <div className="text-muted">{formatAxisTime(row.t, interval)}</div>
                        <div className="mt-1 font-medium tabular-nums">{price}</div>
                        <div className="mt-1 text-muted tabular-nums">
                          H {quote === "BTC" ? formatPlain(row.h, 8) : formatUsd(row.h)} · L{" "}
                          {quote === "BTC" ? formatPlain(row.l, 8) : formatUsd(row.l)}
                        </div>
                      </div>
                    );
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="c"
                  stroke={stroke}
                  fill={stroke}
                  fillOpacity={0.16}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )
        ) : historyWaiting ? (
          <div className="flex h-full items-center justify-center text-sm text-muted">Loading the daily average…</div>
        ) : points.length < 2 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted">No data available.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart key={scale} data={points} margin={{ top: 8, right: axes ? 4 : 0, left: 0, bottom: 0 }}>
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                hide={!axes}
                tick={AXIS_TICK}
                axisLine={{ stroke: "var(--color-line)" }}
                tickLine={false}
                minTickGap={28}
                tickFormatter={(value: number) => axisTime(value, false)}
              />
              <YAxis
                hide={!axes}
                orientation="right"
                width={axes ? 52 : 0}
                scale={scale}
                domain={domain}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                tickFormatter={(value: number) => (currency === "USD" ? axisPrice(value, "USDC") : formatMoney(value, currency))}
              />
              <Tooltip
                cursor={{ stroke: "var(--color-line)" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0]?.payload as { t: number; c: number; books: number };
                  return (
                    <div className="rounded-xl border border-line bg-raised px-3 py-2 text-xs text-fg">
                      <div className="text-muted">{formatDay(row.t)}</div>
                      <div className="mt-1 font-medium tabular-nums">{formatMoney(row.c, currency)}</div>
                      <div className="mt-1 text-muted">{row.books} books</div>
                    </div>
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="c"
                stroke={stroke}
                fill={stroke}
                fillOpacity={0.16}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
