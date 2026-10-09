import { useQuery } from "@tanstack/react-query";
import { ExternalLink, RefreshCw, Settings, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Sparkline } from "@/components/sparkline";
import { XbtChart } from "@/components/xbt-chart";
import { getBoard } from "@/lib/market/board.functions";
import { formatClock, formatCompactUsd, formatPct, formatPlain, formatQty, formatUsd, tone } from "@/lib/market/format";
import { applySettings, loadSettings, saveSettings, type LinkChoice, type Settings as AppSettings, type ThemeChoice } from "@/lib/settings";
import type { AssetKind, AssetRow, BestPrice, Board, CompareSpan, XbtBook } from "@/lib/market/types";

const GROUPS: Array<{ id: AssetKind; label: string; blurb: string }> = [
  { id: "tech", label: "Tech", blurb: "Big tech stocks. The line under each name is how many shares one XBT buys." },
  { id: "crypto", label: "Crypto", blurb: "Other coins, including some Bitcoin forks. Same idea: how many one XBT buys." },
  { id: "fund", label: "Funds", blurb: "Index funds. Useful when you want to set XBT next to the stock market." },
  { id: "fiat", label: "Fiat", blurb: "Everyday currencies, in dollars. The line shows how much of each one XBT buys." },
];

const SPANS: Array<{ id: CompareSpan; label: string }> = [
  { id: "24h", label: "24h" },
  { id: "1w", label: "1w" },
  { id: "1m", label: "1m" },
];

type SortKey = "day" | "lead";

export function Desk() {
  const board = useQuery({
    queryKey: ["board"],
    queryFn: () => getBoard(),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    applySettings(loadSettings());
  }, []);

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-4 pt-4 pb-16">
      <header className="border-b border-line pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs tracking-widest text-accent uppercase">Bitcoin on Blake2b</p>
            <h1 className="font-display text-3xl text-fg">
              Blake<span className="text-accent">mark</span>
            </h1>
            <p className="mt-1 max-w-md text-sm text-muted">The big number is an average price for Bitcoin on Blake2b.</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <SettingsMenu />
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
        <SatsNote />
      </header>

      {board.isLoading ? <Loading /> : null}
      {board.isError ? (
        <p className="mt-6 rounded-2xl border border-line bg-surface px-4 py-6 text-sm text-down">
          {board.error instanceof Error ? board.error.message : "Could not load quotes."}
        </p>
      ) : null}
      {board.data ? <Loaded data={board.data} /> : null}
    </main>
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
    <p className="mt-2 text-right text-xs text-muted">
      no ads, no paywall, but you can drop me some sats:{" "}
      <button type="button" onClick={copy} className="break-all text-fg underline decoration-line underline-offset-2">
        {SATS}
      </button>
      {copied ? " · copied" : ""}
    </p>
  );
}

function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  function update(next: AppSettings) {
    setSettings(next);
    saveSettings(next);
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
          <div className="fixed inset-x-4 top-20 z-30 mx-auto grid max-w-sm gap-4 rounded-2xl border border-line bg-surface p-4">
            <Choice
              label="Appearance"
              value={settings.theme}
              options={[
                { id: "dark", label: "Dark" },
                { id: "light", label: "Light" },
              ]}
              onChange={(theme) => update({ ...settings, theme })}
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
            <p className="text-xs text-muted">
              {settings.links === "browser"
                ? "Use this if you need to sign in. The exchange opens in your browser, so the login can stick."
                : settings.links === "app"
                  ? "NonKYC markets open the NonKYC app, if you have it. It lands on the app’s own screen, not one book. Neoxa still opens in the browser."
                  : "Keeps the market inside Blakemark. Fine for a quick look. Signing in may not stick."}
            </p>
          </div>
        </>
      ) : null}
    </>
  );
}

