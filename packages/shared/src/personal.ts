import { z } from 'zod';

// Stable asset IDs. Ownership and prices are maintained by the server.
export const ASSETS = {
  skin: {
    'skin.cream': ['奶杏', '#f1c9a5'],
    'skin.honey': ['蜜糖', '#cc9169'],
    'skin.cocoa': ['可可', '#8d5d46'],
  },
  hair: {
    'hair.crop': ['短发', '#514238'],
    'hair.bob': ['短波波', '#514238'],
    'hair.bun': ['丸子头', '#514238'],
  },
  hairColor: {
    'hair.ink': ['墨棕', '#3f3532'],
    'hair.chestnut': ['栗棕', '#80553c'],
    'hair.wheat': ['麦金', '#c39b62'],
  },
  outfit: {
    'outfit.sage': ['苔绿针织', '#7b927b'],
    'outfit.clay': ['陶红开衫', '#ba7965'],
    'outfit.blue': ['雾蓝卫衣', '#7398aa'],
    'outfit.lilac': ['丁香毛衣', '#a092b2'],
  },
  accessory: {
    'accessory.none': ['素净', '#ddd3bf'],
    'accessory.glasses': ['圆框眼镜', '#6b5845'],
    'accessory.headphones': ['安静耳机', '#4f716d'],
    'accessory.beret': ['羊毛贝雷帽', '#b98566'],
  },
  room: { 'room.atelier': ['窗边书屋', '#adc8c3'], 'room.arch': ['拱窗小筑', '#d5b99d'] },
  desk: { 'desk.oak': ['浅橡木长桌', '#d7b383'], 'desk.walnut': ['胡桃木长桌', '#987355'] },
  chair: { 'chair.sage': ['苔绿软椅', '#7d947d'], 'chair.cream': ['奶油软椅', '#d9c9a9'] },
  desktop: { 'desktop.tea': ['陶杯与手记', '#bd8568'], 'desktop.books': ['书本与笔筒', '#8398a0'] },
  wall: { 'wall.botanical': ['植物画', '#8b9b75'], 'wall.clock': ['圆木时钟', '#b49b78'] },
  window: { 'window.fern': ['窗边绿植', '#819970'], 'window.flowers': ['一束小花', '#d8ac7e'] },
  rug: { 'rug.moss': ['苔藓编织', '#94a68b'], 'rug.sand': ['麦色编织', '#c9b78d'] },
  light: { 'light.day': ['柔和天光', '#fff1d5'], 'light.warm': ['暖灯陪伴', '#ffd3a0'] },
  motion: { 'motion.calm': ['安静呼吸', '#8aab9a'], 'motion.stretch': ['休息伸展', '#b6a1c1'] },
  expression: {
    'expression.basic': ['日常鼓励', '#8aab9a'],
    'expression.sparkle': ['星光鼓励', '#e7bc68'],
  },
} as const;
export type AssetCategory = keyof typeof ASSETS;
export const assetOptions = (category: AssetCategory) =>
  Object.entries(ASSETS[category]).map(([id, [name, color]]) => ({ id, name, color }));
export function assetColor(category: AssetCategory, id: string) {
  return assetOptions(category).find((a) => a.id === id)?.color ?? '#a99a82';
}
const id = <K extends AssetCategory>(category: K) =>
  z.string().refine((value) => Object.hasOwn(ASSETS[category], value), '请选择目录内的资产');
export const characterSchema = z
  .object({
    version: z.literal(1),
    skin: id('skin'),
    hair: id('hair'),
    hairColor: id('hairColor'),
    outfit: id('outfit'),
    accessory: id('accessory'),
    motion: id('motion').default('motion.calm'),
    expression: id('expression').default('expression.basic'),
  })
  .strict();
export type CharacterConfig = z.infer<typeof characterSchema>;
export const spaceSchema = z
  .object({
    version: z.literal(1),
    room: id('room'),
    theme: z.enum(['rain', 'night', 'library']),
    desk: id('desk'),
    chair: id('chair'),
    light: id('light'),
    slots: z
      .object({ desktop: id('desktop'), wall: id('wall'), window: id('window'), rug: id('rug') })
      .strict(),
    sound: z.enum(['rain', 'fire', 'birds', 'stream']),
  })
  .strict();
export type SpaceConfig = z.infer<typeof spaceSchema>;
export const DEFAULT_CHARACTER: CharacterConfig = {
  version: 1,
  skin: 'skin.cream',
  hair: 'hair.crop',
  hairColor: 'hair.ink',
  outfit: 'outfit.sage',
  accessory: 'accessory.none',
  motion: 'motion.calm',
  expression: 'expression.basic',
};
export const DEFAULT_SPACE: SpaceConfig = {
  version: 1,
  room: 'room.atelier',
  theme: 'library',
  desk: 'desk.oak',
  chair: 'chair.sage',
  light: 'light.day',
  slots: { desktop: 'desktop.tea', wall: 'wall.botanical', window: 'window.fern', rug: 'rug.moss' },
  sound: 'birds',
};
export const personalSaveSchema = z
  .object({
    character: characterSchema,
    space: spaceSchema,
    revision: z.number().int().positive(),
    onboarding: z.enum(['DONE', 'SKIPPED']).optional(),
  })
  .strict();
export type PersonalSpace = {
  character: CharacterConfig;
  space: SpaceConfig;
  revision: number;
  seed: number;
  onboarding: 'PENDING' | 'DONE' | 'SKIPPED';
};
export type SpaceSnapshot = {
  config: SpaceConfig;
  seed: number;
  ownerId: string;
  ownerName: string;
  sourceRevision: number;
};
export function stableSeed(value: string): number {
  let h = 2166136261;
  for (const c of value) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
export function readCharacter(raw?: string | null): CharacterConfig {
  try {
    return characterSchema.parse(JSON.parse(raw ?? ''));
  } catch {
    return structuredClone(DEFAULT_CHARACTER);
  }
}
export function readSpace(raw?: string | null): SpaceConfig {
  try {
    return spaceSchema.parse(JSON.parse(raw ?? ''));
  } catch {
    return structuredClone(DEFAULT_SPACE);
  }
}
export const ASSET_CATALOG = (Object.keys(ASSETS) as AssetCategory[]).flatMap((category) =>
  assetOptions(category).map((asset) => ({
    ...asset,
    category,
    slot: ['desktop', 'wall', 'window', 'rug'].includes(category) ? category : null,
    compatibleRooms: ['room.atelier', 'room.arch'],
    preview: { kind: 'procedural', color: asset.color },
    generator: { version: 1, shape: asset.id, color: asset.color },
  })),
);
