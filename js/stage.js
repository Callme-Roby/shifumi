// The arena: a 160x90 pixel canvas, scaled up by whole numbers so pixels
// stay crisp. Draws both arms, the "chi-fou-mi" shake and the reveal.

import { hand, drawText, PALETTE, SHAPES } from './sprites.js';
import { sfx, buzz } from './sound.js';

export const W = 128;
export const H = 80;
const ARM_Y = 39; // top row of the sleeves
const ANCHOR = 13; // distance from the screen edge to the cuff
const GROUND = 64;
const BEAT = 440; // ms per shake
const LIFT = 10; // px

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeInQuad = (t) => t * t;
const easeOutBack = (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;
const clamp01 = (t) => Math.max(0, Math.min(1, t));

class Aborted extends Error {}

function makeHand(side, sleeve, phase) {
  return { side, sleeve, phase, shape: 'rock', present: true, ready: false, mood: null, moodT0: 0, slide: { from: 0, to: 0, t0: 0 } };
}

export class Stage {
  constructor(canvas, container) {
    this.canvas = canvas;
    this.container = container;
    this.ctx = canvas.getContext('2d');
    this.buf = document.createElement('canvas');
    this.buf.width = W;
    this.buf.height = H;
    this.g = this.buf.getContext('2d');
    this.left = makeHand('left', 'solid', 0);
    this.right = makeHand('right', 'stripes', 2.1);
    this.word = null;
    this.beat = null;
    this.flash = 0;
    this.particles = [];
    this.epoch = 0;
    this.quiet = false;
    this.attractOn = false;
    this.attractEpoch = 0;
    this.k = 0;
    new ResizeObserver(() => this.resize()).observe(container);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    const loop = (t) => {
      this.draw(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const maxW = this.container.clientWidth;
    const maxH = Math.max(150, window.innerHeight * 0.46);
    const k = Math.max(1, Math.floor(Math.min(maxW / W, maxH / H) * dpr));
    if (k !== this.k) {
      this.k = k;
      this.canvas.width = W * k;
      this.canvas.height = H * k;
    }
    this.canvas.style.width = `${(W * k) / dpr}px`;
    this.canvas.style.height = `${(H * k) / dpr}px`;
  }

  // ---- public API --------------------------------------------------------

  setPresent(side, present, animate = true) {
    const h = this[side];
    const now = performance.now();
    const cur = this.slideAt(h, now);
    h.present = present;
    h.slide = { from: animate ? cur : present ? 0 : 90, to: present ? 0 : 90, t0: now };
    if (!present) h.ready = false;
  }

  setReady(side, ready) {
    this[side].ready = ready;
  }

  reset() {
    for (const h of [this.left, this.right]) {
      h.shape = 'rock';
      h.mood = null;
      h.ready = false;
    }
    this.word = null;
  }

  cancel() {
    this.epoch++;
    if (this.beat) {
      const b = this.beat;
      this.beat = null;
      b.done();
    }
    this.reset();
  }

  say(str, ms = 0) {
    this.word = { str, t0: performance.now(), until: ms ? performance.now() + ms : 0 };
  }

  // Shake both fists three times ("CHI", "FOU", "MI !") and open them on the
  // last beat. `result` resolves to { mine, theirs }; if it is late we keep
  // shaking until it arrives.
  async playRound(result) {
    const my = ++this.epoch;
    let res = null;
    let failed = null;
    result.then(
      (r) => (res = r),
      (e) => (failed = e),
    );
    this.reset();
    const check = () => {
      if (my !== this.epoch) throw new Aborted();
      if (failed) throw failed;
    };
    await this.shake('CHI');
    check();
    await this.shake('FOU');
    check();
    const t0 = performance.now();
    while (!res) {
      check();
      if (performance.now() - t0 > 15000) throw new Error('timeout');
      await this.shake('...');
    }
    await this.shake('MI !', () => {
      this.left.shape = res.mine;
      this.right.shape = res.theirs;
      this.flash = performance.now();
      if (!this.quiet) {
        sfx.reveal();
        buzz(25);
      }
    });
    check();
    return res;
  }

  // outcome from the left player's point of view: 1 win, 0 tie, -1 loss
  showOutcome(outcome) {
    const now = performance.now();
    const [l, r] = outcome > 0 ? ['win', 'lose'] : outcome < 0 ? ['lose', 'win'] : ['tie', 'tie'];
    this.left.mood = l;
    this.right.mood = r;
    this.left.moodT0 = this.right.moodT0 = now;
    this.say(outcome > 0 ? 'GAGNÉ !' : outcome < 0 ? 'PERDU' : 'ÉGALITÉ');
  }

  showMatchEnd(won) {
    const now = performance.now();
    this.left.mood = won ? 'champion' : 'defeat';
    this.right.mood = won ? 'defeat' : 'champion';
    this.left.moodT0 = this.right.moodT0 = now;
    this.say(won ? 'VICTOIRE !' : 'DÉFAITE');
    if (won) this.confetti();
  }

  // Demo loop shown on the home screen. Calling attract(true) again restarts it.
  attract(on) {
    if (!on && !this.attractOn) return;
    this.attractOn = on;
    this.quiet = on;
    this.attractEpoch++;
    if (on) this.attractLoop(this.attractEpoch);
    else this.cancel();
  }

  async attractLoop(my) {
    const alive = () => this.attractOn && my === this.attractEpoch;
    const pick = () => SHAPES[Math.floor(Math.random() * 3)];
    while (alive()) {
      await sleep(1800);
      if (!alive()) return;
      try {
        await this.playRound(Promise.resolve({ mine: pick(), theirs: pick() }));
      } catch {
        return;
      }
      await sleep(1600);
      if (!alive()) return;
      this.reset();
    }
  }

  // ---- animation internals ----------------------------------------------

  shake(str, onSlam) {
    return new Promise((done) => {
      this.say(str);
      this.beat = { t0: performance.now(), onSlam, done };
    });
  }

  liftAt(now) {
    if (!this.beat) return 0;
    const p = (now - this.beat.t0) / BEAT;
    if (p < 0.45) return LIFT * easeOutCubic(p / 0.45);
    return LIFT * (1 - easeInQuad(clamp01((p - 0.45) / 0.55)));
  }

  slideAt(h, now) {
    const t = clamp01((now - h.slide.t0) / 550);
    const e = h.slide.to < h.slide.from ? easeOutBack(t) : easeInQuad(t);
    return h.slide.from + (h.slide.to - h.slide.from) * e;
  }

  // Offsets for a hand: dx toward the opponent, dy downward.
  moodOffset(h, now) {
    const t = now - h.moodT0;
    switch (h.mood) {
      case 'win':
        return [0, -Math.round(Math.abs(Math.sin(t / 110)) * 4 * Math.max(0, 1 - t / 1200))];
      case 'champion':
        return [0, -Math.round(Math.abs(Math.sin(t / 160)) * 4)];
      case 'lose': {
        const k = easeOutCubic(clamp01(t / 300));
        return [-Math.round(3 * k), Math.round(2 * k)];
      }
      case 'defeat': {
        const k = easeOutCubic(clamp01(t / 600));
        return [-Math.round(6 * k), Math.round(4 * k)];
      }
      case 'tie':
        return [t < 480 ? (Math.floor(t / 60) % 2 ? 1 : -1) : 0, 0];
      default:
        return [0, Math.sin(now / 320 + h.phase) > 0.35 ? -1 : 0];
    }
  }

  tick(now) {
    if (this.beat && now - this.beat.t0 >= BEAT) {
      const b = this.beat;
      this.beat = null;
      if (b.onSlam) b.onSlam();
      else if (!this.quiet) sfx.thump();
      if (!this.quiet) buzz(10);
      for (const h of [this.left, this.right]) if (h.present) this.dust(h, now);
      b.done();
    }
    if (this.word?.until && now > this.word.until) this.word = null;
    this.particles = this.particles.filter((p) => now - p.t0 < p.life);
  }

  handBox(h, now) {
    const spr = hand(h.shape, h.side);
    const [mdx, mdy] = this.beat ? [0, 0] : this.moodOffset(h, now);
    const slide = Math.round(this.slideAt(h, now));
    const lift = Math.round(this.liftAt(now));
    const dx = mdx - slide;
    const x = h.side === 'left' ? ANCHOR + dx : W - ANCHOR - spr.w - dx;
    const y = ARM_Y - spr.armTop - lift + mdy;
    // centre of the fist (constant whatever the shape, so markers don't jump)
    const cx = h.side === 'left' ? x + 18 : x + spr.w - 19;
    return { spr, x, y, cx, lift };
  }

  dust(h, now) {
    const { cx } = this.handBox(h, now);
    for (let i = 0; i < 4; i++) {
      const dir = i < 2 ? -1 : 1;
      this.particles.push({
        kind: 'dust',
        x: cx + dir * (6 + Math.random() * 6),
        y: GROUND - 1,
        vx: dir * (14 + Math.random() * 18),
        vy: -(8 + Math.random() * 14),
        t0: now,
        life: 260 + Math.random() * 120,
      });
    }
  }

  confetti() {
    const now = performance.now();
    for (let i = 0; i < 46; i++) {
      this.particles.push({
        kind: 'confetti',
        x: Math.random() * W,
        y: -Math.random() * 40,
        vx: (Math.random() - 0.5) * 10,
        vy: 18 + Math.random() * 22,
        sway: Math.random() * 6,
        t0: now,
        life: 4200,
        c: Math.random() < 0.7 ? PALETTE.ink : PALETTE.shade,
        s: Math.random() < 0.3 ? 2 : 1,
      });
    }
  }

  // ---- drawing -----------------------------------------------------------

  draw(now) {
    this.tick(now);
    const g = this.g;
    g.fillStyle = PALETTE.bg;
    g.fillRect(0, 0, W, H);

    const boxes = [this.left, this.right].map((h) => [h, this.handBox(h, now)]);

    // ground shadows
    for (const [h, b] of boxes) {
      if (!h.present && this.slideAt(h, now) > 60) continue;
      this.ellipse(b.cx, GROUND, Math.max(6, 13 - b.lift * 0.6), 2, PALETTE.shade);
    }

    // waiting for an opponent
    if (!this.right.present && this.slideAt(this.right, now) > 60) {
      const bob = Math.sin(now / 300) > 0 ? -1 : 0;
      this.ellipse(W - ANCHOR - 16, GROUND, 8, 2, PALETTE.shade);
      drawText(g, '?', W - ANCHOR - 16, ARM_Y - 4 + bob, { scale: 3, align: 'center' });
    }

    for (const [h, b] of boxes) this.drawArm(h, b);

    // ready markers
    if (!this.beat) {
      for (const [h, b] of boxes) {
        if (h.ready && h.present) drawText(g, 'PRÊT', b.cx, b.y - 10, { align: 'center' });
      }
    }

    // clash star at the reveal
    if (this.flash && now - this.flash < 320) {
      const t = (now - this.flash) / 320;
      const cx = W / 2;
      const cy = ARM_Y + 7;
      const r0 = 3 + Math.round(t * 7);
      g.fillStyle = PALETTE.ink;
      for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const len = ux && uy ? 2 : 3;
        for (let i = 0; i < len; i++) g.fillRect(cx + ux * (r0 + i), cy + uy * (r0 + i), 1, 1);
      }
    }

    // big word
    if (this.word) {
      const pop = now - this.word.t0 < 70 ? -1 : 0;
      drawText(g, this.word.str, W / 2, 9 + pop, { scale: 2, align: 'center' });
    }

    // particles
    for (const p of this.particles) {
      const t = (now - p.t0) / 1000;
      if (p.kind === 'dust') {
        g.fillStyle = PALETTE.ink;
        const s = t < 0.12 ? 2 : 1;
        g.fillRect(Math.round(p.x + p.vx * t), Math.round(p.y + p.vy * t + 60 * t * t), s, s);
      } else {
        const y = p.y + p.vy * t;
        if (y > H) continue;
        g.fillStyle = p.c;
        g.fillRect(Math.round(p.x + p.vx * t + Math.sin(t * 4 + p.sway) * 3), Math.round(y), p.s, p.s);
      }
    }

    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.buf, 0, 0, W * this.k, H * this.k);
  }

  drawArm(h, { spr, x, y }) {
    if (x > W || x + spr.w < 0) return;
    const g = this.g;
    const top = y + spr.armTop;
    const rows = spr.armBottom - spr.armTop + 1;
    g.fillStyle = PALETTE.ink;
    if (h.side === 'left') g.fillRect(0, top, Math.max(0, x + 2), rows);
    else g.fillRect(x + spr.w - 2, top, W, rows);
    g.drawImage(spr.canvas, x, y);
    if (h.sleeve === 'stripes') {
      g.fillStyle = PALETTE.paper;
      if (h.side === 'right') for (let sx = x + spr.w - 3; sx < W; sx += 3) g.fillRect(sx, top + 1, 1, rows - 2);
      else for (let sx = x + 2; sx >= 0; sx -= 3) g.fillRect(sx, top + 1, 1, rows - 2);
    }
  }

  ellipse(cx, cy, rx, ry, color) {
    const g = this.g;
    g.fillStyle = color;
    for (let dy = -ry; dy <= ry; dy++) {
      const w = Math.round(rx * Math.sqrt(1 - (dy * dy) / ((ry + 0.6) * (ry + 0.6))));
      g.fillRect(Math.round(cx - w), cy + dy, w * 2, 1);
    }
  }
}

export { Aborted };
