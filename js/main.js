import { Stage, Aborted } from './stage.js';
import { icon } from './sprites.js';
import { Room, BotRoom, newCode, isCode } from './net.js';
import { Match, PROTOCOL, TARGET } from './game.js';
import { sfx, isMuted, setMuted, unlockAudio } from './sound.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PANELS = ['home', 'join', 'lobby', 'play', 'over', 'error'];
const NOUN = { rock: 'la pierre', paper: 'la feuille', scissors: 'les ciseaux' };
const VERB = { rock: 'casse', paper: 'enveloppe', scissors: 'coupent' };
const LABEL = { rock: 'pierre', paper: 'feuille', scissors: 'ciseaux' };

const stage = new Stage($('stage'), $('stage-wrap'));

const S = {
  room: null,
  match: null,
  code: null,
  name: '', // pseudo sent to the opponent (may be empty)
  me: 'Toi', // how we show ourselves
  them: '',
  busy: false, // a round is being animated
};

// ---- small helpers --------------------------------------------------------

const store = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
};

const cleanName = (s) =>
  String(s || '')
    .replace(/[\u0000-\u001f\u007f-\u009f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12);

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function saveName(value) {
  const name = cleanName(value);
  store.set('shifumi.name', name);
  S.name = name;
  S.me = name || 'Toi';
}

function show(name) {
  for (const p of PANELS) $(`panel-${p}`).hidden = p !== name;
  $('btn-quit').hidden = !['play', 'over'].includes(name);
  $('scoreboard').hidden = !['play', 'over'].includes(name);
}

function setStatus(el, text, waiting = false) {
  el.textContent = text;
  el.classList.toggle('wait', waiting);
}

let toastTimer;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3000);
}

function setScore([me, them], animate) {
  for (const [id, v] of [['pts-me', me], ['pts-them', them]]) {
    const el = $(id);
    if (el.textContent !== String(v) && animate) {
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
    }
    el.textContent = v;
  }
}

function parseHash() {
  const h = decodeURIComponent(location.hash.slice(1)).trim().toLowerCase();
  return isCode(h) ? h : null;
}

const inviteUrl = (code) => `${location.origin}${location.pathname}${location.search}#${code}`;

// ---- choice buttons -------------------------------------------------------

const choiceButtons = [...document.querySelectorAll('.choice')];

function paintChoice(btn, inverted) {
  const src = icon(btn.dataset.shape, inverted);
  const c = btn.querySelector('canvas');
  c.width = src.width;
  c.height = src.height;
  c.style.width = `${src.width * 2}px`;
  c.getContext('2d').drawImage(src, 0, 0);
}

function resetChoices(enabled) {
  for (const b of choiceButtons) {
    b.classList.remove('selected');
    b.disabled = !enabled;
    b.setAttribute('aria-pressed', 'false');
    paintChoice(b, false);
  }
}

function markChoice(shape) {
  for (const b of choiceButtons) {
    const sel = b.dataset.shape === shape;
    b.classList.toggle('selected', sel);
    b.setAttribute('aria-pressed', String(sel));
    b.disabled = true;
    paintChoice(b, sel);
  }
}

choiceButtons.forEach((b) => b.addEventListener('click', () => choose(b.dataset.shape)));

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input') || e.ctrlKey || e.metaKey || e.altKey || $('panel-play').hidden) return;
  const shape = { 1: 'rock', 2: 'paper', 3: 'scissors', p: 'rock', f: 'paper', c: 'scissors' }[e.key.toLowerCase()];
  if (shape) {
    e.preventDefault();
    choose(shape);
  }
});

// ---- screens --------------------------------------------------------------

function leave() {
  S.room?.stop();
  S.room = null;
  S.match?.destroy();
  S.match = null;
  S.code = null;
  S.them = '';
  S.busy = false;
}

function goHome() {
  leave();
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  stage.cancel();
  stage.setPresent('right', true, false);
  stage.attract(true);
  $('in-name').value = store.get('shifumi.name') || '';
  show('home');
}

function showJoin() {
  leave();
  stage.cancel();
  stage.setPresent('right', true, false);
  stage.attract(true);
  $('in-name-join').value = store.get('shifumi.name') || '';
  show('join');
}

function fail(text) {
  leave();
  stage.cancel();
  stage.setPresent('right', false, true);
  $('error-text').textContent = text;
  show('error');
}

function route() {
  const code = parseHash();
  if (code && code === S.code) return;
  if (code) showJoin();
  else goHome();
}

