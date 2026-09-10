import { z } from 'zod';
import { ASSET_CATALOG } from './personal.js';

export const rewardRulesSchema = z
  .object({
    version: z.number().int().positive(),
    xpPerMinute: z.number().int().min(1).max(20),
    coinsPerMinute: z.number().int().min(1).max(10),
    roundXp: z.number().int().min(0).max(50),
    roundCoins: z.number().int().min(0).max(20),
    goalXp: z.number().int().min(0).max(20),
    goalCoins: z.number().int().min(0).max(10),
    togetherXp: z.number().int().min(0).max(20),
    togetherCoins: z.number().int().min(0).max(10),
  })
  .strict();
export type RewardRules = z.infer<typeof rewardRulesSchema>;
export const INITIAL_RULES: RewardRules = {
  version: 1,
  xpPerMinute: 2,
  coinsPerMinute: 1,
  roundXp: 5,
  roundCoins: 2,
  goalXp: 5,
  goalCoins: 2,
  togetherXp: 5,
  togetherCoins: 2,
};
export const levelFor = (xp: number) => 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 100));
export const levelFloor = (level: number) => 100 * (level - 1) ** 2;
const prices: Record<string, [number, number]> = {
  'outfit.clay': [5, 1],
  'outfit.blue': [15, 1],
  'outfit.lilac': [25, 2],
  'accessory.glasses': [10, 1],
  'accessory.headphones': [25, 2],
  'accessory.beret': [20, 1],
  'room.arch': [40, 2],
  'desk.walnut': [20, 1],
  'chair.cream': [15, 1],
  'desktop.books': [10, 1],
  'wall.clock': [15, 1],
  'window.flowers': [5, 1],
  'rug.sand': [10, 1],
  'light.warm': [15, 2],
  'motion.stretch': [0, 2],
  'expression.sparkle': [10, 2],
};
export const GROWTH_CATALOG = [
  ...ASSET_CATALOG.map((a) => ({ id: a.id, name: a.name, color: a.color, slot: a.category })),
  ...(['birds', 'rain', 'fire', 'stream'] as const).map((s, i) => ({
    id: `sound.${s}`,
    name: ['林间鸟鸣', '窗外细雨', '壁炉', '溪流'][i],
    color: '#8aa998',
    slot: 'sound',
  })),
].map((a) => ({
  ...a,
  price: prices[a.id]?.[0] ?? (a.id === 'sound.stream' ? 10 : 0),
  minLevel: prices[a.id]?.[1] ?? 1,
  basic: !prices[a.id] && a.id !== 'sound.stream',
}));
export type CatalogItem = (typeof GROWTH_CATALOG)[number] & {
  status: string;
  owned: boolean;
  equipped: boolean;
};
export type GrowthLedger = {
  id: string;
  source: string;
  recordId: string | null;
  assetId: string | null;
  ruleVersion: number;
  xp: number;
  coins: number;
  reason: string;
  createdAt: string;
};
export type GrowthView = {
  xp: number;
  coins: number;
  level: number;
  floor: number;
  next: number;
  rules: RewardRules;
  catalog: CatalogItem[];
  ledger: GrowthLedger[];
  pending: number;
};
export type RewardSummary = {
  status: 'POSTED' | 'PENDING' | 'LEGACY' | 'DEMO';
  xp: number;
  coins: number;
  levelBefore: number;
  levelAfter: number;
  totalXp: number;
  newUnlocks: string[];
};
