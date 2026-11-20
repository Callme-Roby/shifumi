// Pixel art: hands, bitmap font and helpers to rasterize them on canvas.
//
// Hand sprites are drawn as "fill maps" pointing to the right:
//   ' ' empty        'S' sleeve (solid ink)     '#' ink detail
//   'h' back of hand 't' thumb                  'a' 'b' 'd' 'e' fingers
// The black outline is computed automatically: every empty pixel touching a
// cream part becomes ink, and a 1px line separates two different parts
// (drawn on the part that sits below, following the `z` order).

export const PALETTE = {
  bg: '#ece5d5',
  paper: '#faf6ec',
  ink: '#161412',
  shade: '#d8ceb9',
};

const HANDS = {
  rock: {
    z: 'hedbat',
    merge: ['ha', 'hb', 'hd', 'he'],
    rows: [
      '          ttttttt               ',
      '        ttttttttttt             ',
      '      hhhhttttttttttt           ',
      '     hhhhhhhhhhhhtttttt         ',
      'SSSSShhhhhhhhhhhhhhtttaaaa      ',
      'SSSSShhhhhhhhhhhhhhhaaaaaaa     ',
      'SSSSShhhhhhhhhhhhhhhaaaaaaa     ',
      'SSSSShhhhhhhhhhhhhhhaaaaaa      ',
      'SSSSShhhhhhhhhhhhhhhbbbbbbb     ',
      'SSSSShhhhhhhhhhhhhhhbbbbbbbb    ',
      'SSSSShhhhhhhhhhhhhhhbbbbbbbb    ',
      'SSSSShhhhhhhhhhhhhhhbbbbbbb     ',
      'SSSSShhhhhhhhhhhhhhhddddddd     ',
      'SSSSShhhhhhhhhhhhhhhdddddddd    ',
      'SSSSShhhhhhhhhhhhhhhddddddd     ',
      '      hhhhhhhhhhhhhheeeeee      ',
      '       hhhhhhhhhhhhheeeee       ',
      '         hhhhhhhhhhheee         ',
    ],
  },
  paper: {
    z: 'hedbat',
    merge: ['ha', 'hb', 'hd', 'he'],
    rows: [
      '            ttt                           ',
      '           tttt                           ',
      '          tttt                aaaa        ',
      '         tttt             aaaaaaaaa       ',
      '        tttt          aaaaaaaaaaaaa       ',
      '      hhttthhhhhhaaaaaaaaaaaaaaaa         ',
      'SSSSShhhhhhhhhhhhaaaaaaaaaaaaa            ',
      'SSSSShhhhhhhhhhhhaaaaaaaaa                ',
      'SSSSShhhhhhhhhhhhbbbbbbbbbbbbbbbbbbbb     ',
      'SSSSShhhhhhhhhhhhbbbbbbbbbbbbbbbbbbbbb    ',
      'SSSSShhhhhhhhhhhhbbbbbbbbbbbbbbbbbbbbb    ',
      'SSSSShhhhhhhhhhhhbbbbbbbbbbbbbbbbbbbb     ',
      'SSSSShhhhhhhhhhhhdddddddddddddddddd       ',
      'SSSSShhhhhhhhhhhhddddddddddddddddddd      ',
      'SSSSShhhhhhhhhhhhddddddddddddddddddd      ',
      'SSSSShhhhhhhhhhhhdddddddddddddddddd       ',
      'SSSSShhhhhhhhhhhheeeeeeeeeee              ',
      '       hhhhhhhhhheeeeeeeeeeeeeee          ',
      '         hhhhhhhh   eeeeeeeeeeeeee        ',
      '                        eeeeeeeeee        ',
    ],
  },
  scissors: {
    z: 'hdbat',
    merge: ['ha', 'hb', 'hd'],
    rows: [
      '                            aaa          ',
      '                         aaaaaaa         ',
      '                      aaaaaaaaaa         ',
      '                   aaaaaaaaaaaa          ',
      '      hhhhhhhhhhhaaaaaaaaaaaa            ',
      '     hhhhhhhhhhhhaaaaaaaaa               ',
      'SSSSShhhhhhhhhhhhaaaaaa                  ',
      'SSSSShhhhhhhhhhhhaaaa                    ',
      'SSSSShhhhhhhhhhhhbbbbbbbbbbbbbbbbbbbb    ',
      'SSSSShhhhhhhhhhhhbbbbbbbbbbbbbbbbbbbbb   ',
      'SSSSShhhhhhhhhhhhbbbbbbbbbbbbbbbbbbbbb   ',
      'SSSSShhhhhhhhhhhhbbbbbbbbbbbbbbbbbbbb    ',
      'SSSSShhhhhhhhhhhhdddddddddd              ',
      'SSSSShhhhhhhhhhhhddddddddddd             ',
      'SSSSShhhhhhhhhhhhddddddd###d             ',
      'SSSSShhhhhhhhhhhhdddddddddd              ',
      'SSSSShhhhhhhhhhhhddddddddd               ',
      '       hhhhhhhhhhdddddddd                ',
      '         hhhhhhhhhhhhh                   ',
    ],
  },
};

export const SHAPES = ['rock', 'paper', 'scissors'];

