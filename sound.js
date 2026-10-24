// Tiny WebAudio sound effects – no audio files needed.
let ctx = null;
let muted = false;

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) ctx = new AC();
  }
  if (ctx && ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone(freq, dur = 0.12, type = "square", vol = 0.05, delay = 0, slideTo = null) {
  if (muted) return;
  const c = ensure();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export function setMuted(value) { muted = value; }

export const sfx = {
  unlock: ensure, // call from a user gesture so iOS/Safari allow audio
  tick: () => tone(660, 0.08),
  go: () => { tone(880, 0.12); tone(1320, 0.22, "square", 0.05, 0.12); },
  warn: () => tone(300, 0.15, "sawtooth", 0.05),
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, "triangle", 0.07, i * 0.1)),
  lose: () => tone(400, 0.6, "sawtooth", 0.06, 0, 90),
};
