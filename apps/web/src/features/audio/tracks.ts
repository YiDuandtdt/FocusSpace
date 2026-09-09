export const tracks = [
  { id: 'rain', name: '窗边雨声', src: '/audio/rain.mp3' },
  { id: 'fire', name: '炉火轻响', src: '/audio/fire.mp3' },
  { id: 'birds', name: '林间鸟鸣', src: '/audio/birds.mp3' },
  { id: 'stream', name: '溪水潺潺', src: '/audio/stream.mp3' },
] as const;
export type TrackId = (typeof tracks)[number]['id'];
export function isTrackId(value: unknown): value is TrackId {
  return tracks.some((track) => track.id === value);
}
