// "One Spark" — a make.fun ai-excited-01 entry.
//
// One match, struck in the dark. Its flame is not a flame: it is a whole
// spiral galaxy, lit from a single spark. The idea is the scale twist —
// the smallest light you can hold, holding a universe.
//
// Drawn procedurally, pixel by pixel, with the Node standard library only.
// Deterministic: a fixed-seed PRNG drives every star, ember and spiral arm,
// so two runs write byte-identical PNGs. No image is downloaded, copied or
// traced; every pixel is computed here.
//
// Run:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Output: <out>/entry.png — 1024x1024 PNG, RGB.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------------------
// Deterministic randomness (mulberry32, fixed seed) and small noise helpers.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0x51a4e01);

// Integer lattice hash -> [0, 1).
function hash2(ix: number, iy: number): number {
  let h = (ix * 374761393 + iy * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) % 100000) / 100000;
}

// Smooth value noise in [0, 1), for nebula wisps and wood grain.
function noise2(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x: number, y: number): number {
  return (
    noise2(x, y) * 0.55 +
    noise2(x * 2.13 + 7.7, y * 2.13 + 3.1) * 0.3 +
    noise2(x * 4.31 + 13.7, y * 4.31 + 9.4) * 0.15
  );
}

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// ---------------------------------------------------------------------------
// Canvas: float RGB buffer, additive light.
// ---------------------------------------------------------------------------

const px = new Float32Array(W * H * 3);

function addPixel(x: number, y: number, r: number, g: number, b: number): void {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= W || iy >= H) return;
  const o = (iy * W + ix) * 3;
  px[o] += r;
  px[o + 1] += g;
  px[o + 2] += b;
}

function setPixel(x: number, y: number, r: number, g: number, b: number): void {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= W || iy >= H) return;
  const o = (iy * W + ix) * 3;
  px[o] = r;
  px[o + 1] = g;
  px[o + 2] = b;
}

// Soft round light: intensity falls off smoothly to the edge.
function softDisc(cx: number, cy: number, radius: number, r: number, g: number, b: number, strength: number): void {
  const r0 = Math.max(0, Math.floor(cx - radius));
  const r1 = Math.min(W - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(H - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y++) {
    for (let x = r0; x <= r1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy) / radius;
      if (d >= 1) continue;
      const fall = (1 - d * d) * (1 - d * d);
      const o = (y * W + x) * 3;
      px[o] += r * strength * fall;
      px[o + 1] += g * strength * fall;
      px[o + 2] += b * strength * fall;
    }
  }
}

// Crisp disc with a soft rim, for stars and embers.
function hardDisc(cx: number, cy: number, radius: number, r: number, g: number, b: number, strength: number): void {
  const r0 = Math.max(0, Math.floor(cx - radius - 1));
  const r1 = Math.min(W - 1, Math.ceil(cx + radius + 1));
  const y0 = Math.max(0, Math.floor(cy - radius - 1));
  const y1 = Math.min(H - 1, Math.ceil(cy + radius + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = r0; x <= r1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      let fall: number;
      if (d <= radius) fall = 1;
      else if (d <= radius + 1) fall = radius + 1 - d;
      else continue;
      const o = (y * W + x) * 3;
      px[o] += r * strength * fall;
      px[o + 1] += g * strength * fall;
      px[o + 2] += b * strength * fall;
    }
  }
}

// Thick line as a chain of soft discs, for the matchstick and smoke.
function thickLine(
  x0: number, y0: number, x1: number, y1: number,
  width: number, r: number, g: number, b: number, strength: number,
): void {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(dist / (width * 0.4)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    softDisc(lerp(x0, x1, t), lerp(y0, y1, t), width / 2, r, g, b, strength);
  }
}

// ---------------------------------------------------------------------------
// PNG encoder: RGB, 8-bit, per-row filter chosen by smallest absolute sum.
// ---------------------------------------------------------------------------

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc);
  return out;
}

