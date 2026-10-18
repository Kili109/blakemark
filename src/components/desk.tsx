import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ExternalLink, RefreshCw, Settings, TriangleAlert } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Sparkline } from "@/components/sparkline";
import { XbtChart } from "@/components/xbt-chart";
import { getBoard, getMarkHistory } from "@/lib/market/board.functions";
import { formatClock, formatCompactUsd, formatPct, formatPlain, formatQty, tone } from "@/lib/market/format";
import { convertSpot, CURRENCIES, formatMoney, presentAsset, traceConvert, tracedChange, tracedSpans } from "@/lib/market/money";
import { applySettings, DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings as AppSettings } from "@/lib/settings";
import type { AssetKind, AssetRow, BestPrice, Board, CompareSpan, XbtBook } from "@/lib/market/types";

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

type SortKey = "listed" | "performance";

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
      </main>
      </SettingsUpdate.Provider>
    </SettingsContext.Provider>
  );
}

const SATS = "bc1qsgwhrct73ag6f6ynfwqlpr2gdqy6s8vr7pwrrk";

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
      <Compare data={data} />
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

function Compare({ data }: { data: Board }) {
  const display = useDisplay(data);
  const [kind, setKind] = useState<AssetKind>("tech");
  const [span, setSpan] = useState<CompareSpan>("24h");
  const [sort, setSort] = useState<SortKey>("performance");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
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
        <h2 className="font-display text-xl">Compare</h2>
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
            xbt={xbt}
            xbtChange={xbtChange}
            span={span}
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
  xbt,
  xbtChange,
  span,
  open,
  onToggle,
}: {
  asset: AssetRow;
  money: (n: number | null) => string;
  xbt: number | null;
  xbtChange: number | null;
  span: CompareSpan;
  open: boolean;
  onToggle: () => void;
}) {
  const units = xbt != null && asset.price != null && asset.price > 0 ? xbt / asset.price : null;
  const change = asset.changes[span];
  const lead = xbtChange != null && change != null ? xbtChange - change : null;
  return (
    <li className="py-3">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 text-left" aria-expanded={open}>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {asset.ticker}
            <span className="font-normal text-muted"> · {asset.name}</span>
          </p>
          <p className="mt-1 text-xs text-muted tabular-nums">
            1 XBT buys {formatQty(units)}
            {lead != null ? (
              <>
                {" · XBT "}
                <span className={tone(lead)}>{formatPct(lead)}</span> vs this
              </>
            ) : null}
          </p>
        </div>
        <Sparkline values={asset.spark} label={asset.sparkLabel} />
        <div className="w-24 shrink-0 text-right">
          <p className="text-sm font-medium tabular-nums">{money(asset.price)}</p>
          <p className={"text-xs tabular-nums " + tone(change)}>{formatPct(change)}</p>
        </div>
      </button>
      {open ? <AssetDetail asset={asset} money={money} /> : null}
    </li>
  );
}

