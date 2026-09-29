// يولّد الصورة المصدر `icon-source.png` من الرسم الهندسي، فلا نحتاج ملفاً
// ثنائياً في المستودع. الرسم: خلفية داكنة، حرف L نظيف، وثلاث نقاط إشارات.
// التشغيل: node scripts/make-source-icon.mjs

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(here, "..", "src-tauri", "icons");
const SIZE = 512;

const BG = [14, 17, 22, 255];
const ACCENT = [47, 129, 247, 255];
const SIGNAL = [63, 185, 80, 255];

function createCanvas() {
  return { data: Buffer.alloc(SIZE * SIZE * 4) };
}

function setPixel(canvas, x, y, color) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) {
    return;
  }
  const index = (y * SIZE + x) * 4;
  const alpha = color[3] / 255;
  canvas.data[index] = Math.round(canvas.data[index] * (1 - alpha) + color[0] * alpha);
  canvas.data[index + 1] = Math.round(canvas.data[index + 1] * (1 - alpha) + color[1] * alpha);
  canvas.data[index + 2] = Math.round(canvas.data[index + 2] * (1 - alpha) + color[2] * alpha);
  canvas.data[index + 3] = Math.min(255, canvas.data[index + 3] + color[3]);
}

function fillRoundedRect(canvas, x0, y0, x1, y1, radius, color) {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const dx = Math.max(x0 + radius - x, 0, x - (x1 - 1 - radius));
      const dy = Math.max(y0 + radius - y, 0, y - (y1 - 1 - radius));
      if (dx * dx + dy * dy <= radius * radius) {
        setPixel(canvas, x, y, color);
      }
    }
  }
}

function fillRect(canvas, x0, y0, x1, y1, color) {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      setPixel(canvas, x, y, color);
    }
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const canvas = createCanvas();
fillRoundedRect(canvas, 16, 16, SIZE - 16, SIZE - 16, 96, ACCENT);
fillRoundedRect(canvas, 40, 40, SIZE - 40, SIZE - 40, 72, BG);

// حرف L: عمود رأسي وقاعدة.
fillRect(canvas, 150, 150, 196, 350, ACCENT);
fillRect(canvas, 150, 306, 316, 350, ACCENT);

// نقاط إشارة تصاعدية.
const bars = [
  { x: 224, y: 320, h: 30, color: SIGNAL },
  { x: 268, y: 286, h: 64, color: SIGNAL },
  { x: 312, y: 250, h: 100, color: ACCENT },
];
for (const bar of bars) {
  fillRoundedRect(canvas, bar.x, bar.y - bar.h, bar.x + 32, bar.y, 10, bar.color);
}

mkdirSync(iconsDir, { recursive: true });
writeFileSync(join(iconsDir, "icon-source.png"), encodePng(SIZE, SIZE, canvas.data));
console.log(`كُتبت icon-source.png (${SIZE}×${SIZE})`);