function encodePNG(): Buffer {
  const raw = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    raw[i * 3] = clamp255(px[i * 3]);
    raw[i * 3 + 1] = clamp255(px[i * 3 + 1]);
    raw[i * 3 + 2] = clamp255(px[i * 3 + 2]);
  }

  const stride = W * 3;
  const filtered = new Uint8Array(H * (stride + 1));
  const prev = new Uint8Array(stride);
  const candidates: Uint8Array[] = [
    new Uint8Array(stride),
    new Uint8Array(stride),
    new Uint8Array(stride),
    new Uint8Array(stride),
    new Uint8Array(stride),
  ];
  for (let y = 0; y < H; y++) {
    const row = raw.subarray(y * stride, (y + 1) * stride);
    // Filter 0: None.
    candidates[0].set(row);
    // Filter 1: Sub.
    for (let i = 0; i < stride; i++) {
      const left = i >= 3 ? row[i - 3] : 0;
      candidates[1][i] = (row[i] - left) & 0xff;
    }
    // Filter 2: Up.
    for (let i = 0; i < stride; i++) candidates[2][i] = (row[i] - prev[i]) & 0xff;
    // Filter 3: Average.
    for (let i = 0; i < stride; i++) {
      const left = i >= 3 ? row[i - 3] : 0;
      candidates[3][i] = (row[i] - Math.floor((left + prev[i]) / 2)) & 0xff;
    }
    // Filter 4: Paeth.
    for (let i = 0; i < stride; i++) {
      const a = i >= 3 ? row[i - 3] : 0;
      const b = prev[i];
      const c = i >= 3 ? prev[i - 3] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      candidates[4][i] = (row[i] - pred) & 0xff;
    }
    let best = 0;
    let bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      let score = 0;
      const cand = candidates[f];
      for (let i = 0; i < stride; i++) {
        const v = cand[i];
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }
    const outRow = y * (stride + 1);
    filtered[outRow] = best;
    filtered.set(candidates[best], outRow + 1);
    prev.set(row);
  }

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, W);
  ihdrView.setUint32(4, H);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const idat = deflateSync(filtered, { level: 9 });
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(pngChunk('IHDR', ihdr)),
    Buffer.from(pngChunk('IDAT', new Uint8Array(idat))),
    Buffer.from(pngChunk('IEND', new Uint8Array(0))),
  ]);
  return png;
}

// ---------------------------------------------------------------------------
// Scene: "One Spark".
//
// Composition: a matchstick runs diagonally from the lower left up to a
// spiral galaxy that burns where the match head is. The galaxy is the one
// focal moment — bright, warm, turning — against a near-black sky.
// ---------------------------------------------------------------------------

const GALAXY_X = 622;
const GALAXY_Y = 336;
const HEAD_X = 596;
const HEAD_Y = 478;
const BASE_X = 288;
const BASE_Y = 872;

function paintBackground(): void {
  // Deep indigo sky, lighter toward the galaxy, darkened at the corners.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x - GALAXY_X) / W;
      const dy = (y - GALAXY_Y) / H;
      const dg = Math.sqrt(dx * dx + dy * dy);
      const glow = Math.max(0, 1 - dg * 1.6);
      const r = 4 + glow * 14 + (y / H) * 4;
      const g = 4 + glow * 10 + (y / H) * 5;
      const b = 16 + glow * 26 + (y / H) * 12;
      // Vignette.
      const vx = (x - W / 2) / (W / 2);
      const vy = (y - H / 2) / (H / 2);
      const vig = Math.max(0, 1 - (vx * vx + vy * vy) * 0.22);
      setPixel(x, y, r * vig, g * vig, b * vig);
    }
  }
  // Faint nebula wisps, purple and teal, barely there.
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const n = fbm(x / 260, y / 260);
      if (n > 0.62) {
        const a = (n - 0.62) * 26;
        const teal = noise2(x / 180 + 40, y / 180) > 0.5;
        addPixel(x, y, teal ? a * 0.12 : a * 0.5, a * 0.16, a * 0.85);
      }
    }
  }
}

function paintStars(): void {
  for (let i = 0; i < 750; i++) {
    const x = rand() * W;
    const y = rand() * H;
    // Keep the galaxy's neighbourhood clear so the flame stays the focus.
    if (Math.hypot(x - GALAXY_X, y - GALAXY_Y) < 190) continue;
    const bright = 0.25 + rand() * rand() * 0.75;
    const warm = rand();
    const r = 200 + warm * 55;
    const g = 205 + warm * 30;
    const b = 255 - warm * 40;
    const size = rand() < 0.06 ? 1.7 : rand() < 0.25 ? 1.2 : 0.7;
    hardDisc(x, y, size, r, g, b, bright * 0.85);
    // A few bright stars get a four-point sparkle.
    if (rand() < 0.05) {
      const len = 5 + rand() * 7;
      thickLine(x - len, y, x + len, y, 1.2, r, g, b, 0.35);
      thickLine(x, y - len, x, y + len, 1.2, r, g, b, 0.35);
    }
  }
}

