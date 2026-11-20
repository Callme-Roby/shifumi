// Tiny 8-bit sound effects with WebAudio (square waves, no files).

let ctx = null;
let muted = false;
try {
  muted = localStorage.getItem('shifumi.muted') === '1';
} catch {
  /* storage unavailable */
}

function audio() {
  if (muted) return null;
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch {
    return null;
  }
  return ctx;
}

function tone(freq, dur, { at = 0, type = 'square', vol = 0.05, slide = 0 } = {}) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + at;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export const sfx = {
  click: () => tone(660, 0.05, { vol: 0.03 }),
  lock: () => {
    tone(523, 0.06, { vol: 0.04 });
    tone(784, 0.08, { at: 0.06, vol: 0.04 });
  },
  thump: () => tone(140, 0.09, { type: 'triangle', vol: 0.25, slide: 0.5 }),
  reveal: () => {
    tone(196, 0.12, { type: 'triangle', vol: 0.3, slide: 0.5 });
    tone(1046, 0.05, { vol: 0.03 });
  },
  win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.09, { at: 0.08 * i, vol: 0.04 })),
  lose: () => [392, 330, 262].forEach((f, i) => tone(f, 0.12, { at: 0.1 * i, vol: 0.04 })),
  tie: () => [440, 440].forEach((f, i) => tone(f, 0.07, { at: 0.11 * i, vol: 0.035 })),
  join: () => [392, 523].forEach((f, i) => tone(f, 0.08, { at: 0.08 * i, vol: 0.035 })),
  victory: () =>
    [523, 659, 784, 659, 784, 1046].forEach((f, i) => tone(f, 0.12, { at: 0.11 * i, vol: 0.045 })),
  defeat: () => [392, 370, 349, 262].forEach((f, i) => tone(f, 0.18, { at: 0.16 * i, vol: 0.04 })),
};

export function isMuted() {
  return muted;
}

export function setMuted(m) {
  muted = m;
  try {
    localStorage.setItem('shifumi.muted', m ? '1' : '0');
  } catch {
    /* ignore */
  }
}

// Browsers only allow audio after a user gesture.
export function unlockAudio() {
  audio();
}

export function buzz(ms = 12) {
  if (!muted) navigator.vibrate?.(ms);
}
