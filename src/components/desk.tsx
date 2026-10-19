import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ExternalLink, RefreshCw, Settings } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BlocksCard } from "@/components/blocks-card";
import { Sparkline } from "@/components/sparkline";
import { XbtChart } from "@/components/xbt-chart";
import { getBoard, getFinePrices, getMarkHistory } from "@/lib/market/board.functions";
import { formatClock, formatCompactUsd, formatPct, formatPlain, formatQty, tone } from "@/lib/market/format";
import { convertSpot, CURRENCIES, formatMoney, presentAsset, traceConvert, tracedChange, tracedSpans, type Currency, type DayClose } from "@/lib/market/money";
import { applySettings, DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings as AppSettings } from "@/lib/settings";
import type { AssetKind, AssetRow, BestPrice, Board, CompareSpan, FinePrices, XbtBook } from "@/lib/market/types";

const GROUPS: Array<{ id: AssetKind; label: string }> = [
  { id: "tech", label: "Tech" },
  { id: "crypto", label: "Crypto" },
  { id: "fund", label: "Funds" },
  { id: "fiat", label: "Fiat" },
];

const SPANS: Array<{ id: CompareSpan; label: string }> = [
  { id: "24h", label: "24h" },
  { id: "1w", label: "1w" },
  { id: "1m", label: "1m" },
];

type ChartSide = "xbt" | "asset" | "fiat";

function windowSeries(points: DayClose[], span: CompareSpan): DayClose[] {
  if (points.length < 2) return points;
  const last = points[points.length - 1]!.t;
  const days = span === "24h" ? 1 : span === "1w" ? 7 : 30;
  const cutoff = last - days * 86_400_000;
  const sliced = points.filter((point) => point.t >= cutoff);
  return sliced.length >= 2 ? sliced : points.slice(-2);
}

function axisFigure(n: number, currency: Currency | null): string {
  const options: Intl.NumberFormatOptions = { maximumSignificantDigits: 3 };
  if (currency) {
    options.style = "currency";
    options.currency = currency;
  }
  return new Intl.NumberFormat("en-US", options).format(n);
}

function chartWhen(t: number, span: CompareSpan, axis: boolean): string {
  const date = new Date(t);
  const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: span === "1m" ? "UTC" : undefined }).format(date);
  if (span === "1m" || (axis && span === "1w")) return day;
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  if (axis && span === "24h") return `${hh}:${mm}`;
  return `${day}  ${hh}:${mm}`;
}

function nearestDayStart(t: number, utc: boolean): number {
  if (utc) return Math.round(t / 86_400_000) * 86_400_000;
  const day = new Date(t);
  const midnight = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const next = midnight + 86_400_000;
  return t - midnight < next - t ? midnight : next;
}

function axisMarks(points: DayClose[], span: CompareSpan): number[] | undefined {
  if (points.length < 2) return undefined;
  const start = points[0]!.t;
  const end = points[points.length - 1]!.t;
  if (span === "1w") {
    const days: number[] = [];
    const seen = new Set<string>();
    points.forEach((point, index) => {
      const key = new Date(point.t).toDateString();
      if (seen.has(key)) return;
      seen.add(key);
      days.push(index);
    });
    const from = Math.max(0, days.length - 6);
    return days.slice(from);
  }
  if (span === "24h") {
    const quarter = 15 * 60 * 1000;
    const latest = Math.round((Date.now() - 2 * 60 * 60 * 1000) / quarter) * quarter;
    const step = 5 * 60 * 60 * 1000;
    return [4, 3, 2, 1, 0].map((i) => latest - i * step).filter((mark) => mark >= start && mark <= end);
  }
  const step = 6 * 86_400_000;
  const latest = nearestDayStart(Date.now() - 3 * 86_400_000, true);
  return [4, 3, 2, 1, 0].map((i) => latest - i * step).filter((mark) => mark >= start && mark <= end);
}

function every3h(points: DayClose[]): DayClose[] {
  const step = 3 * 60 * 60 * 1000;
  const buckets = new Map<number, number>();
  for (const point of points) buckets.set(Math.floor(point.t / step) * step, point.c);
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, c]) => ({ t, c }));
}

function seriesChange(points: DayClose[]): number | null {
  if (points.length < 2) return null;
  const first = points[0]!.c;
  const last = points[points.length - 1]!.c;
  if (!(first > 0) || !(last > 0)) return null;
  return ((last - first) / first) * 100;
}

