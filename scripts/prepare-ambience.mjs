// Reproducible processing of the recordings listed in public/audio/SOURCES.md.
// Download pinned Blanket OGGs to .tmp/ambience, then set FFMPEG to a local binary.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const manifest = [];
for (const [id, source] of [
  ['rain', 'rain'],
  ['fire', 'fireplace'],
  ['birds', 'birds'],
  ['stream', 'stream'],
]) {
  const input = `.tmp/ambience/${source}.ogg`;
  const output = `apps/web/public/audio/${id}.mp3`;
  const run = (args) => {
    const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      windowsHide: true,
      encoding: 'utf8',
    });
    if (result.status !== 0)
      throw Error(result.error?.message || `FFmpeg exit ${result.status}: ${result.stderr}`);
  };
  const raw = `.tmp/ambience/${id}.f32`;
  run([
    '-i',
    input,
    '-t',
    '24',
    '-af',
    'loudnorm=I=-25:TP=-3:LRA=7',
    '-ar',
    '44100',
    '-ac',
    '2',
    '-f',
    'f32le',
    raw,
  ]);
  const pcm = readFileSync(raw);
  const rate = 44100,
    channels = 2,
    fade = 2 * rate,
    frames = 24 * rate;
  if (pcm.length < frames * channels * 4) throw Error('Recording too short: ' + input);
  const loop = Buffer.alloc((frames - fade) * channels * 4);
  pcm.copy(loop, 0, fade * channels * 4, (frames - fade) * channels * 4);
  for (let frame = 0; frame < fade; frame++) {
    const blend = frame / (fade - 1);
    for (let channel = 0; channel < channels; channel++) {
      const tail = pcm.readFloatLE(((frames - fade + frame) * channels + channel) * 4);
      const head = pcm.readFloatLE((frame * channels + channel) * 4);
      loop.writeFloatLE(
        tail * (1 - blend) + head * blend,
        ((frames - 2 * fade + frame) * channels + channel) * 4,
      );
    }
  }
  writeFileSync(raw, loop);
  run([
    '-f',
    'f32le',
    '-ar',
    '44100',
    '-ac',
    '2',
    '-i',
    raw,
    '-c:a',
    'libmp3lame',
    '-b:a',
    '96k',
    '-map_metadata',
    '-1',
    output,
  ]);
  const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
  manifest.push({
    id,
    source: `${source}.ogg`,
    inputSha256: hash(input),
    file: `${id}.mp3`,
    sha256: hash(output),
    bytes: statSync(output).size,
    durationSeconds: 22,
  });
}
writeFileSync(
  'apps/web/public/audio/manifest.json',
  JSON.stringify(
    {
      upstream: 'rafaelmardojai/blanket',
      commit: '9d229d2be7cb6619135d55ff9e49926e40298686',
      processing:
        'First 24 seconds, -25 LUFS / -3 dBTP normalization, 2-second tail/head crossfade, 22-second stereo MP3 at 44.1 kHz / 96 kbps',
      tracks: manifest,
    },
    null,
    2,
  ) + '\n',
);
console.log(manifest);
