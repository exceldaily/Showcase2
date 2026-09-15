// Generates the PWA icons without any image library: a rounded brand
// square with the AlphaForge pulse line, encoded as PNG by hand.
// Usage: node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BG = [79, 140, 255];      // brand
const INK = [255, 255, 255];    // pulse line
const DEEP = [7, 11, 19];       // maskable backdrop

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// Distance from point to segment, for a smooth thick polyline.
function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay, wx = px - ax, wy = py - ay;
  const t = Math.max(0, Math.min(1, (vx * wx + vy * wy) / (vx * vx + vy * vy || 1)));
  const dx = px - (ax + t * vx), dy = py - (ay + t * vy);
  return Math.hypot(dx, dy);
}

function icon(size, maskable) {
  // Pulse: flat, up spike, down spike, flat (like the lucide "activity" mark)
  const pts = [[0.14, 0.5], [0.34, 0.5], [0.44, 0.24], [0.58, 0.76], [0.68, 0.5], [0.86, 0.5]].map(([x, y]) => [x * size, y * size]);
  const stroke = size * 0.085;
  const pad = maskable ? size * 0.1 : 0;          // maskable: keep the mark inside the safe zone
  const radius = maskable ? 0 : size * 0.22;      // maskable icons are square, the OS masks them
  return png(size, (x, y) => {
    // rounded-square background
    const inX = x >= pad && x < size - pad, inY = y >= pad && y < size - pad;
    let bg = maskable ? DEEP : [0, 0, 0];
    let alpha = maskable ? 255 : 0;
    if (inX && inY) {
      const cx = Math.max(pad + radius, Math.min(size - pad - radius, x + 0.5));
      const cy = Math.max(pad + radius, Math.min(size - pad - radius, y + 0.5));
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const cover = radius === 0 ? 1 : Math.max(0, Math.min(1, radius - d + 0.5));
      if (cover > 0) { bg = BG; alpha = Math.round(255 * cover); }
    }
    // pulse line on top
    let dmin = Infinity;
    for (let i = 0; i < pts.length - 1; i++) dmin = Math.min(dmin, segDist(x + 0.5, y + 0.5, pts[i][0] * (1 - pad * 2 / size) + pad, pts[i][1] * (1 - pad * 2 / size) + pad, pts[i + 1][0] * (1 - pad * 2 / size) + pad, pts[i + 1][1] * (1 - pad * 2 / size) + pad));
    const line = Math.max(0, Math.min(1, stroke / 2 - dmin + 0.5));
    if (line > 0) {
      const a = alpha / 255;
      const r = Math.round(INK[0] * line + bg[0] * (1 - line));
      const g = Math.round(INK[1] * line + bg[1] * (1 - line));
      const b = Math.round(INK[2] * line + bg[2] * (1 - line));
      return [r, g, b, Math.round(255 * Math.max(a, line))];
    }
    return [bg[0], bg[1], bg[2], alpha];
  });
}

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", icon(192, false));
writeFileSync("public/icons/icon-512.png", icon(512, false));
writeFileSync("public/icons/icon-512-maskable.png", icon(512, true));
writeFileSync("public/icons/apple-touch-icon.png", icon(180, true));
console.log("icons written");
