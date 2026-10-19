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
const HOUR = 60 * 60 * 1000;
const DAY = 86_400_000;

function dayLabel(ms: number): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(ms);
}

function clockLabel(ms: number, withDay: boolean): string {
  const date = new Date(ms);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  if (!withDay) return `${hh}:${mm}`;
  return `${dayLabel(ms)}  ${hh}:${mm}`;
}

function HourTick({ x, y, payload }: { x: number; y: number; payload: { value: number } }) {
  const date = new Date(payload.value);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return (
    <text x={x} y={y} textAnchor="middle" fill="var(--color-muted)" fontSize={10}>
      <tspan x={x} dy={11}>
        {dayLabel(payload.value)}
      </tspan>
      <tspan x={x} dy={12}>
        {`${hh}:${mm}`}
      </tspan>
    </text>
  );
}

function spaced(latest: number, step: number, start: number, end: number): number[] {
  return [4, 3, 2, 1, 0].map((i) => latest - i * step).filter((mark) => mark >= start && mark <= end);
}

function chartTicks(kind: "15m" | "1h" | "4h" | "1d" | "history", start: number, end: number): number[] | undefined {
  if (kind === "15m") {
    const latest = Math.round((Date.now() - 2 * HOUR) / (15 * 60 * 1000)) * 15 * 60 * 1000;
    return spaced(latest, 5 * HOUR, start, end);
  }
  if (kind === "1h") {
    const latest = Math.round((Date.now() - 2 * HOUR) / HOUR) * HOUR;
    const step = Math.max(HOUR, Math.round((latest - start) / 5 / HOUR) * HOUR);
    return spaced(latest, step, start, end);
  }
  if (kind === "4h") {
    const days: number[] = [];
    let cursor = Math.floor(Date.now() / DAY) * DAY;
    while (days.length < 7 && cursor >= start) {
      if (cursor <= end) days.push(cursor);
      cursor -= DAY;
    }
    return days.reverse();
  }
  const latest = Math.round((Date.now() - 3 * DAY) / DAY) * DAY;
  const step = Math.max(DAY, Math.round((latest - start) / 5 / DAY) * DAY);
  const marks = spaced(latest, step, start, end);
  return marks.length >= 2 ? marks : undefined;
}

function axisPrice(n: number, quote: QuoteCcy): string {
  if (quote === "BTC") return n >= 0.01 ? n.toFixed(4) : n.toPrecision(2);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(n);
}

function axisFiat(n: number, currency: Currency): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(n);
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
  const [mode, setMode] = useState<"tape" | "history">("history");
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
              ["history", "Historical"],
              ["tape", "Tape"],
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
              <AreaChart data={candles} margin={{ top: 8, right: axes ? 4 : 0, left: 0, bottom: interval === "1h" ? 18 : 0 }}>
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={[tape.data?.from ?? "dataMin", tape.data?.to ?? "dataMax"]}
                  hide={!axes}
                  ticks={chartTicks(interval, tape.data?.from ?? candles[0]?.t ?? 0, tape.data?.to ?? candles[candles.length - 1]?.t ?? 0)}
                  interval={0}
                  tick={interval === "1h" ? HourTick : AXIS_TICK}
                  axisLine={{ stroke: "var(--color-line)" }}
                  tickLine={false}
                  minTickGap={0}
                  tickFormatter={
                    interval === "1h" ? undefined : (value: number) => (interval === "15m" ? clockLabel(value, false) : dayLabel(value))
                  }
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
                ticks={chartTicks("history", points[0]?.t ?? 0, points[points.length - 1]?.t ?? 0)}
                interval={0}
                tick={AXIS_TICK}
                axisLine={{ stroke: "var(--color-line)" }}
                tickLine={false}
                minTickGap={0}
                tickFormatter={(value: number) => dayLabel(value)}
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
                tickFormatter={(value: number) => axisFiat(value, currency)}
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
