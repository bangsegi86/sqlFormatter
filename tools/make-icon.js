/* 앱 아이콘 만들기 (외부 패키지 없이 Node 기본 기능만 사용)
 *   node tools/make-icon.js
 * → src/assets/icon.png (256px, 창 아이콘)
 *   src/assets/icon.ico (16~256px, exe · 작업표시줄 아이콘)
 *
 * 모양: 파란 둥근 사각형 위에 흰 줄 3개 (정리된 SQL 을 뜻해요. 가운데 줄은 들여쓰기)
 * 32x32 좌표계로 그려요. 화면 왼쪽 위 로고(index.html)와 같은 모양이에요.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BG_TOP = [0x5b, 0x9b, 0xff], BG_BOTTOM = [0x3a, 0x72, 0xe8], FG = [0xff, 0xff, 0xff];
const RADIUS = 8, LINE_W = 3;
const LINES = [[8, 10.5, 24, 10.5], [12.5, 16, 21.5, 16], [8, 21.5, 20, 21.5]];

function inRoundRect(x, y) {
  const r = RADIUS, cx = Math.min(Math.max(x, r), 32 - r), cy = Math.min(Math.max(y, r), 32 - r);
  return x >= 0 && y >= 0 && x <= 32 && y <= 32 && (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
function onLine(x, y) {
  return LINES.some(([x1, y1, x2]) => {
    const px = Math.min(Math.max(x, x1), x2);
    return (x - px) ** 2 + (y - y1) ** 2 <= (LINE_W / 2) ** 2;
  });
}
// 작은 크기에서는 선을 조금 굵게 해서 뭉개지지 않게 해요
function render(size) {
  const ss = 8, px = Buffer.alloc(size * size * 4), lw = LINE_W;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    let a = 0, f = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const x = (i + (sx + 0.5) / ss) * 32 / size, y = (j + (sy + 0.5) / ss) * 32 / size;
      if (!inRoundRect(x, y)) continue;
      a++;
      if (onLine(x, y)) f++;
    }
    const n = ss * ss, t = j / (size - 1 || 1), o = (j * size + i) * 4;
    const bg = BG_TOP.map((c, k) => c + (BG_BOTTOM[k] - c) * t);
    const fr = a ? f / a : 0;
    for (let k = 0; k < 3; k++) px[o + k] = Math.round(bg[k] * (1 - fr) + FG[k] * fr);
    px[o + 3] = Math.round(255 * a / n);
  }
  return px;
}

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
function png(size) {
  const raw = render(size), rows = [];
  for (let j = 0; j < size; j++) rows.push(Buffer.from([0]), raw.subarray(j * size * 4, (j + 1) * size * 4));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
}
function ico(sizes) {
  const imgs = sizes.map(png);
  const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let off = 6 + 16 * sizes.length;
  const dir = sizes.map((s, i) => {
    const e = Buffer.alloc(16);
    e[0] = s >= 256 ? 0 : s; e[1] = s >= 256 ? 0 : s; e[2] = 0; e[3] = 0;
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(imgs[i].length, 8); e.writeUInt32LE(off, 12);
    off += imgs[i].length;
    return e;
  });
  return Buffer.concat([head].concat(dir, imgs));
}

const out = path.join(__dirname, '..', 'src', 'assets');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon.png'), png(256));
fs.writeFileSync(path.join(out, 'icon.ico'), ico([16, 20, 24, 32, 40, 48, 64, 128, 256]));
console.log('아이콘을 만들었어요:', path.join(out, 'icon.png'), path.join(out, 'icon.ico'));
