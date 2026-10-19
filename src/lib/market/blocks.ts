const GUIDE = "https://mempool.guide/api";
const SPACE = "https://mempool.space/api";
const PERIOD = 2016;
const EPOCH = 210_000;
const POW = 961_640;
const MAX_WEIGHT = 4_000_000;
const TTL_MS = 5 * 60 * 1000;

export type MinerRow = { name: string; pool: string; blocks: number };

export type ChainMiners = {
  total: number;
  miners: MinerRow[];
  pools: MinerRow[];
};

export type BlocksView = {
  asOf: number;
  height: number;
  miner: { name: string; pool: string; blocks: number; total: number; share: number } | null;
  blake2b: ChainMiners | null;
  bitcoin: ChainMiners | null;
  fees: { lastRate: number | null; avgRate: number | null };
  weight: { last: number | null; avg: number | null; max: number; lastSize: number | null; avgSize: number | null };
  utxo: {
    total: number | null;
    block: number | null;
    lastEpoch: number | null;
    currentEpoch: number | null;
    lastHalving: number | null;
    currentHalving: number | null;
    sincePow: number | null;
  };
};

type RawBlock = {
  height: number;
  weight: number;
  size?: number;
  extras?: {
    totalFees?: number;
    medianFee?: number;
    utxoSetChange?: number | null;
    utxoSetSize?: number | null;
  };
};

let cache: { at: number; data: BlocksView } | null = null;
let flight: Promise<BlocksView> | null = null;