function prepareArena() {
  unlockAudio();
  stage.attract(false);
  stage.cancel();
  stage.setPresent('right', false, true);
}

function enterRoom(code) {
  leave();
  prepareArena();
  S.code = code;
  $('invite-url').value = inviteUrl(code);
  $('btn-share').hidden = !navigator.share;
  $('lobby-lead').textContent = 'Envoie ce lien à ton adversaire :';
  setStatus($('lobby-status'), 'Connexion', true);
  show('lobby');
  const room = new Room(code);
  S.room = room;
  bindRoom(room);
  room.start();
}

function startSolo() {
  leave();
  prepareArena();
  show(null);
  const room = new BotRoom();
  S.room = room;
  bindRoom(room);
  room.start();
}

function bindRoom(room) {
  const mine = () => S.room === room;
  room.on('status', (st) => {
    if (!mine() || S.match) return;
    const waitingText = S.them ? `En attente du retour de ${S.them}` : "En attente d'un adversaire";
    const text = {
      connecting: 'Connexion',
      waiting: waitingText,
      joining: 'Connexion à la partie',
      offline: 'Serveur de mise en relation injoignable. Nouvel essai',
    }[st];
    if (text) setStatus($('lobby-status'), text, true);
  });
  room.on('connected', () => {
    if (!mine()) return;
    room.send({ t: 'hello', v: PROTOCOL, name: S.name });
    setStatus($('lobby-status'), 'Connecté !');
  });
  room.on('message', (msg) => {
    if (!mine()) return;
    if (msg.t === 'hello') onHello(msg);
    else S.match?.handle(msg);
  });
  room.on('disconnected', () => mine() && onOpponentLeft());
  room.on('fatal', (why) => {
    if (!mine()) return;
    fail(
      why === 'full'
        ? 'Cette partie est déjà complète. Demande un nouveau lien !'
        : "Le jeu en ligne n'a pas pu se charger. Vérifie ta connexion et recharge la page.",
    );
  });
}

function onHello(msg) {
  if (S.match) return;
  if (msg.v !== PROTOCOL) {
    fail("Vous n'avez pas la même version du jeu. Rechargez la page tous les deux.");
    return;
  }
  S.them = cleanName(msg.name) || 'Anonyme';
  startMatch();
}

function onOpponentLeft() {
  const who = S.them || 'Ton adversaire';
  S.match?.destroy();
  S.match = null;
  S.busy = false;
  stage.cancel();
  stage.setPresent('right', false, true);
  toast(`${who} a quitté la partie`);
  $('lobby-lead').textContent = 'Ton adversaire peut revenir avec ce lien :';
  setStatus($('lobby-status'), `En attente du retour de ${who}`, true);
  show('lobby');
}

// ---- the match ------------------------------------------------------------

function startMatch() {
  const match = new Match((msg) => S.room?.send(msg), { target: TARGET });
  S.match = match;
  const mine = () => S.match === match;
  match.on('opponentLocked', (r) => {
    if (!mine() || S.busy || r !== match.round) return;
    stage.setReady('right', true);
    updatePlayStatus();
  });
  match.on('bothLocked', (r) => mine() && playRound(match, r));
  match.on('rematchAsked', () => {
    if (!mine() || match.rematch[0]) return;
    setStatus($('over-status'), `${S.them} veut sa revanche !`);
  });
  match.on('restart', () => mine() && freshMatchUi());
  match.on('cheat', () => mine() && fail('Triche détectée : la main révélée ne correspond pas au choix verrouillé.'));

  $('name-me').textContent = S.me;
  $('name-them').textContent = S.them;
  $('target').textContent = TARGET;
  stage.setPresent('right', true, true);
  sfx.join();
  freshMatchUi();
}

function freshMatchUi() {
  S.busy = false;
  stage.cancel();
  setScore([0, 0], false);
  resetChoices(true);
  show('play');
  if (S.match.opponentLocked) stage.setReady('right', true);
  updatePlayStatus();
}

function updatePlayStatus() {
  const m = S.match;
  if (!m || S.busy) return;
  const el = $('play-status');
  if (!m.locked && !m.opponentLocked) setStatus(el, 'Choisis ta main');
  else if (!m.locked) setStatus(el, `${S.them} a choisi. À toi !`);
  else if (!m.opponentLocked) setStatus(el, `${S.them} réfléchit`, true);
  else setStatus(el, '');
}

async function choose(shape) {
  const m = S.match;
  if (!m || S.busy || m.locked || m.over) return;
  unlockAudio();
  sfx.lock();
  markChoice(shape);
  stage.setReady('left', true);
  await m.choose(shape);
  updatePlayStatus();
}

