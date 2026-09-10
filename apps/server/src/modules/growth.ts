import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  GROWTH_CATALOG,
  INITIAL_RULES,
  rewardRulesSchema,
  levelFor,
  levelFloor,
  DEFAULT_CHARACTER,
  DEFAULT_SPACE,
  readCharacter,
  readSpace,
  type CharacterConfig,
  type SpaceConfig,
  type RewardSummary,
  type GrowthView,
} from '@focusspace/shared';
import { db } from '../db.js';
import { AppError } from '../errors.js';
import { receipt } from './room.js';

type Tx = Prisma.TransactionClient;
const catalog = new Map(GROWTH_CATALOG.map((i) => [i.id, i]));
export function equippedIds(character: CharacterConfig, space: SpaceConfig): string[] {
  return [
    ...Object.values(character).filter((s): s is string => typeof s === 'string'),
    space.room,
    space.desk,
    space.chair,
    space.light,
    ...Object.values(space.slots),
    `sound.${space.sound}`,
  ];
}
export async function ensureBasics(tx: Tx, userId: string) {
  await tx.growthAccount.upsert({ where: { userId }, create: { userId }, update: {} });
  for (const item of GROWTH_CATALOG.filter((i) => i.basic))
    await tx.ownedAsset.upsert({
      where: { userId_assetId: { userId, assetId: item.id } },
      create: { userId, assetId: item.id, source: 'BASIC' },
      update: {},
    });
}
export async function initGrowth() {
  await db.$transaction(async (tx) => {
    await tx.growthSettings.upsert({
      where: { id: 'rules' },
      create: { id: 'rules', rules: JSON.stringify(INITIAL_RULES) },
      update: {},
    });
    for (const item of GROWTH_CATALOG)
      await tx.growthItem.upsert({
        where: { id: item.id },
        create: { id: item.id, price: item.price, minLevel: item.minLevel },
        update: {},
      });
  });
  // Lazy initialization also covers imported and newly registered users; no historical rewards.
  for (const user of await db.user.findMany({ select: { id: true } }))
    await db.$transaction((tx) => ensureBasics(tx, user.id));
  await compensateRewards();
}
export async function currentRules(tx: Tx = db) {
  const value = await tx.growthSettings.findUnique({ where: { id: 'rules' } });
  return rewardRulesSchema.parse(value ? JSON.parse(value.rules) : INITIAL_RULES);
}
export type RewardFacts = { goal: boolean; togetherSeconds: number };
export async function awardRecord(tx: Tx, recordId: string) {
  const record = await tx.studyRecord.findUniqueOrThrow({
    where: { id: recordId },
    include: { session: true },
  });
  if (record.rewardState !== 'PENDING' || !record.session.rewardRules || !record.settledAt) return;
  if (record.session.focusSeconds === 45 && record.session.breakSeconds === 15) {
    await tx.studyRecord.update({ where: { id: record.id }, data: { rewardState: 'DEMO' } });
    return;
  }
  const old = await tx.growthLedger.findUnique({ where: { recordId } });
  if (old) {
    await tx.studyRecord.update({ where: { id: recordId }, data: { rewardState: 'POSTED' } });
    return;
  }
  await ensureBasics(tx, record.userId);
  const account = await tx.growthAccount.findUniqueOrThrow({ where: { userId: record.userId } });
  const rules = rewardRulesSchema.parse(JSON.parse(record.session.rewardRules));
  const facts: RewardFacts = JSON.parse(record.rewardFacts ?? '{"goal":false,"togetherSeconds":0}');
  const day = new Date(record.settledAt.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  const bonuses = await tx.growthLedger.findMany({
    where: { userId: record.userId, rewardDay: day },
    select: { goalBonus: true, togetherBonus: true },
  });
  const goal = record.focusSeconds >= 300 && facts.goal && !bonuses.some((l) => l.goalBonus);
  const together = facts.togetherSeconds >= 300 && !bonuses.some((l) => l.togetherBonus);
  const minutes = Math.floor(record.focusSeconds / 60);
  // Short configured rounds cannot multiply the complete-round bonus.
  const rounds = Math.min(record.roundsCompleted, Math.floor(record.focusSeconds / 1500));
  const xp =
    minutes * rules.xpPerMinute +
    rounds * rules.roundXp +
    (goal ? rules.goalXp : 0) +
    (together ? rules.togetherXp : 0);
  const coins =
    minutes * rules.coinsPerMinute +
    rounds * rules.roundCoins +
    (goal ? rules.goalCoins : 0) +
    (together ? rules.togetherCoins : 0);
  await tx.growthLedger.create({
    data: {
      key: `record:${recordId}`,
      userId: record.userId,
      source: 'STUDY',
      recordId,
      ruleVersion: rules.version,
      xp,
      coins,
      xpAfter: account.xp + xp,
      coinsAfter: account.coins + coins,
      rewardDay: day,
      goalBonus: goal,
      togetherBonus: together,
      reason: `有效专注 ${minutes} 分钟；完整轮次奖励 ${rounds} 次；目标 ${goal ? 1 : 0}；共学 ${together ? 1 : 0}`,
      createdAt: record.settledAt,
    },
  });
  await tx.growthAccount.update({
    where: { userId: record.userId },
    data: { xp: { increment: xp }, coins: { increment: coins }, level: levelFor(account.xp + xp) },
  });
  await tx.studyRecord.update({ where: { id: recordId }, data: { rewardState: 'POSTED' } });
}
export async function compensateRewards(userId?: string) {
  const pending = await db.studyRecord.findMany({
    where: {
      rewardState: 'PENDING',
      ...(userId ? { userId } : {}),
      session: { phase: 'ENDED', rewardRules: { not: null } },
    },
    orderBy: [{ settledAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  for (const record of pending) await db.$transaction((tx) => awardRecord(tx, record.id));
}
export async function rewardSummary(recordId: string): Promise<RewardSummary> {
  const record = await db.studyRecord.findUniqueOrThrow({ where: { id: recordId } });
  const ledger = await db.growthLedger.findUnique({ where: { recordId } });
  const before = ledger ? levelFor(ledger.xpAfter - ledger.xp) : 1;
  const after = ledger ? levelFor(ledger.xpAfter) : 1;
  const items = await db.growthItem.findMany({
    where: { minLevel: { gt: before, lte: after }, status: 'ACTIVE' },
  });
  return {
    status: record.rewardState as RewardSummary['status'],
    xp: ledger?.xp ?? 0,
    coins: ledger?.coins ?? 0,
    levelBefore: before,
    levelAfter: after,
    totalXp: ledger?.xpAfter ?? 0,
    newUnlocks: items.map(
      (i) => `${catalog.get(i.id)?.name ?? i.id}${i.price ? '（可兑换）' : '（可领取）'}`,
    ),
  };
}
export async function growthView(userId: string): Promise<GrowthView> {
  try {
    await compensateRewards(userId);
  } catch {
    console.warn('Reward compensation deferred; pending records retained');
  }
  await db.$transaction((tx) => ensureBasics(tx, userId));
  const [account, items, owned, user, ledger, rules, pending] = await Promise.all([
    db.growthAccount.findUniqueOrThrow({ where: { userId } }),
    db.growthItem.findMany(),
    db.ownedAsset.findMany({ where: { userId } }),
    db.user.findUniqueOrThrow({ where: { id: userId }, include: { personalSpace: true } }),
    db.growthLedger.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 20,
    }),
    currentRules(),
    db.studyRecord.count({ where: { userId, rewardState: 'PENDING' } }),
  ]);
  const equipped = equippedIds(
    readCharacter(user.characterConfig),
    readSpace(user.personalSpace?.config),
  );
  return {
    ...account,
    floor: levelFloor(account.level),
    next: levelFloor(account.level + 1),
    rules,
    pending,
    ledger: ledger.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })),
    catalog: GROWTH_CATALOG.map((item) => ({
      ...item,
      ...items.find((i) => i.id === item.id),
      status: items.find((i) => i.id === item.id)?.status ?? 'DELISTED',
      owned: owned.some((o) => o.assetId === item.id),
      equipped: equipped.includes(item.id),
    })),
  };
}
export async function validateEquipment(
  tx: Tx,
  userId: string,
  character: CharacterConfig,
  space: SpaceConfig,
) {
  await ensureBasics(tx, userId);
  const ids = equippedIds(character, space);
  const owned = await tx.ownedAsset.findMany({ where: { userId, assetId: { in: ids } } });
  const disabled = await tx.growthItem.findMany({ where: { id: { in: ids }, status: 'DISABLED' } });
  const invalid = ids.find(
    (id) => !owned.some((o) => o.assetId === id) || disabled.some((i) => i.id === id),
  );
  if (invalid)
    throw new AppError(
      'ASSET_LOCKED',
      `请先在成长与装扮中获取「${catalog.get(invalid)?.name ?? invalid}」，或改用基础搭配`,
      409,
    );
}
export function applyAsset(character: CharacterConfig, space: SpaceConfig, id: string) {
  const item = catalog.get(id);
  if (!item) throw new AppError('NOT_FOUND', '物品不存在', 404);
  if (item.slot === 'sound') space.sound = id.slice(6) as SpaceConfig['sound'];
  else if (item.slot in character) (character as unknown as Record<string, string>)[item.slot] = id;
  else if (item.slot in space.slots) (space.slots as Record<string, string>)[item.slot] = id;
  else (space as unknown as Record<string, string>)[item.slot] = id;
}
export async function safeEquipment(tx: Tx, character: CharacterConfig, space: SpaceConfig) {
  const disabled = await tx.growthItem.findMany({ where: { status: 'DISABLED' } });
  const defaults = equippedIds(DEFAULT_CHARACTER, DEFAULT_SPACE);
  for (const id of equippedIds(character, space))
    if (disabled.some((i) => i.id === id)) {
      const slot = catalog.get(id)?.slot;
      const replacement = defaults.find((d) => catalog.get(d)?.slot === slot);
      if (replacement) applyAsset(character, space, replacement);
    }
  return { character, space };
}
const acquireSchema = z
  .object({ assetId: z.string().max(80), requestId: z.string().uuid() })
  .strict();