function AssetDetail({ asset, money }: { asset: AssetRow; money: (n: number | null) => string }) {
  const axes = useContext(SettingsContext).axes;
  const [view, setView] = useState<"prices" | "chart">("prices");
  const prices = asset.venues.map((venue) => venue.price);
  const low = prices.length ? Math.min(...prices) : null;
  const high = prices.length ? Math.max(...prices) : null;
  const range = low != null && high != null && money(low) !== money(high) ? ` · ${money(low)} to ${money(high)}` : "";
  return (
    <div className="mt-2 rounded-xl bg-raised px-3 py-3 text-sm">
      <p className="text-xs text-muted">
        {asset.venues.length} price{asset.venues.length === 1 ? "" : "s"}
        {range} · little chart is {asset.sparkLabel}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-1 rounded-full bg-bg p-1" role="group" aria-label="Row detail">
          {(
            [
              ["prices", "Prices"],
              ["chart", "Chart"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={view === id}
              onClick={() => setView(id)}
              className={"min-h-11 rounded-full text-sm " + (view === id ? "bg-fg text-bg" : "text-muted")}
            >
              {label}
            </button>
          ))}
        </div>
      {view === "chart" ? (
        <PricedInXbt asset={asset} axes={axes} />
      ) : (
        <>
          {asset.caution ? (
            <p className="mt-2 flex items-start gap-2 text-xs text-down">
              <TriangleAlert className="mt-0.5 size-3 shrink-0" />
              {asset.caution}
            </p>
          ) : null}
          <ul className="mt-2 divide-y divide-line">
            {asset.venues.map((venue) => (
              <li key={venue.name} className="flex items-center justify-between py-2">
                <span>{venue.name}</span>
                <span className="tabular-nums">
                  {money(venue.price)}{" "}
                  {venue.changePct != null ? <span className={tone(venue.changePct)}>{formatPct(venue.changePct)}</span> : null}
                </span>
              </li>
            ))}
            {asset.venues.length === 0 ? <li className="py-2 text-muted">No venue returned a price.</li> : null}
          </ul>
        </>
      )}
    </div>
  );
}

function PricedInXbt({ asset, axes }: { asset: AssetRow; axes: boolean }) {
  const [side, setSide] = useState<"xbt" | "asset">("xbt");
  const history = useQuery({
    queryKey: ["mark-history"],
    queryFn: () => getMarkHistory(),
    networkMode: "always",
    gcTime: 24 * 60 * 60 * 1000,
    staleTime: 60 * 60 * 1000,
  });
  const points = useMemo(() => {
    const marks = new Map((history.data?.points ?? []).map((point) => [point.t, point.c]));
    return asset.daily
      .map((day) => {
        const mark = marks.get(day.t);
        if (mark == null || mark <= 0 || day.c <= 0) return null;
        const c = side === "xbt" ? day.c / mark : mark / day.c;
        return { t: day.t, c };
      })
      .filter((point): point is { t: number; c: number } => point != null);
  }, [asset.daily, history.data, side]);
  const first = points[0]?.c ?? null;
  const last = points[points.length - 1]?.c ?? null;
  const rising = first != null && last != null ? last >= first : true;
  const stroke = rising ? "var(--color-up)" : "var(--color-down)";
  const waiting = !history.data && (history.isPending || history.isFetching);
  const unit = side === "xbt" ? "XBT" : asset.ticker;

  return (
    <div className="mt-3">
      <div className="grid grid-cols-2 gap-1 rounded-full bg-bg p-1" role="group" aria-label="Price side">
        {(
          [
            ["xbt", "Priced in XBT"],
            ["asset", `Priced in ${asset.ticker}`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={side === id}
            onClick={() => setSide(id)}
            className={"min-h-11 rounded-full px-2 text-sm " + (side === id ? "bg-fg text-bg" : "text-muted")}
          >
            {label}
          </button>
        ))}
      </div>
      <div className={axes ? "mt-2 h-48" : "mt-2 h-40"}>
        {waiting ? (
          <div className="flex h-full items-center justify-center text-sm text-muted">Loading the daily average…</div>
        ) : points.length < 2 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted">No data available.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: axes ? 4 : 0, left: 0, bottom: 0 }}>
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                hide={!axes}
                tick={{ fill: "var(--color-muted)", fontSize: 10 }}
                axisLine={{ stroke: "var(--color-line)" }}
                tickLine={false}
                minTickGap={28}
                tickFormatter={(value: number) =>
                  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(value)
                }
              />
              <YAxis
                hide={!axes}
                orientation="right"
                width={axes ? 48 : 0}
                domain={["auto", "auto"]}
                tick={{ fill: "var(--color-muted)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(value: number) => formatQty(value)}
              />
              <Tooltip
                cursor={{ stroke: "var(--color-line)" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0]?.payload as { t: number; c: number };
                  return (
                    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs text-fg">
                      <div className="text-muted">
                        {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(row.t)}
                      </div>
                      <div className="mt-1 font-medium tabular-nums">
                        {formatQty(row.c)} {unit}
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