// Colour ramp along a spiral arm: white-gold core -> orange -> magenta -> violet.
function armColor(t: number): [number, number, number] {
  const stops: Array<[number, number, number, number]> = [
    [0.0, 255, 244, 214],
    [0.25, 255, 208, 122],
    [0.5, 255, 154, 60],
    [0.72, 255, 94, 138],
    [1.0, 154, 107, 255],
  ];
  for (let s = 0; s < stops.length - 1; s++) {
    const [t0, r0, g0, b0] = stops[s];
    const [t1, r1, g1, b1] = stops[s + 1];
    if (t >= t0 && t <= t1) {
      const k = (t - t0) / (t1 - t0);
      return [lerp(r0, r1, k), lerp(g0, g1, k), lerp(b0, b1, k)];
    }
  }
  return [154, 107, 255];
}

function paintGalaxy(): void {
  // Wide warm halo first, so the arms sit in light.
  softDisc(GALAXY_X, GALAXY_Y, 330, 255, 150, 60, 0.16);
  softDisc(GALAXY_X, GALAXY_Y, 210, 255, 170, 90, 0.28);
  softDisc(GALAXY_X, GALAXY_Y, 120, 255, 220, 150, 0.55);

  // Two logarithmic spiral arms, tilted to echo the matchstick's diagonal.
  const tilt = -0.42;
  const squash = 0.72;
  for (let arm = 0; arm < 2; arm++) {
    const armOffset = arm * Math.PI;
    const points = 1000;
    for (let i = 0; i < points; i++) {
      const t = i / points;
      const angle = t * 5.2 * Math.PI + armOffset + (rand() - 0.5) * 0.18;
      const radius = 12 + Math.pow(t, 1.5) * 265 + (rand() - 0.5) * 14 * (0.3 + t);
      const lx = Math.cos(angle) * radius;
      const ly = Math.sin(angle) * radius * squash;
      const x = GALAXY_X + lx * Math.cos(tilt) - ly * Math.sin(tilt);
      const y = GALAXY_Y + lx * Math.sin(tilt) + ly * Math.cos(tilt);
      const [r, g, b] = armColor(t);
      const size = 1 + (1 - t) * 2.2 + rand() * 1.2;
      const strength = (1 - t * 0.7) * (0.4 + rand() * 0.55);
      softDisc(x, y, size, r, g, b, strength);
    }
  }

  // Dense bright core: a tight cluster of hot points.
  for (let i = 0; i < 500; i++) {
    const a = rand() * Math.PI * 2;
    const rr = Math.pow(rand(), 0.5) * 48;
    const x = GALAXY_X + Math.cos(a) * rr;
    const y = GALAXY_Y + Math.sin(a) * rr * squash;
    const heat = 1 - rr / 58;
    softDisc(x, y, 1.6 + rand() * 2.0, 255, 235 - heat * 20, 190, 0.5 + heat * 0.7);
  }
  softDisc(GALAXY_X, GALAXY_Y, 30, 255, 246, 220, 0.9);
  softDisc(GALAXY_X, GALAXY_Y, 12, 255, 255, 245, 1.2);

  // Lens-flare spikes from the core: horizontal long, vertical short.
  for (const [dx, dy, len, w] of [
    [-1, 0, 300, 2.2],
    [1, 0, 300, 2.2],
    [0, -1, 150, 1.8],
    [0, 1, 150, 1.8],
  ] as const) {
    const steps = 60;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const fall = (1 - t) * (1 - t) * 0.5;
      softDisc(
        GALAXY_X + dx * t * len, GALAXY_Y + dy * t * len,
        w, 255, 230, 180, fall,
      );
    }
  }

  // Embers: small bright dots drifting up and out, no trails.
  for (let i = 0; i < 30; i++) {
    const a = rand() * Math.PI * 2;
    const rr = 80 + rand() * 180;
    const x = GALAXY_X + Math.cos(a) * rr;
    const y = GALAXY_Y + Math.sin(a) * rr * squash - rand() * 50;
    hardDisc(x, y, 0.8 + rand() * 0.7, 255, 215, 140, 0.75);
  }
}

