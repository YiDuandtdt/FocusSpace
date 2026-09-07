import type { Member } from '@focusspace/shared';

export const memberLabels: Record<Member['status'], string> = {
  JOINED: '已入座',
  READY: '已准备',
  FOCUSING: '正在专注',
  BREAKING: '正在休息',
  AFK: '暂时离开',
  DISCONNECTED: '等待重连',
  ENDED: '已结束',
};

export const memberSymbols: Record<Member['status'], string> = {
  JOINED: '○',
  READY: '✓',
  FOCUSING: '✎',
  BREAKING: '☕',
  AFK: '↗',
  DISCONNECTED: '⋯',
  ENDED: '✓',
};

// These are fixed physical seats, never sorted or allocated on the client.
export const SEATS = Array.from({ length: 8 }, (_, index) => ({
  index,
  x: ((index % 4) - 1.5) * 1.65,
  z: index < 4 ? -1.35 : 1.35,
  rotation: index < 4 ? 0 : Math.PI,
}));
