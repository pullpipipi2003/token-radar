// Quantitative Multi-Factor Token Launch Valuation Model & Actionable Farming Engine
//
// Evaluates pre-token DeFi protocols from the sealed DefiLlama snapshot using four quantitative factors
// derived strictly from snapshot metrics (never hardcoded by protocol name):
//
//   1. Sector Valuation Multiple (sectorMult): Calibrated P/TVL baseline by protocol category
//      (Derivatives/Perps 0.42x, Restaking 0.35x, Bridges 0.32x, RWA 0.30x, Lending/CDP 0.28x, DEX 0.26x, Yield 0.18x)
//   2. Momentum Factor (growthMult): 1 + (clamp(change_7d, -60, 120) / 100) * 0.55
//   3. Longevity & Points Accumulation Factor (maturityMult): 0.65 + min(age_days, 1095) / 1095 * 0.45
//   4. Liquidity Moat Scale Factor (scaleMult): 1 + min(0.25, max(0, log10(tvl_usd / 10,000,000)) * 0.08)
//
//   Implied FDV = max(1, round(tvl_usd * sectorMult * growthMult * maturityMult * scaleMult))
//   Estimated Airdrop Pool (7.5% TGE allocation) = round(Implied FDV * 0.075)

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  airdrop_allocation_pct: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.28,
  growth_weight: 0.55,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.65,
  maturity_range: 0.45,
  maturity_days: 1095,
  unknown_age_days: 365,
  airdrop_allocation_pct: 7.5,
};

export const MODEL_VERSION = 'quant-radar-v2';
export const EARLY_ROWS = 170;
export const LIVE_ROWS = 30;

