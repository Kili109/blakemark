import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { getXbtChart } from "@/lib/market/board.functions";
import { formatPlain, formatUsd } from "@/lib/market/format";
import type { QuoteCcy } from "@/lib/market/types";

const QUOTES: QuoteCcy[] = ["USDC", "USDT", "BTC"];
const INTERVALS = ["15m", "1h", "4h", "1d"] as const;

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

export function XbtChart() {
  const [quote, setQuote] = useState<QuoteCcy>("USDC");
  const [interval, setInterval] = useState<(typeof INTERVALS)[number]>("1h");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  const query = useQuery({
    queryKey: ["xbt-chart", quote, interval],
    queryFn: () => getXbtChart({ data: { quote, interval } }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  const candles = query.data?.candles ?? [];
  const first = candles[0]?.c ?? null;
  const last = candles[candles.length - 1]?.c ?? null;
  const rising = first != null && last != null ? last >= first : true;
  const stroke = rising ? "var(--color-up)" : "var(--color-down)";

  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div>
        <h2 className="font-display text-xl text-fg">Neoxa tape</h2>
        <p className="mt-1 text-sm text-muted">
          {query.data ? `${query.data.pairLabel} · ${query.data.source}` : "XBT candles"}
          {" · "}Pick a currency, then how far back to look. NonKYC has no chart here.
        </p>
      </div>
      <div className="mt-4 grid gap-2">
        <div className="grid grid-cols-3 gap-1 rounded-full bg-raised p-1" role="group" aria-label="Quote currency">
          {QUOTES.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={quote === item}
              onClick={() => setQuote(item)}
              className={
                "min-h-11 rounded-full px-2 text-sm " + (quote === item ? "bg-accent text-bg" : "text-muted")
              }
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
              className={
                "min-h-11 rounded-full px-2 text-sm " + (interval === item ? "bg-fg text-bg" : "text-muted")
              }
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 h-56">
        {!ready || query.isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted">Loading candles…</div>
        ) : query.isError ? (
          <div className="flex h-full items-center justify-center text-sm text-down">Chart unavailable.</div>
        ) : candles.length < 2 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted">Not enough prints for this book.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={candles} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
              <YAxis hide domain={["auto", "auto"]} />
              <Tooltip
                cursor={{ stroke: "var(--color-line)" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0]?.payload as { t: number; c: number; h: number; l: number; v: number };
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
        )}
      </div>
    </section>
  );
}