function holdPrice(path: DayClose[], clock: DayClose[], price: (held: number, tick: DayClose) => number | null): DayClose[] {
  const sorted = [...path].sort((a, b) => a.t - b.t);
  let index = 0;
  let held: number | null = null;
  const out: DayClose[] = [];
  for (const tick of clock) {
    while (index < sorted.length && sorted[index]!.t <= tick.t) {
      held = sorted[index]!.c;
      index += 1;
    }
    if (held == null || held <= 0) continue;
    const next = price(held, tick);
    if (next == null || !(next > 0)) continue;
    out.push({ t: tick.t, c: next });
  }
  return out;
}

function comparisonPoints(
  asset: AssetRow,
  side: ChartSide,
  marks: Map<number, number> | null,
  fx: DayClose[] | null,
  span: CompareSpan,
  fine: FinePrices | null,
  currency: Currency,
): DayClose[] {
  if (span === "1m") {
    const path = (side === "fiat" && fx?.length ? traceConvert(asset.daily, fx) : asset.daily).filter((point) => point.c > 0);
    if (!path.length) return [];
    const step = 86_400_000;
    const clock: DayClose[] = [];
    if (side !== "fiat" && marks?.size) {
      for (const [t, c] of [...marks.entries()].sort((a, b) => a[0] - b[0])) {
        const prev = clock[clock.length - 1];
        if (prev) {
          for (let day = prev.t + step; day < t; day += step) clock.push({ t: day, c: prev.c });
        }
        if (c > 0) clock.push({ t, c });
      }
      const live = fine?.markHour ?? [];
      const today = Math.floor(Date.now() / step) * step;
      const last = clock[clock.length - 1];
      if (last && live.length) {
        for (let day = last.t + step; day <= today; day += step) {
          let close = last.c;
          for (const point of live) {
            if (point.t >= day + step) break;
            if (point.c > 0) close = point.c;
          }
          clock.push({ t: day, c: close });
        }
      }
    } else if (side === "fiat") {
      const end = Math.floor(Date.now() / step) * step;
      for (let day = Math.floor(path[0]!.t / step) * step; day <= end; day += step) clock.push({ t: day, c: 0 });
    }
    if (clock.length < 2) return [];
    const priced = holdPrice(path, clock, (held, tick) => {
      if (side === "fiat" || tick.c <= 0) return held;
      return side === "xbt" ? held / tick.c : tick.c / held;
    });
    const shown = windowSeries(priced, span);
    return shown.length >= 2 ? shown : [];
  }
  const hourly = span === "1w";
  const fineMark = hourly ? fine?.markHour : fine?.mark15;
  const book = hourly ? fine?.seriesHour : fine?.series15;
  if (!fineMark?.length || !book) return [];
  const usdRow = asset.kind === "fiat" && asset.ticker === "USD";
  if (usdRow && side !== "fiat") {
    const moving = fineMark
      .filter((point) => point.c > 0)
      .map((point) => ({ t: point.t, c: side === "xbt" ? 1 / point.c : point.c }));
    const shown = windowSeries(moving, span);
    const stepped = span === "1w" ? every3h(shown) : shown;
    return stepped.length >= 2 ? stepped : [];
  }
  const path = usdRow
    ? (book[currency] ?? []).map((point) => ({ t: point.t, c: 1 / point.c }))
    : (book[asset.ticker] ?? []);
  if (!path.length) return [];
  const priced = holdPrice(path, fineMark, (held, tick) => {
    if (side === "fiat") return held;
    if (tick.c <= 0) return null;
    return side === "xbt" ? held / tick.c : tick.c / held;
  });
  const shown = windowSeries(side === "fiat" && fx?.length ? traceConvert(priced, fx) : priced, span);
  const stepped = span === "1w" ? every3h(shown) : shown;
  return stepped.length >= 2 ? stepped : [];
}

const SettingsContext = createContext<AppSettings>(DEFAULT_SETTINGS);
const SettingsUpdate = createContext<(next: AppSettings) => void>(() => {});

function useDisplay(data: Board) {
  const currency = useContext(SettingsContext).currency;
  const fx = currency === "USD" ? null : (data.assets.find((asset) => asset.kind === "fiat" && asset.ticker === currency)?.daily ?? null);
  const traced = currency !== "USD" && !!fx?.length;
  const history = useQuery({
    queryKey: ["mark-history"],
    queryFn: () => getMarkHistory(),
    enabled: traced,
    networkMode: "always",
    gcTime: 24 * 60 * 60 * 1000,
    staleTime: 60 * 60 * 1000,
  });
  const xbtSeries = useMemo(
    () => (traced && fx ? traceConvert(history.data?.points ?? [], fx) : []),
    [traced, fx, history.data],
  );
  return {
    currency,
    fx: traced ? fx : null,
    traced,
    pending: traced && !history.data,
    money: (n: number | null) => formatMoney(n, traced ? currency : "USD"),
    spot: (n: number | null) => (traced && fx ? convertSpot(n, fx) : n),
    markDay: traced ? tracedChange(xbtSeries, 1) : null,
    spans: traced ? tracedSpans(xbtSeries) : null,
    present: (asset: AssetRow) => presentAsset(asset, traced ? currency : "USD", fx),
  };
}