export interface FarmStep {
  phase: string;
  text: string;
  cost: string;
  time: string;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    sector_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    scale_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  airdrop_pool_usd: number;
  sector_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  scale_multiplier: number;
  is_watchlist: boolean;
  tier: 'S-Tier' | 'A-Tier' | 'B-Tier' | 'Discovery';
  capital_usd: number;
  hold_days: number;
  gas_tier: string;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl_ratio: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_pretoken_tvl_usd: number;
  total_implied_fdv_usd: number;
  total_airdrop_pool_usd: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Sector-calibrated Valuation Multiple (Implied FDV / TVL baseline) based on capital velocity & revenue density. */
export function sectorMultiple(category: string | null, fallback: number): number {
  const c = (category ?? '').toLowerCase();
  if (c.includes('derivative') || c.includes('perp') || c.includes('option') || c.includes('prediction')) return 0.42;
  if (c.includes('restak') || c.includes('liquid staking') || c.includes('staking')) return 0.35;
  if (c.includes('bridge') || c.includes('cross chain') || c.includes('interoperability')) return 0.32;
  if (c.includes('rwa') || c.includes('real world') || c.includes('reserve')) return 0.31;
  if (c.includes('lend') || c.includes('cdp') || c.includes('uncollateralized')) return 0.29;
  if (c.includes('dex') || c.includes('amm') || c.includes('launchpad')) return 0.27;
  if (c.includes('yield') || c.includes('farm') || c.includes('curator') || c.includes('index')) return 0.21;
  return fallback;
}

/** Quantitative valuation engine computing implied token FDV from TVL, category, 7d growth, maturity, and liquidity scale. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): {
  implied: number;
  sectorMult: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  scaleMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const sectorMult = sectorMultiple(protocol.category, model.base_multiple);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;

  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;

  const tvlRatio = Math.max(1, protocol.tvl_usd / 10_000_000);
  const scaleMult = 1 + Math.min(0.25, Math.log10(tvlRatio) * 0.08);

  const base = protocol.tvl_usd * sectorMult;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * scaleMult));
  return { implied, sectorMult, growthPct, growthMult, maturityMult, scaleMult, age };
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

export function stepText(step: FarmStep): string {
  let s = `[${step.phase}] ${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Maintain active position and monitor official governance channels.`;
  return s;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its primary network';
}

function gasProfile(chain: string): { setupGas: string; weeklyGas: string; tier: string } {
  const c = chain.toLowerCase();
  if (c.includes('solana') || c.includes('sui') || c.includes('aptos') || c.includes('sei')) {
    return { setupGas: '$0.02 in native gas', weeklyGas: '$0.01/week in network fees', tier: 'Ultra-Low (<$0.05)' };
  }
  if (c.includes('ethereum') || c.includes('bitcoin')) {
    return { setupGas: '$8 to $18 in L1 gas fees', weeklyGas: '$4 to $9/week during off-peak UTC', tier: 'High L1 ($10+)' };
  }
  return { setupGas: '$0.15 to $0.60 in L2/EVM gas', weeklyGas: '$0.10 to $0.30/week', tier: 'Low L2 ($0.20)' };
}

export function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 2_500_000_000) return 500;
  if (p.tvl_usd >= 500_000_000) return 250;
  if (p.tvl_usd >= 50_000_000) return 150;
  return 75;
}

export function holdDaysFor(age: number | null): number {
  if (age === null) return 35;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function coreActionFor(p: SnapshotProtocol, capital: number, chain: string): { deploy: string; optimize: string } {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const secondChain = p.chains.length > 1 ? p.chains[1]! : chain;

  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return {
      deploy: `Supply $${capital} of core collateral (USDC or native blue-chip asset) into ${name}'s primary lending market on ${chain}.`,
      optimize: `Borrow 35% to 45% against your collateral in stablecoins and re-supply into ${name} to stack dual supply-and-borrow point multipliers while keeping health factor above 1.8.`,
    };
  }
  if (c.includes('derivative') || c.includes('perp') || c.includes('option')) {
    return {
      deploy: `Deposit $${capital} USDC into ${name}'s margin vault on ${chain} and allocate 40% to the protocol's liquidity provider vault.`,
      optimize: `Place 2 to 3 small limit orders per week at low leverage (2x or less) on major pairs, sized so a 10% move cannot liquidate you, and read the protocol's rules on which activity counts.`,
    };
  }
  if (c.includes('dex') || c.includes('amm')) {
    return {
      deploy: `Provide $${capital} in balanced two-sided liquidity into ${name}'s highest-volume pool on ${chain} and stake the LP receipt.`,
      optimize: `Route 2 organic token swaps ($25+ each) weekly through ${name}'s router across ${chain} and ${secondChain} to qualify for both LP and active trader distribution tiers.`,
    };
  }
  if (c.includes('restak') || c.includes('staking')) {
    return {
      deploy: `Stake $${capital} equivalent of native or liquid-staked assets into ${name} on ${chain} to mint the protocol's receipt token.`,
      optimize: `Deploy the ${name} receipt token into an integrated DeFi money market or pendle-style yield pool on ${chain} to capture 2x composable ecosystem multipliers.`,
    };
  }
  if (c.includes('bridge') || c.includes('cross chain')) {
    return {
      deploy: `Bridge $${capital} of USDC or native assets from ${chain} to ${secondChain} using ${name}'s canonical liquidity pathway.`,
      optimize: `Provide $${Math.round(capital * 0.6)} into ${name}'s cross-chain relayer or fast-liquidity pool and bridge across at least 3 supported destination chains monthly.`,
    };
  }
  if (c.includes('rwa') || c.includes('stable') || c.includes('reserve')) {
    return {
      deploy: `Mint or acquire $${capital} of ${name}'s yield-bearing stable/RWA asset directly through the primary contract on ${chain}.`,
      optimize: `Lock ${name}'s asset in the protocol's sVault or liquidity stability module for boosted governance weight and base treasury yield.`,
    };
  }
  return {
    deploy: `Deposit $${capital} of USDC or primary asset into ${name}'s flagship vault on ${chain} and confirm active share issuance.`,
    optimize: `Compound earned yield shares bi-weekly and interact with ${name}'s secondary modules on ${secondChain} to maximize multi-contract footprint.`,
  };
}

/** Generates 6 concrete, protocol-specific farming steps with explicit capital, gas cost, and time horizons. */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasProfile(chain);
  const actions = coreActionFor(p, capital, chain);