function paintMatchstick(): void {
  const dx = HEAD_X - BASE_X;
  const dy = HEAD_Y - BASE_Y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  // Perpendicular; the galaxy lights the upper-right side of the shaft.
  const pxv = -uy;
  const pyv = ux;
  const half = 17;

  // Shaft, rasterised directly (not additive) so the wood keeps its colour:
  // dark on the far side, warm tan toward the galaxy, grain along the length.
  const minX = Math.max(0, Math.floor(Math.min(BASE_X, HEAD_X) - half - 2));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(BASE_X, HEAD_X) + half + 2));
  const minY = Math.max(0, Math.floor(Math.min(BASE_Y, HEAD_Y) - half - 2));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(BASE_Y, HEAD_Y) + half + 2));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const relX = x - BASE_X;
      const relY = y - BASE_Y;
      const t = (relX * ux + relY * uy) / len;
      const d = relX * pxv + relY * pyv;
      if (t < -0.02 || t > 1.02 || Math.abs(d) > half + 1.5) continue;
      const side = (d + half) / (2 * half); // 0 far side, 1 galaxy side
      const grain = (fbm(t * 34 + 3.7, 1.2) - 0.5) * 46;
      let r = lerp(96, 214, side) + grain;
      let g = lerp(58, 150, side) + grain * 0.8;
      let b = lerp(30, 84, side) + grain * 0.6;
      // Charred darkening near the head.
      if (t > 0.9) {
        const k = (t - 0.9) / 0.1;
        r = lerp(r, 70, k * 0.8);
        g = lerp(g, 40, k * 0.8);
        b = lerp(b, 26, k * 0.8);
      }
      // Hot rim on the galaxy side, strongest near the head.
      if (side > 0.72 && t > 0.5) {
        const k = (side - 0.72) / 0.28 * (0.4 + (t - 0.5) * 1.2);
        r = lerp(r, 255, k * 0.7);
        g = lerp(g, 200, k * 0.7);
        b = lerp(b, 120, k * 0.7);
      }
      // Antialiased edge.
      const edge = Math.abs(d) - half;
      if (edge > 0) {
        const o = (y * W + x) * 3;
        const mix = 1 - edge / 1.5;
        px[o] = lerp(px[o], r, mix);
        px[o + 1] = lerp(px[o + 1], g, mix);
        px[o + 2] = lerp(px[o + 2], b, mix);
      } else {
        setPixel(x, y, r, g, b);
      }
    }
  }
  // Rounded butt end: cut wood, no glow.
  softDisc(BASE_X, BASE_Y, 15, 130, 86, 44, 0.8);

  // Head: charred red-brown bulb, wider than the shaft, glowing rim.
  softDisc(HEAD_X, HEAD_Y, 38, 84, 18, 18, 1.0);
  softDisc(HEAD_X, HEAD_Y, 31, 138, 36, 28, 1.0);
  softDisc(HEAD_X - 9, HEAD_Y - 10, 13, 196, 72, 54, 0.9);
  // Rim light where the galaxy touches the head.
  softDisc(HEAD_X + 11, HEAD_Y - 18, 15, 255, 205, 120, 0.9);
  softDisc(HEAD_X + 5, HEAD_Y - 24, 8, 255, 235, 180, 1.0);

  // Warm light spilling from the flame onto the shaft's upper end.
  softDisc(HEAD_X - 30, HEAD_Y - 40, 90, 255, 170, 80, 0.18);
}

// ---------------------------------------------------------------------------
// Text: a small 5x7 bitmap font, only the letters "ONE SPARK" needs.
// ---------------------------------------------------------------------------

const GLYPHS: Record<string, string[]> = {
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
};

function paintText(text: string, cx: number, top: number, scale: number): void {
  const advance = 6 * scale;
  const total = text.length * advance - scale;
  let x = cx - total / 2;
  for (const ch of text) {
    if (ch !== ' ') {
      const glyph = GLYPHS[ch];
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 5; col++) {
          if (glyph[row][col] === '#') {
            // Soft gold halo, then a crisp core, so the letters glow a little.
            softDisc(
              x + (col + 0.5) * scale, top + (row + 0.5) * scale,
              scale * 0.85, 255, 210, 130, 0.35,
            );
            for (let dy = 0; dy < scale; dy++) {
              for (let dx = 0; dx < scale; dx++) {
                addPixel(x + col * scale + dx, top + row * scale + dy, 255, 233, 176);
              }
            }
          }
        }
      }
    }
    x += advance;
  }
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

function build(): Buffer {
  paintBackground();
  paintStars();
  paintGalaxy();
  paintMatchstick();
  paintText('ONE SPARK', W / 2, 928, 8);
  return encodePNG();
}

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'entry.png'), build());