// Rasterize a fill map into a grid of palette keys (null = transparent).
function rasterize(def) {
  const H = def.rows.length + 2;
  const W = Math.max(...def.rows.map((r) => r.length)) + 2;
  const at = (x, y) => {
    const row = def.rows[y - 1];
    if (!row || x < 1 || x - 1 >= row.length) return ' ';
    return row[x - 1];
  };
  const isCream = (c) => c !== ' ' && c !== 'S' && c !== '#';
  const z = (c) => def.z.indexOf(c);
  const merged = (p, q) => def.merge.includes(p + q) || def.merge.includes(q + p);
  const out = [];
  for (let y = 0; y < H; y++) {
    const line = [];
    for (let x = 0; x < W; x++) {
      const c = at(x, y);
      const n = [at(x + 1, y), at(x - 1, y), at(x, y + 1), at(x, y - 1)];
      let px = null;
      if (c === 'S' || c === '#') px = 'ink';
      else if (c === ' ') px = n.some(isCream) ? 'ink' : null;
      else {
        px = 'paper';
        for (const m of n) {
          if (m === ' ' || m === 'S' || m === '#' || m === c || merged(c, m)) continue;
          if (z(m) > z(c)) px = 'ink';
        }
      }
      line.push(px);
    }
    out.push(line);
  }
  return { w: W, h: H, px: out };
}

// Draw a pixel grid into a new canvas, optionally mirrored.
function gridToCanvas(grid, mirror = false) {
  const c = document.createElement('canvas');
  c.width = grid.w;
  c.height = grid.h;
  const ctx = c.getContext('2d');
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      const p = grid.px[y][x];
      if (!p) continue;
      ctx.fillStyle = PALETTE[p];
      ctx.fillRect(mirror ? grid.w - 1 - x : x, y, 1, 1);
    }
  }
  return c;
}

const rasterCache = {};
function grid(shape) {
  if (!rasterCache[shape]) {
    const def = HANDS[shape];
    const g = rasterize(def);
    // Rows of the sleeve, so the arm can be extended to the edge of the screen.
    const sleeveRows = def.rows.map((r, i) => (r[0] === 'S' ? i + 1 : -1)).filter((i) => i >= 0);
    g.armTop = sleeveRows[0];
    g.armBottom = sleeveRows[sleeveRows.length - 1];
    rasterCache[shape] = g;
  }
  return rasterCache[shape];
}

// Returns { canvas, w, h, armTop, armBottom } for a hand pointing toward the
// opponent. `side` is 'left' (points right) or 'right' (mirrored).
const handCache = {};
export function hand(shape, side = 'left') {
  const key = `${shape}:${side}`;
  if (!handCache[key]) {
    const g = grid(shape);
    handCache[key] = {
      canvas: gridToCanvas(g, side === 'right'),
      w: g.w,
      h: g.h,
      armTop: g.armTop,
      armBottom: g.armBottom,
    };
  }
  return handCache[key];
}

// Icon used on the choice buttons: the hand with a short cuff, on a canvas
// of the same size for every shape (aligned on the wrist) so they all scale
// identically. `inverted` swaps ink and paper for the selected state.
export function icon(shape, inverted = false) {
  const cut = 3;
  const all = SHAPES.map(grid);
  const top = Math.max(...all.map((g) => g.armTop));
  const w = Math.max(...all.map((g) => g.w)) - cut;
  const h = Math.max(...all.map((g) => top - g.armTop + g.h));
  const g = grid(shape);
  const dy = top - g.armTop;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  for (let y = 0; y < g.h; y++) {
    for (let x = cut; x < g.w; x++) {
      const p = g.px[y][x];
      if (!p) continue;
      ctx.fillStyle = (p === 'ink') !== inverted ? PALETTE.ink : PALETTE.paper;
      ctx.fillRect(x - cut, y + dy, 1, 1);
    }
  }
  return c;
}

// ---------------------------------------------------------------------------
// 5x7 bitmap font. Accented capitals carry two extra rows on top.

const GLYPHS = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  J: ['..###', '...#.', '...#.', '...#.', '#..#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['.#.', '##.', '.#.', '.#.', '.#.', '.#.', '###'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  '!': ['#', '#', '#', '#', '#', '.', '#'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  '.': ['.', '.', '.', '.', '.', '.', '#'],
  ':': ['.', '#', '.', '.', '.', '#', '.'],
  '-': ['...', '...', '...', '###', '...', '...', '...'],
  "'": ['#', '#', '.', '.', '.', '.', '.'],
  ' ': ['...', '...', '...', '...', '...', '...', '...'],
  É: ['...#.', '..#..', '#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  È: ['.#...', '..#..', '#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  Ê: ['..#..', '.#.#.', '#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  À: ['.#...', '..#..', '.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
};

export function textWidth(str, scale = 1) {
  let w = 0;
  for (const ch of str) w += ((GLYPHS[ch] || GLYPHS['?'])[0].length + 1) * scale;
  return Math.max(0, w - scale);
}

// Draw text with its top-left at (x, y) (baseline of non-accented capitals).
export function drawText(ctx, str, x, y, { scale = 1, color = PALETTE.ink, align = 'left' } = {}) {
  if (align === 'center') x -= Math.floor(textWidth(str, scale) / 2);
  else if (align === 'right') x -= textWidth(str, scale);
  ctx.fillStyle = color;
  for (const ch of str) {
    const g = GLYPHS[ch] || GLYPHS['?'];
    const top = y - (g.length - 7) * scale;
    for (let gy = 0; gy < g.length; gy++) {
      for (let gx = 0; gx < g[gy].length; gx++) {
        if (g[gy][gx] === '#') ctx.fillRect(x + gx * scale, top + gy * scale, scale, scale);
      }
    }
    x += (g[0].length + 1) * scale;
  }
}
