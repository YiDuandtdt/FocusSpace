import { useState } from 'react';
import { rhythmSchema } from '@focusspace/shared';
import { isTrackId, type TrackId } from './features/audio/tracks';
export type Preferences = {
  focusSeconds: number;
  breakSeconds: number;
  targetRounds: number | null;
  volume: number;
  cards: boolean;
  sound: TrackId;
  focusView: boolean;
  reducedMotion: boolean;
};
const defaults: Preferences = {
  focusSeconds: 1500,
  breakSeconds: 300,
  targetRounds: 4,
  volume: 35,
  cards: false,
  sound: 'rain',
  focusView: false,
  reducedMotion: false,
};
export function readPreferences(userId: string): Preferences {
  try {
    const p = JSON.parse(localStorage.getItem('focusspace:preferences:v1:' + userId) ?? '{}');
    const rhythm = rhythmSchema.safeParse(p);
    return {
      ...defaults,
      ...(rhythm.success ? rhythm.data : {}),
      volume: Number.isInteger(p.volume) && p.volume >= 0 && p.volume <= 100 ? p.volume : 35,
      cards: p.cards === true,
      sound: isTrackId(p.sound) ? p.sound : 'rain',
      focusView: p.focusView === true,
      reducedMotion: p.reducedMotion === true,
    };
  } catch {
    return { ...defaults };
  }
}
export function savePreferences(userId: string, patch: Partial<Preferences>) {
  try {
    localStorage.setItem(
      'focusspace:preferences:v1:' + userId,
      JSON.stringify({ ...readPreferences(userId), ...patch }),
    );
    return true;
  } catch {
    return false;
  }
}
const prefix = 'focusspace:draft:v1:';
let draftEpoch = 0;
export const getDraftEpoch = () => draftEpoch;
export function clearDrafts() {
  draftEpoch++;
  try {
    for (const key of Object.keys(sessionStorage))
      if (key.startsWith(prefix)) sessionStorage.removeItem(key);
  } catch {
    /* Storage may be unavailable. */
  }
}
export function readDraft<T>(key: string, fallback: T): T {
  try {
    const entry = JSON.parse(sessionStorage.getItem(prefix + key) ?? 'null');
    if (entry && Date.now() - entry.at < 86400000) return entry.value;
    sessionStorage.removeItem(prefix + key);
    return fallback;
  } catch {
    return fallback;
  }
}
export function writeDraft(key: string, value: unknown, epoch = draftEpoch) {
  if (epoch !== draftEpoch) return;
  try {
    sessionStorage.setItem(prefix + key, JSON.stringify({ at: Date.now(), value }));
  } catch {
    /* Keep current-page state when storage is unavailable. */
  }
}
export function useDraft<T>(key: string, initial: T) {
  const epoch = getDraftEpoch();
  const [value, setValue] = useState<T>(() => readDraft(key, initial));
  const update = (next: T) => {
    setValue(next);
    writeDraft(key, next, epoch);
  };
  return [value, update] as const;
}