async function getJson(base: string, path: string, ms = 12000): Promise<unknown | null> {
  try {
    const res = await fetch(`${base}${path}`, {
      headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; Blakemark/1.0)" },
      signal: AbortSignal.timeout(ms),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export function reachCount(rows: MinerRow[], total: number, percent: number): number | null {
  const reached = reachAmount(rows, total, percent);
  if (reached == null) return null;
  return Math.ceil(reached - 1e-9);
}

/** How far down the list, in whole and partial names, until the share is covered. */
export function reachAmount(rows: MinerRow[], total: number, percent: number): number | null {
  if (!(total > 0) || !(percent > 0)) return null;
  const need = (total * percent) / 100;
  const sorted = [...rows].filter((row) => row.blocks > 0).sort((a, b) => b.blocks - a.blocks);
  let sum = 0;
  let count = 0;
  for (const row of sorted) {
    if (sum >= need) return count;
    if (sum + row.blocks >= need) return count + (need - sum) / row.blocks;
    sum += row.blocks;
    count += 1;
  }
  return null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function blockAt(body: unknown, height: number): RawBlock | null {
  if (!Array.isArray(body)) return null;
  for (const item of body) {
    if (!item || typeof item !== "object") continue;
    const row = item as RawBlock;
    if (row.height === height) return row;
  }
  return null;
}

function afterCount(block: RawBlock | null): number | null {
  return num(block?.extras?.utxoSetSize);
}

function spanChange(end: RawBlock | null, start: RawBlock | null): number | null {
  const endSize = afterCount(end);
  const startSize = afterCount(start);
  const startChange = num(start?.extras?.utxoSetChange);
  if (endSize == null || startSize == null || startChange == null) return null;
  return endSize - (startSize - startChange);
}

async function latestSized(height: number): Promise<RawBlock | null> {
  let cursor = height;
  for (let page = 0; page < 8 && cursor >= 1; page += 1) {
    const body = await getJson(GUIDE, `/v1/blocks/${cursor}`);
    if (!Array.isArray(body) || !body.length) return null;
    let best: RawBlock | null = null;
    let oldest = cursor;
    for (const item of body) {
      if (!item || typeof item !== "object") continue;
      const row = item as RawBlock;
      if (row.height < oldest) oldest = row.height;
      if (num(row.extras?.utxoSetSize) == null) continue;
      if (!best || row.height > best.height) best = row;
    }
    if (best) return best;
    cursor = oldest - 1;
  }
  return null;
}

function windows(height: number, length: number): { current: { from: number; to: number }; last: { from: number; to: number } } {
  const into = height % length;
  const currentFrom = into === 0 ? height - length + 1 : height - into + 1;
  const lastTo = currentFrom - 1;
  return {
    current: { from: currentFrom, to: height },
    last: { from: lastTo - length + 1, to: lastTo },
  };
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function loadBlocks(): Promise<BlocksView> {
  if (cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.data);
  if (!flight) {
    flight = buildBlocks()
      .then((data) => {
        cache = { at: Date.now(), data };
        return data;
      })
      .finally(() => {
        flight = null;
      });
  }
  return flight;
}

async function buildBlocks(): Promise<BlocksView> {
  const height = num(await getJson(GUIDE, "/blocks/tip/height"));
  if (height == null) throw new Error("No block height");
  const diff = windows(height, PERIOD);
  const half = windows(height, EPOCH);
  const blocks = new Map<number, Promise<unknown>>();
  const need = (blockHeight: number) => {
    if (blockHeight === height || blockHeight < 1) return;
    if (!blocks.has(blockHeight)) blocks.set(blockHeight, getJson(GUIDE, `/v1/blocks/${blockHeight}`));
  };
  for (const span of [diff.current, diff.last, half.current, half.last]) {
    need(span.from);
    need(span.to);
  }
  need(POW);
  const [poolsBody, bitcoinBody, feesBody, weightBody, tipBody, blockBodies, sized] = await Promise.all([
    getJson(GUIDE, "/v1/mining/pools/24h"),
    getJson(SPACE, "/v1/mining/pools/24h"),
    getJson(GUIDE, "/v1/mining/blocks/fee-rates/24h"),
    getJson(GUIDE, "/v1/mining/blocks/sizes-weights/24h"),
    getJson(GUIDE, `/v1/blocks/${height}`),
    Promise.all([...blocks.values()]),
    latestSized(height),
  ]);
  const byHeight = new Map<number, RawBlock | null>();
  byHeight.set(height, blockAt(tipBody, height));
  for (const body of blockBodies) {
    if (!Array.isArray(body)) continue;
    for (const item of body) {
      if (!item || typeof item !== "object") continue;
      const row = item as RawBlock;
      if (typeof row.height === "number") byHeight.set(row.height, row);
    }
  }
  const at = (blockHeight: number) => byHeight.get(blockHeight) ?? null;
  const change = (span: { from: number; to: number }, end: RawBlock | null = at(span.to)) =>
    span.from < 1 ? null : spanChange(end, at(span.from));
  const through = (span: { from: number; to: number }) => {
    if (!sized || sized.height < span.from) return null;
    return change(span, sized.height <= span.to ? sized : at(span.to));
  };

  const powSize = afterCount(at(POW));
  const nowSize = afterCount(sized);
  const tip = blockAt(tipBody, height);
  const rates = Array.isArray(feesBody) ? feesBody : [];
  const rateValues = rates
    .map((item) => num((item as { avgFee_50?: number }).avgFee_50))
    .filter((value): value is number => value != null);
  const weights = Array.isArray((weightBody as { weights?: unknown }).weights) ? (weightBody as { weights: unknown[] }).weights : [];
  const weightValues = weights
    .map((item) => num((item as { avgWeight?: number }).avgWeight))
    .filter((value): value is number => value != null);
  const sizes = Array.isArray((weightBody as { sizes?: unknown }).sizes) ? (weightBody as { sizes: unknown[] }).sizes : [];
  const sizeValues = sizes
    .map((item) => num((item as { avgSize?: number }).avgSize))
    .filter((value): value is number => value != null);

  return {
    asOf: Date.now(),
    height,
    miner: topMiner(poolsBody),
    blake2b: chainMiners(poolsBody),
    bitcoin: chainMiners(bitcoinBody),
    fees: {
      lastRate: num(tip?.extras?.medianFee),
      avgRate: mean(rateValues),
    },
    weight: {
      last: num(tip?.weight),
      avg: mean(weightValues),
      max: MAX_WEIGHT,
      lastSize: num(tip?.size),
      avgSize: mean(sizeValues),
    },
    utxo: {
      total: afterCount(sized),
      block: num(tip?.extras?.utxoSetChange),
      lastEpoch: change(diff.last),
      currentEpoch: through(diff.current),
      lastHalving: change(half.last),
      currentHalving: through(half.current),
      sincePow: powSize != null && nowSize != null ? nowSize - powSize : null,
    },
  };
}

function chainMiners(body: unknown): ChainMiners | null {
  if (!body || typeof body !== "object") return null;
  const pools = (body as { pools?: unknown }).pools;
  const total = num((body as { blockCount?: number }).blockCount);
  if (!Array.isArray(pools) || total == null || total <= 0) return null;
  const miners: MinerRow[] = [];
  const poolRows: MinerRow[] = [];
  for (const pool of pools) {
    if (!pool || typeof pool !== "object") continue;
    const row = pool as { name?: string; blockCount?: number; miners?: Array<{ name?: string; blockCount?: number }> };
    const poolName = typeof row.name === "string" ? row.name : "Pool";
    const poolBlocks = num(row.blockCount);
    if (poolBlocks != null && poolBlocks > 0) poolRows.push({ name: poolName, pool: poolName, blocks: poolBlocks });
    for (const miner of row.miners ?? []) {
      const blocks = num(miner.blockCount);
      const name = typeof miner.name === "string" ? miner.name.trim() : "";
      if (!name || blocks == null || blocks <= 0) continue;
      miners.push({ name, pool: poolName, blocks });
    }
  }
  return { total, miners, pools: poolRows };
}

function topMiner(body: unknown): BlocksView["miner"] {
  const pools = (body as { pools?: unknown; blockCount?: number }).pools;
  const total = num((body as { blockCount?: number }).blockCount);
  if (!Array.isArray(pools) || total == null || total <= 0) return null;
  let best: { name: string; pool: string; blocks: number } | null = null;
  for (const pool of pools) {
    if (!pool || typeof pool !== "object") continue;
    const row = pool as { name?: string; miners?: Array<{ name?: string; blockCount?: number }> };
    const poolName = typeof row.name === "string" ? row.name : "Pool";
    for (const miner of row.miners ?? []) {
      const blocks = num(miner.blockCount);
      const name = typeof miner.name === "string" ? miner.name : "";
      if (!name || blocks == null || blocks <= 0) continue;
      if (!best || blocks > best.blocks) best = { name, pool: poolName, blocks };
    }
  }
  if (!best) return null;
  return { ...best, total, share: (best.blocks / total) * 100 };
}