export function Desk() {
  const board = useQuery({
    queryKey: ["board"],
    queryFn: () => getBoard(),
    refetchInterval: 30_000,
  });
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  function updateSettings(next: AppSettings) {
    setSettings(next);
    saveSettings(next);
  }

  useEffect(() => {
    applySettings(settings);
  }, [settings]);

  return (
    <SettingsContext.Provider value={settings}>
      <SettingsUpdate.Provider value={updateSettings}>
      <main className="mx-auto min-h-screen w-full max-w-6xl px-4 pt-4 pb-16">
        <header className="border-b border-line pb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs tracking-widest text-accent uppercase">Bitcoin on Blake2b</p>
              <h1 className="font-display text-3xl text-fg">
                ₿lake<span className="text-accent">mark</span>
              </h1>
            </div>
            <div className="flex shrink-0 gap-2">
              <SettingsMenu settings={settings} onChange={updateSettings} />
              <button
                type="button"
                onClick={() => void board.refetch()}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm text-fg"
              >
                <RefreshCw className={"size-4 " + (board.isFetching ? "motion-safe:animate-spin" : "")} />
                Refresh
              </button>
            </div>
          </div>
        </header>

        {board.isLoading ? <Loading /> : null}
        {board.isError ? (
          <p className="mt-6 rounded-2xl border border-line bg-surface px-4 py-6 text-sm text-down">
            {board.error instanceof Error ? board.error.message : "Could not load quotes."}
          </p>
        ) : null}
        {board.data ? <Loaded data={board.data} /> : null}
        <AppFooter />
      </main>
      </SettingsUpdate.Provider>
    </SettingsContext.Provider>
  );
}

const SATS = "bc1qsgwhrct73ag6f6ynfwqlpr2gdqy6s8vr7pwrrk";
const APP_VERSION = "1.2.1";
const RELEASES = "https://github.com/Kili109/blakemark/releases/latest";

function versionParts(value: string): number[] {
  return value
    .replace(/^v/i, "")
    .split(".")
    .map((part) => {
      const n = Number.parseInt(part, 10);
      return Number.isFinite(n) ? n : 0;
    });
}

function isNewerRelease(remote: string, installed: string): boolean {
  const next = versionParts(remote);
  const current = versionParts(installed);
  const length = Math.max(next.length, current.length);
  for (let i = 0; i < length; i += 1) {
    const gap = (next[i] ?? 0) - (current[i] ?? 0);
    if (gap > 0) return true;
    if (gap < 0) return false;
  }
  return false;
}

function installedVersion(): string {
  if (typeof window === "undefined") return APP_VERSION;
  const native = (window as Window & { BlakemarkNative?: { versionName?: () => string } }).BlakemarkNative;
  try {
    const fromApk = native?.versionName?.();
    return fromApk ? fromApk : APP_VERSION;
  } catch {
    return APP_VERSION;
  }
}

function openRelease(url: string) {
  const native = (window as Window & { BlakemarkNative?: { openLink?: (url: string) => void } }).BlakemarkNative;
  if (native?.openLink) {
    native.openLink(url);
    return;
  }
  window.open(url, "_blank", "noopener");
}