function describe({ mine, theirs, outcome }) {
  if (outcome === 0) return `Égalité : ${LABEL[mine]} contre ${LABEL[theirs]}`;
  const [w, l] = outcome > 0 ? [mine, theirs] : [theirs, mine];
  return `${cap(NOUN[w])} ${VERB[w]} ${NOUN[l]}. Point pour ${outcome > 0 ? 'toi' : S.them} !`;
}

async function playRound(match, r) {
  S.busy = true;
  for (const b of choiceButtons) b.disabled = true;
  setStatus($('play-status'), '');
  let res;
  try {
    res = await stage.playRound(match.result(r));
  } catch (e) {
    if (!(e instanceof Aborted) && S.match === match) toast('La connexion semble instable');
    return;
  }
  if (S.match !== match) return;
  stage.showOutcome(res.outcome);
  (res.outcome > 0 ? sfx.win : res.outcome < 0 ? sfx.lose : sfx.tie)();
  setScore(res.score, true);
  setStatus($('play-status'), describe(res));
  await sleep(2000);
  if (S.match !== match) return;
  S.busy = false;
  if (res.over) {
    const won = res.score[0] > res.score[1];
    stage.showMatchEnd(won);
    (won ? sfx.victory : sfx.defeat)();
    const [a, b] = won ? res.score : [res.score[1], res.score[0]];
    $('over-title').textContent = won ? `Tu gagnes ${a} à ${b} !` : `${S.them} gagne ${a} à ${b}`;
    $('btn-rematch').disabled = false;
    setStatus($('over-status'), match.rematch[1] ? `${S.them} veut sa revanche !` : '');
    show('over');
    return;
  }
  stage.reset();
  resetChoices(true);
  if (match.opponentLocked) stage.setReady('right', true);
  updatePlayStatus();
}

// ---- wiring ---------------------------------------------------------------

$('btn-create').addEventListener('click', () => {
  saveName($('in-name').value);
  const code = newCode();
  history.pushState(null, '', `#${code}`);
  enterRoom(code);
});

$('btn-join').addEventListener('click', () => {
  saveName($('in-name-join').value);
  const code = parseHash();
  if (code) enterRoom(code);
  else goHome();
});

$('btn-solo').addEventListener('click', () => {
  saveName($('in-name').value);
  startSolo();
});

for (const id of ['in-name', 'in-name-join']) {
  $(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $(id === 'in-name' ? 'btn-create' : 'btn-join').click();
  });
}

$('btn-rematch').addEventListener('click', () => {
  const m = S.match;
  if (!m) return;
  sfx.click();
  m.requestRematch();
  $('btn-rematch').disabled = true;
  if (m.over) setStatus($('over-status'), `En attente de ${S.them}`, true);
});

$('btn-copy').addEventListener('click', async () => {
  const input = $('invite-url');
  try {
    await navigator.clipboard.writeText(input.value);
  } catch {
    input.select();
    document.execCommand('copy');
  }
  sfx.click();
  $('btn-copy').textContent = 'Copié !';
  setTimeout(() => ($('btn-copy').textContent = 'Copier'), 1500);
});

$('invite-url').addEventListener('focus', (e) => e.target.select());

$('btn-share').addEventListener('click', () => {
  navigator
    .share({ title: 'Shifumi', text: 'Viens jouer à pierre, feuille, ciseaux contre moi !', url: $('invite-url').value })
    .catch(() => {});
});

for (const el of document.querySelectorAll('[data-action="home"]')) {
  el.addEventListener('click', () => {
    sfx.click();
    goHome();
  });
}

$('logo').addEventListener('click', (e) => {
  e.preventDefault();
  goHome();
});

const soundBtn = $('btn-sound');
const syncSound = () => soundBtn.setAttribute('aria-pressed', String(!isMuted()));
soundBtn.addEventListener('click', () => {
  setMuted(!isMuted());
  syncSound();
  sfx.click();
});
syncSound();

window.addEventListener('popstate', route);
window.addEventListener('hashchange', route);

// Favicon drawn from the fist sprite.
(() => {
  const src = icon('rock');
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  c.getContext('2d').drawImage(src, Math.floor((32 - src.width) / 2), Math.floor((32 - src.height) / 2));
  const link = document.createElement('link');
  link.rel = 'icon';
  link.href = c.toDataURL();
  document.head.append(link);
})();

S.name = cleanName(store.get('shifumi.name'));
S.me = S.name || 'Toi';
resetChoices(false);
route();
