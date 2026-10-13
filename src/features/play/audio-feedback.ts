export type SoundLevel = "off" | "medium" | "high";
const KEY = "alkane-puzzle-competition:sound-level";
let context: AudioContext | null = null;

export function savedSoundLevel(): SoundLevel {
  try { const value = localStorage.getItem(KEY); return value === "off" || value === "high" ? value : "medium"; }
  catch { return "medium"; }
}

export function saveSoundLevel(value: SoundLevel): void {
  try { localStorage.setItem(KEY, value); } catch { /* sound preference is optional */ }
}

// Every effect uses this context so one user gesture unlocks all game audio.
export function primeAudio(level: SoundLevel): AudioContext | null {
  if (level === "off" || typeof window === "undefined") return null;
  try {
    if (!context || context.state === "closed") {
      const AC = window.AudioContext ?? (window as typeof window & {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
      if (!AC) return null;
      context = new AC({latencyHint: "interactive"});
    }
    if (context.state !== "running") void context.resume().catch(() => {});
    return context;
  } catch { /* audio is optional */ return null; }
}

function note(audio: AudioContext, frequency: number, at: number, duration: number, volume: number, waveform: OscillatorType = "sine") {
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = waveform;
  oscillator.frequency.setValueAtTime(frequency, at);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  oscillator.connect(gain); gain.connect(audio.destination);
  oscillator.start(at); oscillator.stop(at + duration + 0.01);
}

export function playCountdownTick(level: SoundLevel): void {
  if (level === "off") return;
  try {
    const audio = context;
    if (!audio || audio.state !== "running") return;
    note(audio, 880, audio.currentTime + 0.003, 0.11, level === "high" ? 0.07 : 0.038);
  } catch { /* countdown continues if sound is unavailable */ }
}

export function playAnswerSound(kind: "correct" | "incorrect", level: SoundLevel): void {
  if (level === "off") return;
  try {
    primeAudio(level);
    const audio = context;
    if (!audio || audio.state !== "running") return;
    // Original AlkanePuzzle correct/incorrect motifs (index.html 4023-4037).
    const scale = level === "high" ? 0.88 : 0.44;
    const start = audio.currentTime + 0.003;
    if (kind === "correct") {
      note(audio,523.25,start,0.08,0.15*scale);
      note(audio,659.25,start+0.06,0.08,0.16*scale);
      note(audio,783.99,start+0.12,0.1,0.17*scale);
      note(audio,1046.5,start+0.19,0.22,0.16*scale,"triangle");
    } else {
      note(audio,493.88,start,0.13,0.12*scale);
      note(audio,392,start+0.11,0.22,0.13*scale);
    }
  } catch { /* audio must never interrupt grading */ }
}
export function playHostBoundary(level: SoundLevel): void {
  if (level === "off" || !context || context.state !== "running") return;
  try { note(context, 1100, context.currentTime + 0.003, 0.38, level === "high" ? 0.07 : 0.038); } catch { /* audio never blocks the game */ }
}
