// Reproducible, local two-note confirmation; no downloaded audio or dependencies.
import { mkdir, writeFile } from 'node:fs/promises';
const sampleRate = 44100;
const samples = Math.round(sampleRate * 0.32);
const wave = Buffer.alloc(44 + samples * 2);
wave.write('RIFF', 0); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8);
wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
wave.writeUInt32LE(sampleRate, 24); wave.writeUInt32LE(sampleRate * 2, 28);
wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34);
wave.write('data', 36); wave.writeUInt32LE(samples * 2, 40);
const directory = new URL('../extension/sounds/', import.meta.url);
await mkdir(directory, { recursive: true });
for (const kind of ['save', 'undo']) {
for (let i = 0; i < samples; i++) {
  const time = i / sampleRate;
  let signal = 0;
  const notes = kind === 'undo' ? [[0, 880], [0.075, 659.25]] : [[0, 659.25], [0.075, 880]];
  for (const [start, frequency] of notes) {
    const t = time - start;
    if (t < 0) continue;
    const envelope = Math.min(1, t / 0.008) * Math.exp(-t * 22) * Math.min(1, (0.32 - time) / 0.02);
    signal += 0.22 * envelope * (Math.sin(t * frequency * Math.PI * 2) + 0.12 * Math.sin(t * frequency * Math.PI * 4));
  }
  wave.writeInt16LE(Math.round(signal * 32767), 44 + i * 2);
}
await writeFile(new URL(`${kind}.wav`, directory), wave);
}
