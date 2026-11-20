// Match logic, shared by both players (and by the computer opponent).
//
// Every round uses a commit/reveal exchange so that nobody can see the other
// player's choice before locking their own:
//   1. each player sends  { t: 'commit', r, h }  with h = sha256(r|choice|nonce)
//   2. once both commits are known, each sends { t: 'reveal', r, c, n }
//   3. each side checks the hash, then scores the round.

import { randomHex, sha256hex } from './hash.js';

export const PROTOCOL = 1;
export const SHAPES = ['rock', 'paper', 'scissors'];
export const TARGET = 3;

const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

// 1 if a beats b, -1 if b beats a, 0 on a tie.
export const outcomeOf = (a, b) => (a === b ? 0 : BEATS[a] === b ? 1 : -1);

export class Match {
  constructor(send, { target = TARGET } = {}) {
    this.send = send;
    this.target = target;
    this.round = 1;
    this.score = [0, 0]; // [me, opponent]
    this.over = false;
    this.mine = new Map(); // round -> { choice, nonce, hash, revealed }
    this.theirs = new Map(); // round -> { hash, choice }
    this.waiters = new Map();
    this.rematch = [false, false];
    this.handlers = {};
    this.dead = false;
  }

  on(type, fn) {
    (this.handlers[type] ||= []).push(fn);
    return this;
  }

  emit(type, ...args) {
    for (const fn of this.handlers[type] || []) fn(...args);
  }

  get locked() {
    return this.mine.has(this.round);
  }

  get opponentLocked() {
    return !this.over && !!this.theirs.get(this.round)?.hash;
  }

  async choose(choice) {
    if (this.dead || this.over || this.locked || !SHAPES.includes(choice)) return false;
    const r = this.round;
    const entry = { choice, nonce: randomHex(16), hash: null, revealed: false };
    this.mine.set(r, entry);
    entry.hash = await sha256hex(`${r}|${choice}|${entry.nonce}`);
    if (this.dead) return false;
    this.send({ t: 'commit', r, h: entry.hash });
    this.check(r);
    return true;
  }

  check(r) {
    const m = this.mine.get(r);
    const t = this.theirs.get(r);
    if (!m?.hash || !t?.hash || m.revealed) return;
    m.revealed = true;
    this.send({ t: 'reveal', r, c: m.choice, n: m.nonce });
    this.emit('bothLocked', r);
  }

  async handle(msg) {
    if (this.dead || !msg || typeof msg !== 'object') return;
    const { r } = msg;
    switch (msg.t) {
      case 'commit': {
        // The opponent can be at most one round ahead of us.
        if (!Number.isInteger(r) || r < this.round || r > this.round + 1) return;
        if (typeof msg.h !== 'string' || this.theirs.has(r)) return;
        this.theirs.set(r, { hash: msg.h, choice: null });
        if (r === this.round && !this.over) this.emit('opponentLocked', r);
        this.check(r);
        break;
      }
      case 'reveal': {
        const t = this.theirs.get(r);
        if (!t || t.choice || !this.mine.get(r)?.revealed) return;
        const ok =
          SHAPES.includes(msg.c) &&
          typeof msg.n === 'string' &&
          (await sha256hex(`${r}|${msg.c}|${msg.n}`)) === t.hash;
        if (this.dead) return;
        if (!ok) {
          this.emit('cheat');
          return;
        }
        t.choice = msg.c;
        this.resolve(r);
        break;
      }
      case 'rematch': {
        if (!this.over || this.rematch[1]) return;
        this.rematch[1] = true;
        this.emit('rematchAsked');
        this.tryRestart();
        break;
      }
    }
  }

  resolve(r) {
    const mine = this.mine.get(r).choice;
    const theirs = this.theirs.get(r).choice;
    const outcome = outcomeOf(mine, theirs);
    if (outcome > 0) this.score[0]++;
    else if (outcome < 0) this.score[1]++;
    const over = this.score[0] >= this.target || this.score[1] >= this.target;
    if (over) this.over = true;
    else this.round = r + 1;
    const result = { r, mine, theirs, outcome, score: [...this.score], over };
    this.waiter(r).resolve(result);
    this.emit('resolved', result);
  }

  // Promise of the result of round r (resolves once both reveals are checked).
  result(r) {
    return this.waiter(r).promise;
  }

  waiter(r) {
    if (!this.waiters.has(r)) {
      const w = {};
      w.promise = new Promise((res, rej) => Object.assign(w, { resolve: res, reject: rej }));
      w.promise.catch(() => {});
      this.waiters.set(r, w);
    }
    return this.waiters.get(r);
  }

  requestRematch() {
    if (!this.over || this.rematch[0]) return;
    this.rematch[0] = true;
    this.send({ t: 'rematch' });
    this.tryRestart();
  }

  tryRestart() {
    if (!this.rematch[0] || !this.rematch[1]) return;
    this.rematch = [false, false];
    this.score = [0, 0];
    this.over = false;
    this.round += 1;
    this.emit('restart');
    if (this.opponentLocked) this.emit('opponentLocked', this.round);
  }

  destroy() {
    this.dead = true;
    for (const w of this.waiters.values()) w.reject(new Error('closed'));
  }
}