export async function acquire(userId: string, body: unknown) {
  const input = acquireSchema.parse(body);
  return db.$transaction((tx) =>
    receipt(tx, userId, input.requestId, 'growth:acquire', input, async () => {
      await ensureBasics(tx, userId);
      const spec = catalog.get(input.assetId),
        item = await tx.growthItem.findUnique({ where: { id: input.assetId } });
      if (!spec || !item) throw new AppError('NOT_FOUND', '物品不存在', 404);
      const owned = await tx.ownedAsset.findUnique({
        where: { userId_assetId: { userId, assetId: item.id } },
      });
      if (owned) return { owned: true };
      if (item.status !== 'ACTIVE') throw new AppError('UNAVAILABLE', '物品已下架或停用', 409);
      const account = await tx.growthAccount.findUniqueOrThrow({ where: { userId } });
      if (account.level < item.minLevel)
        throw new AppError('LEVEL_REQUIRED', `达到 Lv.${item.minLevel} 后可获取`, 409);
      const debit = await tx.growthAccount.updateMany({
        where: { userId, coins: { gte: item.price } },
        data: { coins: { decrement: item.price } },
      });
      if (!debit.count) throw new AppError('INSUFFICIENT_COINS', '学习币不足，继续一次专注吧', 409);
      await tx.ownedAsset.create({ data: { userId, assetId: item.id, source: 'REDEEM' } });
      await tx.growthLedger.create({
        data: {
          key: `purchase:${userId}:${item.id}`,
          userId,
          source: 'REDEEM',
          assetId: item.id,
          ruleVersion: 0,
          xp: 0,
          coins: -item.price,
          xpAfter: account.xp,
          coinsAfter: account.coins - item.price,
          reason: `兑换 ${spec.name}`,
        },
      });
      return { owned: true };
    }),
  );
}
export async function equip(userId: string, body: unknown) {
  const input = acquireSchema.extend({ remove: z.boolean().optional() }).parse(body);
  return db.$transaction((tx) =>
    receipt(tx, userId, input.requestId, 'growth:equip', input, async () => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        include: { personalSpace: true },
      });
      const { character, space } = await safeEquipment(
        tx,
        readCharacter(user.characterConfig),
        readSpace(user.personalSpace?.config),
      );
      const item = catalog.get(input.assetId);
      if (!item) throw new AppError('NOT_FOUND', '物品不存在', 404);
      const id = input.remove
        ? equippedIds(DEFAULT_CHARACTER, DEFAULT_SPACE).find(
            (i) => catalog.get(i)?.slot === item.slot,
          )!
        : item.id;
      applyAsset(character, space, id);
      await validateEquipment(tx, userId, character, space);
      await tx.user.update({
        where: { id: userId },
        data: { characterConfig: JSON.stringify(character) },
      });
      await tx.personalSpace.upsert({
        where: { userId },
        create: { userId, config: JSON.stringify(space) },
        update: { config: JSON.stringify(space), revision: { increment: 1 } },
      });
      await tx.room.updateMany({
        where: {
          members: { some: { userId, leftAt: null } },
          session: { phase: { not: 'ENDED' } },
        },
        data: { revision: { increment: 1 } },
      });
      return { equipped: id };
    }),
  );
}

const adminSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('item'),
    assetId: z.string(),
    price: z.number().int().min(0).max(10000),
    minLevel: z.number().int().min(1).max(30),
    status: z.enum(['ACTIVE', 'DELISTED', 'DISABLED']),
  }),
  z.object({
    action: z.literal('compensate'),
    userId: z.string(),
    xp: z.number().int().min(0).max(10000),
    coins: z.number().int().min(-10000).max(10000),
    assetId: z.string().optional(),
  }),
  z.object({ action: z.literal('rules'), rules: rewardRulesSchema }),
]);
export async function growthAdmin(actorId: string, body: unknown) {
  const meta = z
    .object({ requestId: z.string().uuid(), reason: z.string().trim().min(3).max(300) })
    .parse(body);
  const input = adminSchema.parse(body);
  return db.$transaction((tx) =>
    receipt(tx, actorId, meta.requestId, 'growth:admin', { ...input, ...meta }, async () => {
      const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
      if (actor.role !== 'ADMIN' || actor.bannedAt)
        throw new AppError('FORBIDDEN', '仅管理员可操作', 403);
      let before: unknown;
      let targetId = 'rules';
      if (input.action === 'item') {
        const spec = catalog.get(input.assetId);
        if (!spec) throw new AppError('NOT_FOUND', '只能选择已实现的资源', 404);
        if (spec.basic && (input.price !== 0 || input.minLevel !== 1 || input.status !== 'ACTIVE'))
          throw new AppError('BASIC_PROTECTED', '基础内容必须始终免费可用', 409);
        targetId = input.assetId;
        before = await tx.growthItem.findUniqueOrThrow({ where: { id: targetId } });
        await tx.growthItem.update({
          where: { id: targetId },
          data: { price: input.price, minLevel: input.minLevel, status: input.status },
        });
      } else if (input.action === 'rules') {
        before = await currentRules(tx);
        const version = (before as typeof INITIAL_RULES).version + 1;
        await tx.growthSettings.upsert({
          where: { id: 'rules' },
          create: { id: 'rules', rules: JSON.stringify({ ...input.rules, version }) },
          update: { rules: JSON.stringify({ ...input.rules, version }) },
        });
      } else {
        targetId = input.userId;
        await tx.user.findUniqueOrThrow({ where: { id: targetId } });
        await ensureBasics(tx, targetId);
        const account = await tx.growthAccount.findUniqueOrThrow({ where: { userId: targetId } });
        before = account;
        if (account.coins + input.coins < 0)
          throw new AppError('INSUFFICIENT_COINS', '纠错不能造成负余额', 409);
        if (input.assetId) {
          const item = await tx.growthItem.findUnique({ where: { id: input.assetId } });
          if (!catalog.has(input.assetId) || !item || item.status === 'DISABLED')
            throw new AppError('UNAVAILABLE', '请选择未停用的已实现资产', 409);
          await tx.ownedAsset.upsert({
            where: { userId_assetId: { userId: targetId, assetId: input.assetId } },
            create: { userId: targetId, assetId: input.assetId, source: 'ADMIN' },
            update: {},
          });
        }
        await tx.growthAccount.update({
          where: { userId: targetId },
          data: {
            xp: { increment: input.xp },
            coins: { increment: input.coins },
            level: levelFor(account.xp + input.xp),
          },
        });
        await tx.growthLedger.create({
          data: {
            key: `admin:${actorId}:${meta.requestId}`,
            userId: targetId,
            source: 'COMPENSATION',
            assetId: input.assetId,
            ruleVersion: 0,
            xp: input.xp,
            coins: input.coins,
            xpAfter: account.xp + input.xp,
            coinsAfter: account.coins + input.coins,
            reason: meta.reason,
          },
        });
      }
      const audit = await tx.adminAudit.create({
        data: {
          actorId,
          action: `growth:${input.action}`,
          targetId,
          reason: meta.reason,
          result: 'SUCCESS',
          summary: JSON.stringify({ before, after: input }),
          requestId: meta.requestId,
        },
      });
      return { auditId: audit.id };
    }),
  );
}