  return [
    {
      phase: '1. Wallet Setup',
      text: `Use one dedicated wallet of your own on ${chain}, fund it from an exchange withdrawal, read ${p.name}'s terms and eligibility rules first, and revoke stale token approvals.`,
      cost: gas.setupGas,
      time: '10 minutes',
    },
    {
      phase: '2. Core Deployment',
      text: actions.deploy,
      cost: `$${capital} principal capital + ${gas.setupGas}`,
      time: '15 minutes setup',
    },
    {
      phase: '3. Multiplier Optimization',
      text: actions.optimize,
      cost: `$0 additional principal + ${gas.setupGas}`,
      time: '20 minutes',
    },
    {
      phase: '4. Steady Activity',
      text: `Make at least 1 genuine use of ${p.name} each week for 4+ calendar weeks (rebalance, claim fees, or vote in governance) so your history shows sustained, real usage.`,
      cost: gas.weeklyGas,
      time: '10 minutes/week',
    },
    {
      phase: '5. Snapshot Retention',
      text: `Maintain the $${capital} active position in ${p.name} continuously for at least ${hold} days to maximize time-weighted average balance (TWAB) before TGE snapshot cutoff.`,
      cost: `$${capital} locked opportunity cost`,
      time: `${hold} days continuous hold`,
    },
    {
      phase: '6. Claim & Unwind',
      text: `Check points on ${p.name}'s official dashboard, claim any allocation only from links in its official docs (never pay a fee to claim), and withdraw principal after the snapshot. No token is promised.`,
      cost: '$0 claim check + standard exit gas',
      time: '15 minutes at TGE',
    },
  ];
}

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();

  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }

  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const metrics = impliedValue(p, snapshot.as_of, model);
    return { p, ...metrics };
  });

  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      sector_multiple: round4(s.sectorMult),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      scale_multiplier: round4(s.scaleMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl_ratio: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

function tierOf(implied: number, isWatchlist: boolean): 'S-Tier' | 'A-Tier' | 'B-Tier' | 'Discovery' {
  if (implied >= 250_000_000) return 'S-Tier';
  if (implied >= 50_000_000) return 'A-Tier';
  if (isWatchlist || implied >= 15_000_000) return 'B-Tier';
  return 'Discovery';
}

export function radarRow(row: BoardRow, watchlistSet: Set<string>, allocPct: number): RadarRow {
  const isWatch = watchlistSet.has(row.slug);
  const chain = row.chains.length > 0 ? row.chains[0]! : 'Mainnet';
  const gas = gasProfile(chain);
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    airdrop_pool_usd: Math.max(1, Math.round(row.implied_value_usd * (allocPct / 100))),
    sector_multiple: row.model.sector_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    scale_multiplier: row.model.scale_multiplier,
    is_watchlist: isWatch,
    tier: tierOf(row.implied_value_usd, isWatch),
    capital_usd: capitalFor(row),
    hold_days: holdDaysFor(row.age_days),
    gas_tier: gas.tier,
    farm_steps: row.farm_steps,
  };
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watchlistSet = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlistSet.has(r.slug)).length;
  const rows = board.map((r) => radarRow(r, watchlistSet, model.airdrop_allocation_pct));

  const totalPretokenTvl = rows.reduce((acc, r) => acc + r.tvl_usd, 0);
  const totalImpliedFdv = rows.reduce((acc, r) => acc + r.implied_value_usd, 0);
  const totalAirdropPool = rows.reduce((acc, r) => acc + r.airdrop_pool_usd, 0);

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    total_pretoken_tvl_usd: totalPretokenTvl,
    total_implied_fdv_usd: totalImpliedFdv,
    total_airdrop_pool_usd: totalAirdropPool,
    rows,
    live,
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug(s): ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