function AppFooter() {
  const version = installedVersion();
  const [state, setState] = useState<"idle" | "checking" | "current" | "newer" | "error">("idle");
  const [latest, setLatest] = useState<string | null>(null);
  const [page, setPage] = useState(RELEASES);

  async function check() {
    setState("checking");
    try {
      const res = await fetch("https://api.github.com/repos/Kili109/blakemark/releases/latest", {
        headers: { accept: "application/vnd.github+json" },
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { tag_name?: string; html_url?: string };
      const tag = typeof body.tag_name === "string" ? body.tag_name : "";
      if (!tag) throw new Error("no tag");
      setLatest(tag.replace(/^v/i, ""));
      setPage(typeof body.html_url === "string" ? body.html_url : RELEASES);
      setState(isNewerRelease(tag, version) ? "newer" : "current");
    } catch {
      setState("error");
    }
  }

  return (
    <p className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      <span>Version {version}</span>
      <button type="button" onClick={() => void check()} className="underline decoration-line underline-offset-2">
        {state === "checking" ? "Checking…" : "Check for updates"}
      </button>
      {state === "current" ? <span>Up to date</span> : null}
      {state === "newer" ? (
        <button type="button" onClick={() => openRelease(page)} className="text-fg underline decoration-line underline-offset-2">
          {latest} is available
        </button>
      ) : null}
      {state === "error" ? <span>Couldn't check</span> : null}
    </p>
  );
}

function SatsNote() {
  const [copied, setCopied] = useState(false);

  function copy() {
    const node = document.createElement("textarea");
    node.value = SATS;
    node.setAttribute("readonly", "");
    node.style.position = "fixed";
    node.style.left = "-9999px";
    document.body.appendChild(node);
    node.select();
    document.execCommand("copy");
    node.remove();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <p className="border-t border-line pt-3 text-xs text-muted">
      no ads, no paywall, but you can drop me some sats:{" "}
      <button type="button" onClick={copy} className="break-all text-fg underline decoration-line underline-offset-2">
        {SATS}
      </button>
      {copied ? " · copied" : ""}
    </p>
  );
}

function SettingsMenu({ settings, onChange }: { settings: AppSettings; onChange: (next: AppSettings) => void }) {
  const [open, setOpen] = useState(false);

  function update(next: AppSettings) {
    onChange(next);
  }

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-label="Settings"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex size-11 items-center justify-center rounded-full border border-line bg-surface text-fg"
      >
        <Settings className="size-4" />
      </button>
      {open ? (
        <>
          <button type="button" aria-label="Close settings" className="fixed inset-0 z-20 cursor-default" onClick={() => setOpen(false)} />
          <div className="fixed inset-x-4 top-20 z-30 mx-auto grid max-h-[calc(100dvh-6rem)] max-w-sm gap-6 overflow-y-auto rounded-2xl border border-line bg-surface p-4">
            <Choice
              label="Appearance"
              value={settings.theme}
              options={[
                { id: "dark", label: "Dark" },
                { id: "light", label: "Light" },
              ]}
              onChange={(theme) => update({ ...settings, theme })}
            />
            {settings.theme === "dark" ? (
              <Contrast
                label="Contrast"
                value={settings.contrastDark}
                onChange={(contrastDark) => update({ ...settings, contrastDark })}
              />
            ) : (
              <Contrast
                label="Contrast"
                value={settings.contrastLight}
                onChange={(contrastLight) => update({ ...settings, contrastLight })}
              />
            )}
            <Choice
              label="Chart series"
              value={settings.axes ? "on" : "off"}
              options={[
                { id: "off", label: "Off" },
                { id: "on", label: "On" },
              ]}
              onChange={(axes) => update({ ...settings, axes: axes === "on" })}
            />
            <Choice
              label="Market links"
              value={settings.links}
              options={[
                { id: "browser", label: "Browser" },
                { id: "app", label: "Exchange" },
                { id: "here", label: "In app" },
              ]}
              onChange={(links) => update({ ...settings, links })}
            />
          </div>
        </>
      ) : null}
    </>
  );
}

function Contrast({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="grid gap-1">
      <span className="flex items-center justify-between text-xs tracking-widest text-muted uppercase">
        <span>{label}</span>
        <span className="tabular-nums">{value}</span>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-11 w-full -mb-2"
        style={{ accentColor: "var(--color-accent)" }}
      />
    </label>
  );
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (id: T) => void;
}) {
  return (
    <div>
      <p className="text-xs tracking-widest text-muted uppercase">{label}</p>
      <div
        className={
          "mt-2 grid gap-1 rounded-full bg-raised p-1 " + (options.length > 2 ? "grid-cols-3" : "grid-cols-2")
        }
        role="group"
        aria-label={label}
      >
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={value === option.id}
            onClick={() => onChange(option.id)}
            className={"min-h-11 rounded-full text-sm " + (value === option.id ? "bg-fg text-bg" : "text-muted")}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-2">
      <div className="rounded-2xl border border-line bg-surface p-5">
        <p className="text-xs tracking-widest text-muted uppercase">Equal-weight mark</p>
        <p className="mt-4 font-display text-5xl text-muted">Fetching books…</p>
        <p className="mt-3 text-sm text-muted">Getting the live price. Stocks and other coins follow in a moment.</p>
      </div>
      <div className="rounded-2xl border border-line bg-surface p-5 text-sm text-muted">
        The list next to this lets you compare XBT with stocks, coins, funds, and currencies.
      </div>
    </div>
  );
}

function Loaded({ data }: { data: Board }) {
  const axes = useContext(SettingsContext).axes;
  const display = useDisplay(data);
  return (
    <div className="mt-5 grid items-start gap-4 lg:grid-cols-2">
      <div className="grid gap-4">
        <Mark data={data} />
        <XbtChart axes={axes} currency={display.traced ? display.currency : "USD"} fx={display.fx} />
      </div>
      <div className="grid gap-4">
        <Compare data={data} />
        <BlocksCard />
      </div>
    </div>
  );
}

function Mark({ data }: { data: Board }) {
  const { mark, fx } = data;
  const display = useDisplay(data);
  const change = display.traced ? display.markDay : mark.changePct;
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs tracking-widest text-muted uppercase">Equal-weight mark</p>
        <p className="text-xs text-muted tabular-nums">{formatClock(data.asOf)}</p>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <p className={"font-display text-5xl tabular-nums sm:text-6xl " + tone(change)}>
          {display.money(display.spot(mark.equalUsd))}
        </p>
        <CurrencyPicker />
      </div>
      <BestTicker best={data.best} />
      <p className="mt-2 text-sm">
        <span className={"tabular-nums " + tone(change)}>{display.pending ? "—" : formatPct(change)}</span>
        <span className="text-muted"> 24h · {mark.booksUsed} live books</span>
      </p>
      <p className="mt-1 text-sm text-muted tabular-nums">
        Volume-weighted {display.money(display.spot(mark.vwapUsd))}
        {fx.btcUsd != null ? ` · BTC ref ${display.money(display.spot(fx.btcUsd))} (${fx.btcVenues})` : ""}
        {fx.usdtUsd != null ? ` · USDT ${formatPlain(fx.usdtUsd, 4)}` : ""}
      </p>

      <div className="mt-5 grid grid-cols-3 gap-2">
        <Stat label="In BTC" value={mark.btcAvg == null ? "—" : formatPlain(mark.btcAvg, 6)} detail={`${mark.btcVenues} markets`} />
        <Stat label="In USDT" value={formatPlain(mark.usdtAvg, 2)} detail={`${mark.usdtVenues} markets`} />
        <Stat label="In USDC" value={formatPlain(mark.usdcAvg, 2)} detail={mark.usdcVenues === 1 ? "Neoxa only" : `${mark.usdcVenues} markets`} />
      </div>

      {data.warnings.length ? (
        <ul className="mt-4 grid gap-1 text-xs text-down">
          {data.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      <Method books={data.books} money={(n) => display.money(display.spot(n))} />
    </section>
  );
}

function CurrencyPicker() {
  const settings = useContext(SettingsContext);
  const update = useContext(SettingsUpdate);
  return (
    <div className="relative mb-1 shrink-0">
      <select
        aria-label="Currency"
        value={settings.currency}
        onChange={(event) => {
          const currency = CURRENCIES.find((code) => code === event.target.value);
          if (currency) update({ ...settings, currency });
        }}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {CURRENCIES.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
      <div className="pointer-events-none flex h-11 items-center gap-1 rounded-full border border-line bg-raised pr-3 pl-4 text-sm text-fg">
        <span>{settings.currency}</span>
        <ChevronDown className="size-3.5 text-muted" />
      </div>
    </div>
  );
}

function BestTicker({ best }: { best: BestPrice | null }) {
  if (!best) {
    return <p className="mt-3 text-sm text-muted">Best price unavailable.</p>;
  }
  const digits = best.quote === "BTC" ? 8 : 4;
  return (
    <a href={best.tradeUrl} target="_blank" rel="noreferrer" className="mt-4 block border-t border-line pt-3">
      <span className="text-xs tracking-widest text-accent uppercase">Best price</span>
      <span className="mt-1 flex flex-wrap items-baseline gap-x-2 font-display text-3xl tabular-nums text-fg">
        <span className="text-accent">{best.quote}</span>
        <span>{best.quote === "BTC" ? formatPlain(best.price, digits) : "$" + formatPlain(best.price, digits)}</span>
        <span className="text-muted">{best.venue}</span>
      </span>
    </a>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl bg-raised px-3 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-sm font-medium tabular-nums text-fg">{value}</p>
      <p className="text-xs text-muted">{detail}</p>
    </div>
  );
}

function Books({ books, money }: { books: XbtBook[]; money: (n: number | null) => string }) {
  return (
    <div className="mt-3 border-t border-line pt-3">
      <h3 className="font-display text-lg">Books in the mark</h3>
      <ul className="mt-3 divide-y divide-line">
        {books.map((book) => (
          <li key={book.id} className="flex items-start justify-between gap-3 py-3">
            <div>
              <p className="text-sm font-medium">
                {book.venue}
                <span className="text-muted"> · {book.pairLabel}</span>
              </p>
              <p className="mt-1 text-xs text-muted">
                {book.status === "ok" ? (
                  <>
                    Vol {formatCompactUsd(book.volumeUsd)}
                    {book.bid != null && book.ask != null
                      ? ` · bid ${formatPlain(book.bid, book.quote === "BTC" ? 6 : 2)} / ask ${formatPlain(book.ask, book.quote === "BTC" ? 6 : 2)}`
                      : ""}
                    {book.note ? ` · ${book.note}` : ""}
                  </>
                ) : (
                  (book.note ?? "Unavailable")
                )}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-medium tabular-nums">
                {book.status === "ok" ? (book.quote === "BTC" ? formatPlain(book.rawPrice, 6) + " BTC" : money(book.usdPrice)) : "—"}
              </p>
              <p className={"text-xs tabular-nums " + tone(book.changePct)}>{book.status === "ok" ? formatPct(book.changePct) : book.status}</p>
              <a
                href={book.tradeUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex min-h-11 items-center gap-1 text-xs text-accent"
              >
                Market <ExternalLink className="size-3" />
              </a>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

type SortKey = "listed" | "performance";

function Compare({ data }: { data: Board }) {
  const display = useDisplay(data);
  const [kind, setKind] = useState<AssetKind>("tech");
  const [span, setSpan] = useState<CompareSpan>("1m");
  const [sort, setSort] = useState<SortKey>("listed");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [side, setSide] = useState<ChartSide>("asset");
  const history = useQuery({
    queryKey: ["mark-history"],
    queryFn: () => getMarkHistory(),
    enabled: side !== "fiat",
    networkMode: "always",
    gcTime: 24 * 60 * 60 * 1000,
    staleTime: 60 * 60 * 1000,
  });
  const fine = useQuery({
    queryKey: ["fine-prices"],
    queryFn: () => getFinePrices(),
    enabled: span !== "1m",
    networkMode: "always",
    gcTime: 24 * 60 * 60 * 1000,
    staleTime: 5 * 60 * 1000,
    refetchInterval: span === "1m" ? false : 5 * 60 * 1000,
  });
  const marks = useMemo(() => {
    if (side === "fiat" || !history.data) return null;
    return new Map(history.data.points.map((point) => [point.t, point.c]));
  }, [history.data, side]);
  const xbt = display.spot(data.mark.equalUsd);
  const xbtChange = display.traced ? (display.spans?.[span] ?? null) : data.spans[span];

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const listed = data.assets.filter((asset) => asset.kind === kind).map((asset) => display.present(asset));
    const filtered = q
      ? listed.filter((asset) => asset.ticker.toLowerCase().includes(q) || asset.name.toLowerCase().includes(q))
      : listed;
    const copy = [...filtered];
    if (sort === "performance" && xbtChange != null) {
      copy.sort((a, b) => {
        const leadA = xbtChange - (a.changes[span] ?? xbtChange);
        const leadB = xbtChange - (b.changes[span] ?? xbtChange);
        return leadA - leadB;
      });
    }
    return copy;
  }, [data.assets, kind, query, sort, span, xbtChange, display]);

  return (
    <section className="rounded-2xl border border-line bg-surface p-4 lg:sticky lg:top-4">
      <div className="flex items-end justify-between gap-3">
        <h2 className="font-display text-xl">Compare XBT</h2>
        <p className="text-xs text-muted">{data.session}</p>
      </div>

      <div className="mt-3 flex gap-2 overflow-x-auto" role="tablist" aria-label="Asset groups">
        {GROUPS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={kind === item.id}
            onClick={() => {
              setKind(item.id);
              setOpen(null);
            }}
            className={
              "min-h-11 shrink-0 rounded-full px-4 text-sm " +
              (kind === item.id ? "bg-accent text-bg" : "bg-raised text-muted")
            }
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1 rounded-full bg-raised p-1" role="group" aria-label="Comparison window">
        {SPANS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={span === item.id}
            onClick={() => setSpan(item.id)}
            className={"min-h-11 rounded-full text-sm " + (span === item.id ? "bg-fg text-bg" : "text-muted")}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="ticker-filter">
          Filter tickers
        </label>
        <input
          id="ticker-filter"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter tickers"
          className="min-h-11 flex-1 rounded-full border border-line bg-bg px-4 text-sm text-fg outline-none"
        />
        <div className="flex rounded-full bg-raised p-1" role="group" aria-label="Sort">
          {(
            [
              ["listed", "Listed"],
              ["performance", "Performance"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={sort === id}
              onClick={() => setSort(id)}
              className={"min-h-11 rounded-full px-3 text-sm " + (sort === id ? "bg-fg text-bg" : "text-muted")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <ul className="mt-2 divide-y divide-line">
        {rows.map((asset) => (
          <AssetLine
            key={asset.ticker}
            asset={asset}
            money={display.money}
            currency={display.traced ? display.currency : "USD"}
            fx={display.fx}
            side={side}
            onSide={setSide}
            series={comparisonPoints(asset, side, marks, display.fx, span, fine.data ?? null, display.traced ? display.currency : "USD").map((point) => point.c)}
            xbt={xbt}
            xbtChange={xbtChange}
            span={span}
            fine={fine.data ?? null}
            finePending={span !== "1m" && fine.isPending && !fine.data}
            open={open === asset.ticker}
            onToggle={() => setOpen((current) => (current === asset.ticker ? null : asset.ticker))}
          />
        ))}
        {rows.length === 0 ? <li className="py-6 text-sm text-muted">Nothing matches that filter.</li> : null}
      </ul>
    </section>
  );
}

function AssetLine({
  asset,
  money,
  currency,
  fx,
  side,
  onSide,
  series,
  xbt,
  xbtChange,
  span,
  fine,
  finePending,
  open,
  onToggle,
}: {
  asset: AssetRow;
  money: (n: number | null) => string;
  currency: Currency;
  fx: DayClose[] | null;
  side: ChartSide;
  onSide: (side: ChartSide) => void;
  series: number[];
  xbt: number | null;
  xbtChange: number | null;
  span: CompareSpan;
  fine: FinePrices | null;
  finePending: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const units = xbt != null && asset.price != null && asset.price > 0 ? xbt / asset.price : null;
  const inXbt = units != null && units > 0 ? 1 / units : null;
  const inverted = side === "asset";
  const change = seriesChange(comparisonPoints(asset, "fiat", null, fx, span, fine, currency));
  const lead = xbtChange != null && asset.changes[span] != null ? xbtChange - asset.changes[span]! : null;
  const xbtMove = lead == null ? null : inverted ? lead : -lead;
  return (
    <li className="py-3">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 text-left" aria-expanded={open}>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {asset.ticker}
            <span className="font-normal text-muted"> · {asset.name}</span>
          </p>
          <p className="mt-1 text-sm font-medium tabular-nums">{money(asset.price)}</p>
          <p className={"text-xs tabular-nums " + tone(change)}>{formatPct(change)}</p>
        </div>
        <Sparkline values={series} label={span} />
        <div className="w-32 shrink-0 text-right">
          <p className="text-sm font-medium tabular-nums whitespace-nowrap">{inverted ? `XBT buys ${formatQty(units)}` : `XBT ${formatQty(inXbt)}`}</p>
          <p className={"mt-1 text-xs tabular-nums " + tone(xbtMove)}>{formatPct(xbtMove)}</p>
        </div>
      </button>
      {open ? (
        <AssetDetail
          asset={asset}
          currency={currency}
          fx={fx}
          side={side}
          onSide={onSide}
          span={span}
          fine={fine}
          finePending={finePending}
        />
      ) : null}
    </li>
  );
}

function AssetDetail({
  asset,
  currency,
  fx,
  side,
  onSide,
  span,
  fine,
  finePending,
}: {
  asset: AssetRow;
  currency: Currency;
  fx: DayClose[] | null;
  side: ChartSide;
  onSide: (side: ChartSide) => void;
  span: CompareSpan;
  fine: FinePrices | null;
  finePending: boolean;
}) {
  const axes = useContext(SettingsContext).axes;
  return (
    <div className="mt-2 rounded-xl bg-raised px-3 py-3 text-sm">
      <PricedInXbt
        asset={asset}
        axes={axes}
        currency={currency}
        fx={fx}
        side={side}
        onSide={onSide}
        span={span}
        fine={fine}
        finePending={finePending}
      />
    </div>
  );
}

function PricedInXbt({
  asset,
  axes,
  currency,
  fx,
  side,
  onSide,
  span,
  fine,
  finePending,
}: {
  asset: AssetRow;
  axes: boolean;
  currency: Currency;
  fx: DayClose[] | null;
  side: ChartSide;
  onSide: (side: ChartSide) => void;
  span: CompareSpan;
  fine: FinePrices | null;
  finePending: boolean;
}) {
  const history = useQuery({
    queryKey: ["mark-history"],
    queryFn: () => getMarkHistory(),
    enabled: side !== "fiat",
    networkMode: "always",
    gcTime: 24 * 60 * 60 * 1000,
    staleTime: 60 * 60 * 1000,
  });
  const shown = useMemo(() => {
    const marks = new Map((history.data?.points ?? []).map((point) => [point.t, point.c]));
    return comparisonPoints(asset, side, side === "fiat" ? null : marks, fx, span, fine, currency);
  }, [asset, currency, fine, fx, history.data, side, span]);
  const plot = useMemo(() => shown.map((point, i) => ({ ...point, i })), [shown]);
  const marks = axisMarks(shown, span);
  const first = shown[0]?.c ?? null;
  const last = shown[shown.length - 1]?.c ?? null;
  const rising = first != null && last != null ? last >= first : true;
  const stroke = rising ? "var(--color-up)" : "var(--color-down)";
  const waiting =
    (span !== "1m" && finePending) ||
    (span === "1m" && side !== "fiat" && !history.data && (history.isPending || history.isFetching));
  const unit = side === "xbt" ? "XBT" : asset.ticker;

  return (
    <div>
      <div className="grid grid-cols-3 gap-1 rounded-full bg-bg p-1" role="group" aria-label="Price side">
        {(
          [
            ["xbt", "Priced in XBT"],
            ["asset", "Inverted"],
            ["fiat", `Priced in ${currency}`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={side === id}
            onClick={() => onSide(id)}
            className={"min-h-11 rounded-full px-1 text-xs " + (side === id ? "bg-fg text-bg" : "text-muted")}
          >
            {label}
          </button>
        ))}
      </div>
      <div className={axes ? "mt-2 h-48" : "mt-2 h-40"}>
        {waiting ? (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            {span === "1m" ? "Loading the daily average…" : "Loading prices…"}
          </div>
        ) : shown.length < 2 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted">No data available.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={plot} margin={{ top: 8, right: axes ? 4 : 0, left: 0, bottom: 0 }}>
              <XAxis
                dataKey={span === "1w" ? "i" : "t"}
                type="number"
                scale={span === "1w" ? "linear" : "time"}
                domain={span === "1w" ? [0, Math.max(plot.length - 1, 1)] : ["dataMin", "dataMax"]}
                hide={!axes}
                ticks={marks}
                interval={0}
                axisLine={{ stroke: "var(--color-line)" }}
                tickLine={false}
                minTickGap={0}
                tick={{ fill: "var(--color-muted)", fontSize: 10 }}
                tickFormatter={(value: number) =>
                  chartWhen(span === "1w" ? nearestDayStart(plot[value]?.t ?? value, false) : value, span, true)
                }
              />
              <YAxis
                hide={!axes}
                orientation="right"
                width={axes ? (side === "fiat" ? 46 : 44) : 0}
                domain={["auto", "auto"]}
                tick={{ fill: "var(--color-muted)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(value: number) => axisFigure(value, side === "fiat" ? currency : null)}
              />
              <Tooltip
                cursor={{ stroke: "var(--color-line)" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0]?.payload as { t: number; c: number };
                  return (
                    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs text-fg">
                      <div className="text-muted">
                        {chartWhen(row.t, span, false)}
                      </div>
                      <div className="mt-1 font-medium tabular-nums">
                        {side === "fiat" ? formatMoney(row.c, currency) : `${formatQty(row.c)} ${unit}`}
                      </div>
                    </div>
                  );
                }}
              />
              <Area type="monotone" dataKey="c" stroke={stroke} fill={stroke} fillOpacity={0.16} strokeWidth={2} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function Method({ books, money }: { books: XbtBook[]; money: (n: number | null) => string }) {
  return (
    <details className="mt-4 border-t border-line pt-3">
      <summary className="min-h-11 text-sm font-medium">How this average is built</summary>
      <div className="grid gap-3 pb-2 text-sm text-muted">
        <p>Equal-weight counts each live book once, in dollars. Best price is the cheapest of them. Volume-weighted follows the books that traded more.</p>
        <p>XBT is Bitcoin on Blake2b. NonKYC calls it BTCB2.</p>
      </div>
      <Books books={books} money={money} />
      <SatsNote />
    </details>
  );
}
