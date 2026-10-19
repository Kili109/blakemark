import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getBlocks } from "@/lib/market/board.functions";
import { reachAmount, type ChainMiners, type MinerRow } from "@/lib/market/blocks";

function signed(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { signDisplay: "exceptZero" }).format(n);
}

function whole(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

function feeRate(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const text = n >= 10 ? n.toFixed(0) : n.toFixed(1);
  return `${text} sats/vB`;
}

function byteSize(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${Math.round(n)} B`;
}

function weightRow(weight: number | null, max: number, size: number | null): string {
  const pct = weight == null || !(max > 0) ? "—" : `${((weight / max) * 100).toFixed(1)}% full`;
  const units = weight == null ? "—" : `${whole(weight)} weight units`;
  return `${pct} · ${byteSize(size)} · ${units}`;
}

function rowsFor(chain: ChainMiners): MinerRow[] {
  if (!chain.miners.length) return chain.pools;
  const named = new Map<string, number>();
  for (const miner of chain.miners) named.set(miner.pool, (named.get(miner.pool) ?? 0) + miner.blocks);
  const rows = [...chain.miners];
  for (const pool of chain.pools) {
    const gap = pool.blocks - (named.get(pool.name) ?? 0);
    if (gap > 0) rows.push({ name: pool.name, pool: pool.name, blocks: gap });
  }
  return rows;
}

function sideAmount(chain: ChainMiners | null, percent: number): { amount: number | null; unit: "miners" | "pools" } {
  if (!chain) return { amount: null, unit: "miners" };
  if (chain.miners.length) return { amount: reachAmount(rowsFor(chain), chain.total, percent), unit: "miners" };
  return { amount: reachAmount(chain.pools, chain.total, percent), unit: "pools" };
}

function amountText(amount: number | null, unit: "miners" | "pools"): string {
  if (amount == null) return "can't reach it";
  const text = amount.toFixed(1);
  const one = unit === "miners" ? "miner" : "pool";
  return `${text} ${text === "1.0" ? one : unit}`;
}

function Decentralisation({ blake2b, bitcoin }: { blake2b: ChainMiners | null; bitcoin: ChainMiners | null }) {
  const points = useMemo(() => {
    const rows: Array<{ p: number; ratio: number; left: string; right: string }> = [];
    for (let percent = 1; percent <= 90; percent += 1) {
      const left = sideAmount(blake2b, percent);
      const right = sideAmount(bitcoin, percent);
      if (left.amount == null || right.amount == null || !(right.amount > 0)) continue;
      rows.push({
        p: percent,
        ratio: left.amount / right.amount,
        left: amountText(left.amount, left.unit),
        right: amountText(right.amount, right.unit),
      });
    }
    return rows;
  }, [blake2b, bitcoin]);

  return (
    <div>
      <p className="text-xs tracking-widest text-muted uppercase">Decentralisation</p>
      {points.length < 2 ? (
        <p className="mt-3 text-sm text-muted">No comparison yet.</p>
      ) : (
        <div className="mt-3 h-48">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
              <XAxis
                dataKey="p"
                type="number"
                domain={[0, 90]}
                ticks={[30, 60, 90]}
                interval={0}
                axisLine={{ stroke: "var(--color-line)" }}
                tickLine={false}
                tick={{ fill: "var(--color-muted)", fontSize: 10 }}
                tickFormatter={(value: number) => `${value}%`}
              />
              <YAxis
                orientation="right"
                width={40}
                domain={[0, "auto"]}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "var(--color-muted)", fontSize: 10 }}
                tickFormatter={(value: number) => `${Number(value.toFixed(1))}×`}
              />
              <Tooltip
                cursor={{ stroke: "var(--color-line)" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0]?.payload as { p: number; ratio: number; left: string; right: string };
                  return (
                    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs text-fg">
                      <div className="text-muted">{row.p}%</div>
                      <div className="mt-1 font-medium tabular-nums">{row.ratio.toFixed(1)}×</div>
                      <div className="mt-1 text-muted tabular-nums">
                        {row.left} · {row.right}
                      </div>
                    </div>
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="ratio"
                stroke="var(--color-accent)"
                fill="var(--color-accent)"
                fillOpacity={0.16}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="mt-1 text-xs text-muted">
        Blake2b miners divided by SHA256 pools, up to 90% of the last day's blocks.
      </p>
    </div>
  );
}

export function BlocksCard() {
  const blocks = useQuery({
    queryKey: ["blocks"],
    queryFn: () => getBlocks(),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
  const data = blocks.data;

  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-xl">Blocks</h2>
      </div>
      {blocks.isPending && !data ? <p className="mt-4 text-sm text-muted">Loading blocks…</p> : null}
      {blocks.isError && !data ? (
        <p className="mt-4 text-sm text-down">{blocks.error instanceof Error ? blocks.error.message : "Could not load blocks."}</p>
      ) : null}
      {data ? (
        <div className="mt-4 grid gap-4">
          <div>
            <p className="text-xs tracking-widest text-muted uppercase">Fees</p>
            <p className="mt-1 text-sm tabular-nums">
              Last block {feeRate(data.fees.lastRate)}
            </p>
            <p className="mt-1 text-sm tabular-nums text-muted">24h average {feeRate(data.fees.avgRate)}</p>
          </div>
          <div>
            <p className="text-xs tracking-widest text-muted uppercase">Weight</p>
            <p className="mt-1 text-sm tabular-nums">Last block {weightRow(data.weight.last, data.weight.max, data.weight.lastSize)}</p>
            <p className="mt-1 text-sm tabular-nums text-muted">
              24h average {weightRow(data.weight.avg, data.weight.max, data.weight.avgSize)}
            </p>
          </div>
          <div>
            <p className="text-xs tracking-widest text-muted uppercase">UTXO count</p>
            <p className="mt-1 text-lg font-medium tabular-nums">{whole(data.utxo.total)}</p>
            <p className="mt-1 text-sm tabular-nums">Since Block 961,640 {signed(data.utxo.sincePow)}</p>
            <p className="mt-1 text-sm tabular-nums">Last block {signed(data.utxo.block)}</p>
            <p className="mt-1 text-sm tabular-nums">Last epoch {signed(data.utxo.lastEpoch)}</p>
            <p className="mt-1 text-sm tabular-nums">Current epoch {signed(data.utxo.currentEpoch)}</p>
            <p className="mt-1 text-sm tabular-nums">Last halving {signed(data.utxo.lastHalving)}</p>
            <p className="mt-1 text-sm tabular-nums">Current halving {signed(data.utxo.currentHalving)}</p>
          </div>
          <Decentralisation blake2b={data.blake2b} bitcoin={data.bitcoin} />
          <div>
            <p className="text-xs tracking-widest text-muted uppercase">Largest miner · 24h</p>
            {data.miner ? (
              <>
                <p className="mt-1 text-lg font-medium">{data.miner.name}</p>
                <p className="mt-1 text-sm tabular-nums">
                  {data.miner.share.toFixed(1)}% of hashrate
                  <span className="text-muted">
                    {" "}
                    · {data.miner.blocks} of {data.miner.total} blocks · {data.miner.pool}
                  </span>
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-muted">No named miner in the last day.</p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
