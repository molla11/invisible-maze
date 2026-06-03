import { Howl, Howler } from "howler";

type SoundName = "move" | "wall" | "turn" | "win" | "lose" | "notify" | "emote";

type Tone = {
  frequency: number;
  duration: number;
  delay?: number;
  volume?: number;
  type?: "sine" | "square" | "triangle";
};

const SAMPLE_RATE = 22_050;
const sounds = new Map<SoundName, Howl>();

const soundTones: Record<SoundName, Tone[]> = {
  move: [{ frequency: 620, duration: 0.055, volume: 0.22, type: "triangle" }],
  wall: [
    { frequency: 140, duration: 0.09, volume: 0.34, type: "square" },
    { frequency: 78, duration: 0.09, delay: 0.035, volume: 0.2, type: "sine" }
  ],
  turn: [
    { frequency: 480, duration: 0.06, volume: 0.2, type: "triangle" },
    { frequency: 760, duration: 0.075, delay: 0.052, volume: 0.18, type: "triangle" }
  ],
  win: [
    { frequency: 520, duration: 0.08, volume: 0.2, type: "triangle" },
    { frequency: 690, duration: 0.08, delay: 0.075, volume: 0.2, type: "triangle" },
    { frequency: 930, duration: 0.12, delay: 0.15, volume: 0.2, type: "triangle" }
  ],
  lose: [
    { frequency: 260, duration: 0.12, volume: 0.22, type: "triangle" },
    { frequency: 190, duration: 0.16, delay: 0.1, volume: 0.18, type: "triangle" }
  ],
  notify: [
    { frequency: 740, duration: 0.07, volume: 0.18, type: "sine" },
    { frequency: 980, duration: 0.085, delay: 0.065, volume: 0.16, type: "sine" }
  ],
  emote: [{ frequency: 840, duration: 0.08, volume: 0.16, type: "triangle" }]
};

function oscillatorSample(tone: Tone, time: number) {
  const phase = 2 * Math.PI * tone.frequency * time;
  if (tone.type === "square") return Math.sign(Math.sin(phase));
  if (tone.type === "triangle") return 2 * Math.asin(Math.sin(phase)) / Math.PI;
  return Math.sin(phase);
}

function writeString(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function makeToneDataUri(tones: Tone[]) {
  const totalDuration = Math.max(...tones.map((tone) => (tone.delay ?? 0) + tone.duration)) + 0.03;
  const sampleCount = Math.ceil(totalDuration * SAMPLE_RATE);
  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + sampleCount * 2, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, sampleCount * 2, true);

  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / SAMPLE_RATE;
    let sample = 0;
    for (const tone of tones) {
      const localTime = time - (tone.delay ?? 0);
      if (localTime < 0 || localTime > tone.duration) continue;
      const attack = Math.min(1, localTime / 0.012);
      const release = Math.min(1, (tone.duration - localTime) / 0.03);
      sample += oscillatorSample(tone, localTime) * Math.max(0, Math.min(attack, release)) * (tone.volume ?? 0.2);
    }
    view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true);
  }

  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:audio/wav;base64,${window.btoa(binary)}`;
}

function getSound(name: SoundName) {
  const existing = sounds.get(name);
  if (existing) return existing;

  Howler.volume(0.45);
  const sound = new Howl({
    src: [makeToneDataUri(soundTones[name])],
    format: ["wav"],
    preload: true
  });
  sounds.set(name, sound);
  return sound;
}

export function playGameSound(name: SoundName) {
  if (typeof window === "undefined") return;
  try {
    getSound(name).play();
  } catch {
    // Browsers may ignore audio before the first user gesture.
  }
}