function Choice<T extends ThemeChoice | LinkChoice>({
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
  return (
    <div className="mt-5 grid items-start gap-4 lg:grid-cols-2">
      <div className="grid gap-4">
        <Mark data={data} />
        <XbtChart />
        <Books books={data.books} />
        <Method />
      </div>
      <Compare data={data} />
    </div>
  );
}

function Mark({ data }: { data: Board }) {
  const { mark, fx } = data;
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs tracking-widest text-muted uppercase">Equal-weight USD mark</p>
        <p className="text-xs text-muted tabular-nums">{formatClock(data.asOf)}</p>
      </div>
      <p className={"mt-3 font-display text-5xl tabular-nums sm:text-6xl " + tone(mark.changePct)}>
        {formatUsd(mark.equalUsd)}
      </p>
      <BestTicker best={data.best} />
      <p className="mt-2 text-sm">
        <span className={"tabular-nums " + tone(mark.changePct)}>{formatPct(mark.changePct)}</span>
        <span className="text-muted"> 24h · {mark.booksUsed} live books</span>
      </p>
      <p className="mt-1 text-sm text-muted tabular-nums">
        Volume-weighted {formatUsd(mark.vwapUsd)}
        {fx.btcUsd != null ? ` · BTC ref ${formatUsd(fx.btcUsd)} (${fx.btcVenues})` : ""}
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
    </section>
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

function Books({ books }: { books: XbtBook[] }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="font-display text-xl">Books in the mark</h2>
      <p className="mt-1 text-sm text-muted">Each row is one place to buy. Tap Market to open it. The price is the last trade.</p>
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
                {book.status === "ok" ? (book.quote === "BTC" ? formatPlain(book.rawPrice, 6) + " BTC" : formatUsd(book.usdPrice)) : "—"}
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
    </section>
  );
}

function Compare({ data }: { data: Board }) {
  const [kind, setKind] = useState<AssetKind>("tech");
  const [span, setSpan] = useState<CompareSpan>("24h");
  const [sort, setSort] = useState<SortKey>("day");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const xbt = data.mark.equalUsd;
  const xbtChange = data.spans[span];

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const listed = data.assets.filter((asset) => asset.kind === kind);
    const filtered = q
      ? listed.filter((asset) => asset.ticker.toLowerCase().includes(q) || asset.name.toLowerCase().includes(q))
      : listed;
    const copy = [...filtered];
    if (sort === "day") copy.sort((a, b) => (b.changes[span] ?? -Infinity) - (a.changes[span] ?? -Infinity));
    if (sort === "lead" && xbtChange != null) {
      copy.sort((a, b) => {
        const leadA = xbtChange - (a.changes[span] ?? xbtChange);
        const leadB = xbtChange - (b.changes[span] ?? xbtChange);
        return leadB - leadA;
      });
    }
    return copy;
  }, [data.assets, kind, query, sort, span, xbtChange]);

  const group = GROUPS.find((item) => item.id === kind)!;

  return (
    <section className="rounded-2xl border border-line bg-surface p-4 lg:sticky lg:top-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl">Compare</h2>
          <p className="mt-1 text-sm text-muted">{group.blurb}</p>
        </div>
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
      <p className="mt-2 text-xs text-muted">24h is the last day, 1w a week, 1m about a month. The percents follow whichever you pick.</p>

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
              ["day", span],
              ["lead", "vs XBT"],
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
  xbt,
  xbtChange,
  span,
  open,
  onToggle,
}: {
  asset: AssetRow;
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
          <p className="text-sm font-medium tabular-nums">{formatUsd(asset.price)}</p>
          <p className={"text-xs tabular-nums " + tone(change)}>{formatPct(change)}</p>
        </div>
      </button>
      {open ? <AssetDetail asset={asset} /> : null}
    </li>
  );
}

function AssetDetail({ asset }: { asset: AssetRow }) {
  const prices = asset.venues.map((venue) => venue.price);
  const low = prices.length ? Math.min(...prices) : null;
  const high = prices.length ? Math.max(...prices) : null;
  return (
    <div className="mt-2 rounded-xl bg-raised px-3 py-3 text-sm">
      <p className="text-xs text-muted">
        {asset.venues.length} price{asset.venues.length === 1 ? "" : "s"} · {formatUsd(low)} to {formatUsd(high)} · little chart is {asset.sparkLabel}
      </p>
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
              {formatUsd(venue.price)} <span className={tone(venue.changePct)}>{formatPct(venue.changePct)}</span>
            </span>
          </li>
        ))}
        {asset.venues.length === 0 ? <li className="py-2 text-muted">No venue returned a price.</li> : null}
      </ul>
    </div>
  );
}

function Method() {
  return (
    <details className="rounded-2xl border border-line bg-surface px-4 py-3">
      <summary className="min-h-11 text-sm font-medium">How this average is built</summary>
      <div className="grid gap-3 pb-2 text-sm text-muted">
        <p>
          Equal-weight average of the live XBT / BTCB2 books on Neoxa and NonKYC, in BTC, USDT, and USDC, converted to dollars. Volume-weighted sits beside it. Best price is the cheapest of those same trades.
        </p>
        <p>XBT is Bitcoin on Blake2b. NonKYC calls it BTCB2.</p>
      </div>
    </details>
  );
}
