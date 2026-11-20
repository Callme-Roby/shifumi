// Peer-to-peer rooms over WebRTC (PeerJS), plus a local computer opponent
// that speaks the same protocol.
//
// A room is identified by a short code that lives in the invitation link
// (https://…/#code). Whoever opens the link first "claims" the code and
// waits; the next person connects to them. If the first player leaves or
// reloads, the remaining one takes over the code, so the same link keeps
// working.

import { Match, PROTOCOL, SHAPES } from './game.js';
import { randomInt } from './hash.js';

const PREFIX = 'shifumi-v1-';
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const HEARTBEAT = 2500;
const LINK_TIMEOUT = 20000;

export const newCode = () => Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
export const isCode = (s) => /^[a-z0-9]{4,16}$/.test(s);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function peerOptions() {
  const opts = { debug: 0 };
  // Local testing against your own PeerServer: http://localhost:8000/?peer=localhost:9000
  const local = new URLSearchParams(location.search).get('peer');
  if (local && ['localhost', '127.0.0.1'].includes(location.hostname)) {
    const [host, port] = local.split(':');
    Object.assign(opts, { host, port: Number(port) || 9000, path: '/', secure: false, config: { iceServers: [] } });
  }
  return opts;
}

class Emitter {
  constructor() {
    this.handlers = {};
  }
  on(type, fn) {
    (this.handlers[type] ||= []).push(fn);
    return this;
  }
  emit(type, ...args) {
    for (const fn of this.handlers[type] || []) fn(...args);
  }
}

export class Room extends Emitter {
  constructor(code) {
    super();
    this.code = code;
    this.epoch = 0;
    this.peer = null;
    this.link = null;
    this.role = null;
    this.onHide = () => this.link && this.send({ t: 'bye' });
  }

  start() {
    if (typeof window.Peer !== 'function') {
      this.emit('fatal', 'nolib');
      return;
    }
    window.addEventListener('pagehide', this.onHide);
    this.run();
  }

  stop() {
    this.epoch++;
    window.removeEventListener('pagehide', this.onHide);
    if (this.link) {
      this.send({ t: 'bye' });
      const l = this.link;
      this.unlink();
      setTimeout(() => l.close(), 100);
    }
    const p = this.peer;
    this.peer = null;
    if (p) setTimeout(() => p.destroy(), 150);
  }

  send(msg) {
    try {
      if (this.link?.open) this.link.send(msg);
    } catch {
      /* the heartbeat will notice */
    }
  }

  // Claim the code, or join whoever holds it. Loops until connected/waiting.
  async run() {
    const my = ++this.epoch;
    this.peer?.destroy();
    this.peer = null;
    let failures = 0;
    while (my === this.epoch) {
      this.emit('status', 'connecting');
      const res = await this.claim(my);
      if (my !== this.epoch) return res.peer?.destroy();
      if (res.peer) {
        this.peer = res.peer;
        this.role = 'host';
        this.emit('status', 'waiting');
        return;
      }
      if (res.err?.type === 'unavailable-id') {
        this.emit('status', 'joining');
        const joined = await this.join(my);
        if (my !== this.epoch) return;
        if (joined) return;
        await sleep(600);
        continue;
      }
      failures++;
      this.emit('status', 'offline', res.err);
      await sleep(Math.min(8000, 1500 * failures));
    }
  }

  claim(my) {
    return new Promise((resolve) => {
      const peer = new window.Peer(PREFIX + this.code, peerOptions());
      let settled = false;
      const timer = setTimeout(() => finish({ err: { type: 'timeout' } }), 12000);
      const finish = (res) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (res.err) peer.destroy();
        resolve(res);
      };
      peer.on('open', () => finish({ peer }));
      peer.on('error', (err) => {
        if (!settled) finish({ err });
      });
      peer.on('connection', (conn) => {
        if (my !== this.epoch || this.peer !== peer) return conn.close();
        if (this.link) {
          conn.on('open', () => {
            conn.send({ t: 'full' });
            setTimeout(() => conn.close(), 500);
          });
          return;
        }
        this.adopt(conn);
      });
      peer.on('disconnected', () => {
        // Lost the signalling server. While waiting we must be reachable,
        // so start over (someone else may have taken the code meanwhile).
        if (settled && this.peer === peer && !this.link && my === this.epoch) this.run();
      });
    });
  }

  join(my) {
    return new Promise((resolve) => {
      const peer = new window.Peer(peerOptions());
      let settled = false;
      const timer = setTimeout(() => finish(false), 12000);
      const finish = (ok, conn) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!ok || my !== this.epoch) {
          peer.destroy();
          return resolve(false);
        }
        this.peer = peer;
        this.role = 'guest';
        this.adopt(conn);
        resolve(true);
      };
      peer.on('error', () => finish(false));
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + this.code, { reliable: true, serialization: 'json' });
        conn.on('open', () => finish(true, conn));
        conn.on('error', () => finish(false));
      });
    });
  }

  adopt(conn) {
    this.link = conn;
    let lastSeen = Date.now();
    conn.on('data', (msg) => {
      if (this.link !== conn) return;
      lastSeen = Date.now();
      if (!msg || typeof msg !== 'object' || msg.t === 'ping') return;
      if (msg.t === 'bye') return this.drop(conn);
      if (msg.t === 'full') {
        this.stop();
        return this.emit('fatal', 'full');
      }
      this.emit('message', msg);
    });
    conn.on('close', () => this.drop(conn));
    conn.on('error', () => this.drop(conn));
    this.heartbeat = setInterval(() => {
      if (Date.now() - lastSeen > LINK_TIMEOUT) return this.drop(conn);
      this.send({ t: 'ping' });
    }, HEARTBEAT);
    const ready = () => {
      if (this.link !== conn) return;
      lastSeen = Date.now();
      this.emit('connected');
    };
    if (conn.open) ready();
    else conn.on('open', ready);
  }

  unlink() {
    clearInterval(this.heartbeat);
    this.link = null;
  }

  drop(conn) {
    if (this.link !== conn) return;
    this.unlink();
    try {
      conn.close();
    } catch {
      /* already closed */
    }
    this.emit('disconnected');
    if (this.role === 'host' && this.peer && !this.peer.destroyed && !this.peer.disconnected) {
      this.emit('status', 'waiting');
    } else {
      this.run();
    }
  }
}

// ---------------------------------------------------------------------------
// Computer opponent, for practice. It runs its own Match and only picks once
// the player has locked a choice, without ever looking at it.

export class BotRoom extends Emitter {
  start() {
    this.alive = true;
    const later = (fn, ms) => setTimeout(() => this.alive && fn(), ms);
    this.later = later;
    this.bot = new Match((msg) => later(() => this.emit('message', msg), 40));
    this.bot.on('opponentLocked', (r) =>
      later(() => this.bot.round === r && this.bot.choose(SHAPES[randomInt(3)]), 500 + randomInt(900)),
    );
    this.bot.on('rematchAsked', () => later(() => this.bot.requestRematch(), 900));
    this.emit('status', 'connecting');
    later(() => this.emit('connected'), 500);
  }

  send(msg) {
    if (msg.t === 'hello') {
      this.later(() => this.emit('message', { t: 'hello', v: PROTOCOL, name: 'Ordi' }), 100);
    } else {
      this.later(() => this.bot.handle(msg), 40);
    }
  }

  stop() {
    this.alive = false;
    this.bot?.destroy();
  }
}
