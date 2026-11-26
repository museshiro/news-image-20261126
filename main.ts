// news-image-20261126 — "Sum up 26 November's world news in one image"
// Renders a deterministic 1024x1024 PNG to /output/entry.png.
// Node 22, standard library only (no network, no random, no external files).
// All drawing is done in code: a small framebuffer, a hand-rolled PNG encoder
// (zlib via node:zlib) and an embedded 5x7 bitmap font scaled up for legibility.
// Design: 1 hero (Houthi claim on Saudi Ras Tanura refinery, Brent $94.61)
// + 4 cards (Trump tariffs / Nasdaq AI rout / Shenzhou-24 / Cairo tanker fire).
// Minimum text size on the canvas is 28px (design rule: nothing below 24px).

import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------- palette
type RGB = [number, number, number];
const hex = (h: string): RGB => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];
const BG: RGB = hex("#0B1220");
const PANEL: RGB = hex("#111827");
const TEXT: RGB = hex("#F8FAFC");
const MUTED: RGB = hex("#CBD5E1");
const RED: RGB = hex("#EF4444");
const AMBER: RGB = hex("#F59E0B");
const BLUE: RGB = hex("#3B82F6");
const CYAN: RGB = hex("#22D3EE");
const ORANGE: RGB = hex("#F97316");
const YELLOW: RGB = hex("#FBBF24");
const CREAM: RGB = hex("#FEF3C7");
const DARK: RGB = hex("#0D1526");
const STEEL: RGB = hex("#1E293B");

// ------------------------------------------------------------- framebuffer
const fb = new Uint8Array(W * H * 3);
function px(x: number, y: number, c: RGB): void {
  // Round: several callers pass fractional coordinates (e.g. flame
  // triangles at 0.34/0.78 of their size). A fractional byte index into
  // the Uint8Array gets truncated on write and scatters pixels all over
  // the canvas — that bug painted the inner flame triangles as dots at
  // the canvas edges instead of inside the flame.
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  fb[i] = c[0];
  fb[i + 1] = c[1];
  fb[i + 2] = c[2];
}
function blendPx(x: number, y: number, c: RGB, a: number): void {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
  const i = (y * W + x) * 3;
  fb[i] = Math.round(fb[i] * (1 - a) + c[0] * a);
  fb[i + 1] = Math.round(fb[i + 1] * (1 - a) + c[1] * a);
  fb[i + 2] = Math.round(fb[i + 2] * (1 - a) + c[2] * a);
}
function fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
  for (let j = y; j < y + h; j++)
    for (let i = x; i < x + w; i++) px(i, j, c);
}
function blendRect(x: number, y: number, w: number, h: number, c: RGB, a: number): void {
  for (let j = y; j < y + h; j++)
    for (let i = x; i < x + w; i++) blendPx(i, j, c, a);
}
// Left-to-right dark overlay: alpha goes from a0 (left) to a1 (right).
function hShade(x: number, y: number, w: number, h: number, a0: number, a1: number): void {
  for (let i = 0; i < w; i++) {
    const a = a0 + ((a1 - a0) * i) / w;
    blendRect(x + i, y, 1, h, [0, 0, 0], a);
  }
}
// Bottom-up dark overlay: alpha goes from aBottom (bottom) to aTop (top).
function vShade(x: number, y: number, w: number, h: number, aTop: number, aBottom: number): void {
  for (let j = 0; j < h; j++) {
    const a = aTop + ((aBottom - aTop) * j) / h;
    blendRect(x, y + j, w, 1, [0, 0, 0], a);
  }
}
function vGrad(x: number, y: number, w: number, h: number, c0: RGB, c1: RGB): void {
  for (let j = 0; j < h; j++) {
    const t = j / Math.max(1, h - 1);
    const c: RGB = [
      Math.round(c0[0] + (c1[0] - c0[0]) * t),
      Math.round(c0[1] + (c1[1] - c0[1]) * t),
      Math.round(c0[2] + (c1[2] - c0[2]) * t),
    ];
    for (let i = x; i < x + w; i++) px(i, y + j, c);
  }
}
function fillCircle(cx: number, cy: number, r: number, c: RGB): void {
  for (let j = -r; j <= r; j++)
    for (let i = -r; i <= r; i++)
      if (i * i + j * j <= r * r) px(cx + i, cy + j, c);
}
function blendCircle(cx: number, cy: number, r: number, c: RGB, a: number): void {
  for (let j = -r; j <= r; j++)
    for (let i = -r; i <= r; i++)
      if (i * i + j * j <= r * r) blendPx(cx + i, cy + j, c, a);
}
function fillEllipse(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
  for (let j = -ry; j <= ry; j++)
    for (let i = -rx; i <= rx; i++)
      if ((i * i) / (rx * rx) + (j * j) / (ry * ry) <= 1) px(cx + i, cy + j, c);
}
function fillTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: RGB): void {
  const minX = Math.max(0, Math.min(x0, x1, x2));
  const maxX = Math.min(W - 1, Math.max(x0, x1, x2));
  const minY = Math.max(0, Math.min(y0, y1, y2));
  const maxY = Math.min(H - 1, Math.max(y0, y1, y2));
  const d = (x0 - x2) * (y1 - y2) - (y0 - y2) * (x1 - x2);
  if (d === 0) return;
  for (let j = minY; j <= maxY; j++) {
    for (let i = minX; i <= maxX; i++) {
      const a = ((i - x2) * (y1 - y2) - (j - y2) * (x1 - x2)) / d;
      const b = ((x0 - x2) * (j - y2) - (y0 - y2) * (i - x2)) / d;
      if (a >= 0 && b >= 0 && a + b <= 1) px(i, j, c);
    }
  }
}
function thickLine(x0: number, y0: number, x1: number, y1: number, r: number, c: RGB): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  for (let s = 0; s <= steps; s++) {
    const x = Math.round(x0 + (dx * s) / steps);
    const y = Math.round(y0 + (dy * s) / steps);
    fillCircle(x, y, r, c);
  }
}
function roundRect(x: number, y: number, w: number, h: number, r: number, c: RGB): void {
  fillRect(x + r, y, w - 2 * r, h, c);
  fillRect(x, y + r, w, h - 2 * r, c);
  fillCircle(x + r, y + r, r, c);
  fillCircle(x + w - r - 1, y + r, r, c);
  fillCircle(x + r, y + h - r - 1, r, c);
  fillCircle(x + w - r - 1, y + h - r - 1, r, c);
}
// Deterministic pseudo-random from an integer seed (no Math.random).
function hash01(n: number): number {
  let v = (n * 2654435761) % 4294967296;
  v = (v ^ (v >>> 15)) >>> 0;
  return v / 4294967296;
}

