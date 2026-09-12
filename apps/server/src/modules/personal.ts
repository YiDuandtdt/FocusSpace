import sharp from 'sharp';
import {
  DEFAULT_SPACE,
  readCharacter,
  readSpace,
  stableSeed,
  personalSaveSchema,
  type PersonalSpace,
} from '@focusspace/shared';
import { db } from '../db.js';
import { AppError } from '../errors.js';
import { safeEquipment, validateEquipment } from './growth.js';

export async function personalSpace(userId: string): Promise<PersonalSpace> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    include: { personalSpace: true },
  });
  return {
    ...(await safeEquipment(
      db,
      readCharacter(user.characterConfig),
      readSpace(user.personalSpace?.config),
    )),
    revision: user.personalSpace?.revision ?? 1,
    seed: stableSeed(userId),
    onboarding: user.onboarding as PersonalSpace['onboarding'],
  };
}
export async function savePersonal(userId: string, body: unknown) {
  const input = personalSaveSchema.parse(body);
  await db.$transaction(async (tx) => {
    await validateEquipment(tx, userId, input.character, input.space);
    const current = await tx.personalSpace.upsert({
      where: { userId },
      create: { userId, config: JSON.stringify(DEFAULT_SPACE) },
      update: {},
    });
    if (current.revision !== input.revision)
      throw new AppError(
        'CONFLICT',
        '另一个页面已保存新配置。当前草稿仍保留；请先载入已保存版本再修改。',
        409,
      );
    await tx.personalSpace.update({
      where: { userId },
      data: { config: JSON.stringify(input.space), revision: { increment: 1 } },
    });
    await tx.user.update({
      where: { id: userId },
      data: {
        characterConfig: JSON.stringify(input.character),
        ...(input.onboarding ? { onboarding: input.onboarding } : {}),
      },
    });
    await tx.room.updateMany({
      where: { members: { some: { userId, leftAt: null } }, session: { phase: { not: 'ENDED' } } },
      data: { revision: { increment: 1 } },
    });
  });
  return personalSpace(userId);
}
export async function decodeAvatar(bytes: Buffer, mime: string) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 2 * 1024 * 1024)
    throw new AppError('VALIDATION_ERROR', '头像大小需在 1 字节至 2 MB 之间');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime))
    throw new AppError('VALIDATION_ERROR', '请选择 PNG、JPEG 或 WebP 图片');
  try {
    const image = sharp(bytes, { limitInputPixels: 16_000_000, failOn: 'warning' });
    const meta = await image.metadata();
    if (
      !meta.format ||
      ({ png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' } as Record<string, string>)[
        meta.format
      ] !== mime ||
      (meta.pages ?? 1) > 1
    )
      throw new Error('Invalid format');
    // Decode and re-encode: never serve original bytes, metadata, SVG, URLs or animated uploads.
    return new Uint8Array(await image.rotate().resize(256, 256, { fit: 'cover' }).png().toBuffer());
  } catch {
    throw new AppError(
      'VALIDATION_ERROR',
      '无法读取图片，请选择有效的静态 PNG、JPEG 或 WebP（最多 1600 万像素）',
    );
  }
}
