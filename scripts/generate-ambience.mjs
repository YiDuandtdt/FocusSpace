// Original procedural audio for FocusSpace. No recordings, samples or external assets.
// This generator and its generated window-rain.wav are released under CC0-1.0.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rate = 24000;
const seconds = 25;
const count = rate * seconds;
const overlap = rate;
const length = count - overlap;
let seed = 20260907;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
}
const channels = [0, 1].map(() => {
  const samples = new Float64Array(count);
  let low = 0,
    mid = 0;
  for (let i = 0; i < count; i++) {
    const noise = random() * 2 - 1;
    low = low * 0.985 + noise * 0.015;
    mid = mid * 0.72 + noise * 0.28;
    const swell = 0.85 + Math.sin(((i / rate) * Math.PI) / 6) * 0.1;
    samples[i] = (low * 2.4 + mid * 0.65 + noise * 0.1) * swell;
  }
  // Quiet, scattered droplets on a window ledge.
  for (let drop = 0; drop < 190; drop++) {
    const start = Math.floor(random() * (count - 2400));
    const frequency = 1000 + random() * 2200;
    const strength = 0.02 + random() * 0.035;
    for (let i = 0; i < 1800; i++)
      samples[start + i] +=
        Math.sin((2 * Math.PI * frequency * i) / rate) *
        Math.exp(-i / 200) *
        Math.min(i / 15, 1) *
        strength;
  }
  // Equal-power crossfade joins two continuous sections without a silent boundary.
  const result = samples.slice(overlap);
  for (let i = 0; i < overlap; i++) {
    const weight = ((i / (overlap - 1)) * Math.PI) / 2;
    result[length - overlap + i] =
      samples[count - overlap + i] * Math.cos(weight) + samples[i] * Math.sin(weight);
  }
  return result;
});
let energy = 0,
  peak = 0;
for (const channel of channels)
  for (const sample of channel) {
    energy += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
const gain = Math.min(0.13 / Math.sqrt(energy / (length * 2)), 0.78 / peak);
const wav = Buffer.alloc(44 + length * 4);
wav.write('RIFF', 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(rate, 24);
wav.writeUInt32LE(rate * 4, 28);
wav.writeUInt16LE(4, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(length * 4, 40);
for (let i = 0; i < length; i++)
  for (let channel = 0; channel < 2; channel++)
    wav.writeInt16LE(Math.round(channels[channel][i] * gain * 32767), 44 + i * 4 + channel * 2);
const folder = new URL('../apps/web/public/audio/', import.meta.url);
mkdirSync(folder, { recursive: true });
writeFileSync(new URL('window-rain.wav', folder), wav);
console.log(
  `Generated ${fileURLToPath(folder)}window-rain.wav: 24 s stereo PCM, ${wav.length} bytes, RMS ${(Math.sqrt(energy / (length * 2)) * gain).toFixed(3)}, peak ${(peak * gain).toFixed(3)}`,
);