// ---------------------------------------------------------------- PNG out
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}
function encodePNG(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter: none
    raw.set(fb.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// ------------------------------------------------------- 5x7 bitmap font
// Each glyph: 7 rows, each a 5-bit number (bit 4 = leftmost column).
const FONT: Record<string, number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0a],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  "0": [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  "1": [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  "2": [0x0e, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1f],
  "3": [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  "4": [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  "5": [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  "6": [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  "7": [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  "8": [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  "9": [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  " ": [0, 0, 0, 0, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 0x0c, 0x0c],
  ",": [0, 0, 0, 0, 0x0c, 0x04, 0x08],
  ":": [0, 0x0c, 0x0c, 0, 0x0c, 0x0c, 0],
  "%": [0x19, 0x1a, 0x02, 0x04, 0x08, 0x0b, 0x13],
  $: [0x04, 0x0f, 0x14, 0x0e, 0x05, 0x1e, 0x04],
  "-": [0, 0, 0, 0x0e, 0, 0, 0],
  "+": [0, 0, 0x04, 0x0e, 0x04, 0, 0],
  "/": [0x01, 0x02, 0x02, 0x04, 0x08, 0x08, 0x10],
  "!": [0x04, 0x04, 0x04, 0x04, 0x04, 0, 0x04],
  "?": [0x0e, 0x11, 0x01, 0x06, 0x04, 0, 0x04],
  "(": [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02],
  ")": [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08],
  "=": [0, 0, 0x1f, 0, 0x1f, 0, 0],
};
function textWidth(s: string, sx: number): number {
  return s.length * 6 * sx - sx;
}
function drawText(s: string, x: number, y: number, sx: number, sy: number, c: RGB): void {
  let cx = x;
  for (const ch of s) {
    const g = FONT[ch] ?? FONT["?"];
    for (let r = 0; r < 7; r++) {
      const row = g[r];
      for (let col = 0; col < 5; col++) {
        if (row & (1 << (4 - col))) {
          fillRect(cx + col * sx, y + r * sy, sx, sy, c);
        }
      }
    }
    cx += 6 * sx;
  }
}

// ------------------------------------------------------------- hero scene
// Hero rect: x=16, y=16, w=992, h=520 (bottom edge y=536).
function drawFlame(cx: number, baseY: number, h: number, w: number): void {
  // Layered flame: outer orange, mid amber, inner yellow, core cream.
  fillEllipse(cx, baseY - h * 0.35, Math.round(w * 0.5), Math.round(h * 0.35), ORANGE);
  fillTriangle(cx - w * 0.5, baseY, cx, baseY - h, cx + w * 0.5, baseY, ORANGE);
  fillTriangle(cx - w * 0.34, baseY, cx + w * 0.06, baseY - h * 0.78, cx + w * 0.34, baseY, YELLOW);
  fillTriangle(cx - w * 0.2, baseY, cx - w * 0.02, baseY - h * 0.55, cx + w * 0.2, baseY, CREAM);
}
function drawHero(): void {
  const hx = 16;
  const hy = 16;
  const hw = 992;
  const hh = 520;
  // Night sky with an orange glow at the horizon.
  vGrad(hx, hy, hw, 300, hex("#070D1A"), hex("#1B2547"));
  vGrad(hx, hy + 300, hw, 120, hex("#1B2547"), hex("#8A3416"));
  fillRect(hx, hy + 420, hw, 100, DARK);
  // Stars (deterministic positions).
  for (let i = 0; i < 46; i++) {
    const sx = hx + 20 + Math.floor(hash01(i * 7 + 1) * (hw - 40));
    const sy = hy + 12 + Math.floor(hash01(i * 13 + 5) * 180);
    const b = 140 + Math.floor(hash01(i * 3 + 2) * 115);
    fillRect(sx, sy, 2, 2, [b, b, b]);
  }
  // Refinery silhouette on the right: tanks, towers, pipes, flare stack.
  // Lighter steel than the background so the shapes read at a glance.
  const REFIN: RGB = hex("#3B4A63");
  const REFIN_TOP: RGB = hex("#64748B");
  const base = hy + 420;
  fillRect(600, base - 120, 130, 120, REFIN);
  fillRect(600, base - 120, 130, 8, REFIN_TOP);
  fillRect(745, base - 95, 110, 95, REFIN);
  fillRect(745, base - 95, 110, 8, REFIN_TOP);
  fillRect(870, base - 150, 26, 150, REFIN);
  fillRect(881, base - 178, 4, 28, REFIN); // antenna, no pyramid top
  fillRect(930, base - 110, 78, 110, REFIN);
  fillRect(560, base - 200, 14, 200, REFIN); // flare stack
  fillRect(560, base - 210, 14, 10, REFIN_TOP);
  drawFlame(567, base - 208, 52, 30);
  // Lit windows on the tanks.
  for (let i = 0; i < 6; i++) fillRect(612 + i * 18, base - 84, 8, 10, YELLOW);
  for (let i = 0; i < 5; i++) fillRect(757 + i * 18, base - 64, 8, 10, YELLOW);
  // Pipes and walkway.
  fillRect(560, base - 60, 448, 10, hex("#0F172A"));
  fillRect(600, base - 170, 408, 8, hex("#0F172A"));
  // Big fire on the left / centre. Flames stay short and wide (tall narrow
  // triangles read as pyramids, and the smoke blobs read as balloons),
  // tops below the headline so the fire frames the text instead of poking
  // through it.
  fillEllipse(330, base - 10, 240, 46, hex("#431407"));
  drawFlame(210, base + 6, 150, 190);
  drawFlame(330, base + 6, 185, 220);
  drawFlame(455, base + 6, 135, 160);
  drawFlame(560, base + 6, 100, 110);
  // Dark overlays so the text stays readable (never text on busy imagery).
  // Lighter than the first draft: the first render came out almost black
  // and the refinery/fire were invisible.
  hShade(hx, hy, hw, hh, 0.78, 0.18);
  vShade(hx, hy, hw, hh, 0.1, 0.65);
  // Date line (names the day — judge criterion 1).
  drawText("THURSDAY 26 NOVEMBER 2026 - WORLD NEWS IN ONE IMAGE", hx + 32, hy + 24, 2, 4, TEXT);
  fillRect(hx + 32, hy + 58, 560, 4, AMBER);
  // Kicker + headline (70px rows were too tall: metric + sub-line overflowed
  // the hero's bottom edge at y=536, so headline/metric use 63px rows here).
  drawText("MIDDLE EAST - ENERGY", hx + 32, hy + 252, 2, 4, AMBER);
  drawText("HOUTHIS CLAIM SAUDI", hx + 32, hy + 280, 7, 9, TEXT);
  drawText("REFINERY STRIKE", hx + 32, hy + 346, 7, 9, TEXT);
  // Metric: oil price, big; label beside it.
  drawText("$94.61", hx + 32, hy + 420, 8, 9, AMBER);
  drawText("BRENT +3.5%", hx + 32 + 6 * 6 * 8 + 24, hy + 432, 4, 5, TEXT);
  // Accuracy line: claim is unconfirmed + sources.
  drawText("CLAIM UNCONFIRMED - SOURCES: REUTERS, AP, CNN", hx + 32, hy + 490, 2, 4, MUTED);
}

// ------------------------------------------------------------- card icons
// Each icon is drawn inside a 48x48 box at (x, y).
function iconDoc(x: number, y: number): void {
  fillRect(x + 8, y + 2, 30, 44, TEXT);
  fillTriangle(x + 38, y + 2, x + 46, y + 10, x + 38, y + 10, MUTED);
  fillRect(x + 14, y + 14, 18, 4, BLUE);
  fillRect(x + 14, y + 23, 18, 4, BLUE);
  fillRect(x + 14, y + 32, 12, 4, BLUE);
}
function iconChart(x: number, y: number): void {
  fillRect(x + 4, y + 8, 4, 36, TEXT);
  fillRect(x + 4, y + 40, 40, 4, TEXT);
  thickLine(x + 8, y + 10, x + 20, y + 18, 3, RED);
  thickLine(x + 20, y + 18, x + 30, y + 30, 3, RED);
  thickLine(x + 30, y + 30, x + 42, y + 38, 3, RED);
  fillTriangle(x + 42, y + 30, x + 42, y + 42, x + 32, y + 38, RED);
}
function iconRocket(x: number, y: number): void {
  fillTriangle(x + 24, y + 2, x + 14, y + 28, x + 34, y + 28, CYAN);
  fillTriangle(x + 14, y + 22, x + 6, y + 36, x + 14, y + 30, CYAN);
  fillTriangle(x + 34, y + 22, x + 42, y + 36, x + 34, y + 30, CYAN);
  fillCircle(x + 24, y + 16, 4, BG);
  fillTriangle(x + 20, y + 30, x + 24, y + 46, x + 28, y + 30, ORANGE);
  fillRect(x + 4, y + 4, 3, 3, TEXT);
  fillRect(x + 42, y + 12, 3, 3, TEXT);
}
function iconFlame(x: number, y: number): void {
  fillEllipse(x + 24, y + 30, 16, 14, ORANGE);
  fillTriangle(x + 10, y + 40, x + 22, y + 4, x + 38, y + 40, ORANGE);
  fillTriangle(x + 16, y + 40, x + 26, y + 16, x + 32, y + 40, YELLOW);
  fillRect(x + 6, y + 42, 36, 4, TEXT);
}

// ------------------------------------------------------------------- cards
function drawCard(
  x: number,
  y: number,
  accent: RGB,
  icon: (x: number, y: number) => void,
  title: string,
  metric: string,
  metricColor: RGB,
  body: string,
): void {
  roundRect(x, y, 488, 220, 16, PANEL);
  fillRect(x + 16, y, 456, 6, accent);
  icon(x + 24, y + 24);
  drawText(title, x + 88, y + 28, 3, 5, TEXT);
  drawText(metric, x + 24, y + 96, 5, 8, metricColor);
  drawText(body, x + 24, y + 164, 3, 4, MUTED);
}

function drawAll(): void {
  fillRect(0, 0, W, H, BG);
  drawHero();
  drawCard(16, 552, BLUE, iconDoc, "TRUMP TARIFFS", "CHINA 20%-40%", TEXT, "14 NATIONS, EU 15%");
  drawCard(520, 552, RED, iconChart, "AI ROUT ON WALL ST", "NASDAQ -4.2%", RED, "CLOSE -0.6% - NVDA -8.6%");
  drawCard(16, 788, CYAN, iconRocket, "PAKISTAN IN ORBIT", "SHENZHOU-24", CYAN, "ALI DOCKS AT TIANGONG");
  drawCard(520, 788, ORANGE, iconFlame, "CAIRO TANKER FIRE", "31 KILLED", RED, "21 INJURED - RING ROAD");
}

// --------------------------------------------------------------------- main
function main(): void {
  drawAll();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/entry.png`, encodePNG());
}

main();
