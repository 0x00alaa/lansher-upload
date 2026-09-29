// يولّد أيقونات التطبيق من صورة PNG واحدة إلى كل الأحجام التي يحتاجها
// Windows، ويبني ملف ICO-legal يحتوي نسخة PNG لكل مقاس.
//
// لماذا نكتب مُرمِّز PNG بأنفسنا: حتى تبقى خطوة البناء قابلة لإعادة الإنتاج
// بلا اعتماديات ثقيلة، وصورة PNG واحدة مع هذا السكربت تكفيان لكل الأحجام.
// التشغيل: node scripts/make-icons.mjs

import { deflateSync, inflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(here, "..", "src-tauri", "icons");
const sourcePath = join(iconsDir, "icon-source.png");

const SIZES = [16, 24, 32, 48, 64, 128, 256];

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
  ihdr[8] = 8; // عمق البت
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // نوع المرشّح: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) {
    throw new Error("الملف ليس PNG");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[9] !== 6) {
        throw new Error("ننتظر PNG بقناة alpha (RGBA)");
      }
    } else if (type === "IDAT") {
      idat.push(data);
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rgba = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const value = line[x];
      const left = x >= 4 ? rgba[y * stride + x - 4] : 0;
      const up = y > 0 ? rgba[(y - 1) * stride + x] : 0;
      let out;
      switch (filter) {
        case 0:
          out = value;
          break;
        case 1:
          out = value + left;
          break;
        case 2:
          out = value + up;
          break;
        case 3:
          out = value + ((left + up) >> 1);
          break;
        case 4: {
          const p = left + up - rgba[(y - 1) * stride + x - 4];
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - rgba[(y - 1) * stride + x - 4]);
          const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : rgba[(y - 1) * stride + x - 4];
          out = value + predictor;
          break;
        }
        default:
          throw new Error(`مرشّح PNG غير مدعوم: ${filter}`);
      }
      rgba[y * stride + x] = out & 0xff;
    }
  }
  return { width, height, rgba };
}

function resize(source, target) {
  const { width, height, rgba } = source;
  const out = Buffer.alloc(target * target * 4);
  for (let y = 0; y < target; y += 1) {
    for (let x = 0; x < target; x += 1) {
      const x0 = Math.floor((x * width) / target);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / target));
      const y0 = Math.floor((y * height) / target);
      const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / target));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const index = (sy * width + sx) * 4;
          const alpha = rgba[index + 3] / 255;
          r += rgba[index] * alpha;
          g += rgba[index + 1] * alpha;
          b += rgba[index + 2] * alpha;
          a += rgba[index + 3];
          n += 1;
        }
      }
      const outIndex = (y * target + x) * 4;
      if (a === 0) {
        out[outIndex] = 0;
        out[outIndex + 1] = 0;
        out[outIndex + 2] = 0;
        out[outIndex + 3] = 0;
        continue;
      }
      out[outIndex] = Math.round(r / n);
      out[outIndex + 1] = Math.round(g / n);
      out[outIndex + 2] = Math.round(b / n);
      out[outIndex + 3] = Math.round(a / n);
    }
  }
  return { width: target, height: target, rgba: out };
}

function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry[0] = image.size >= 256 ? 0 : image.size;
    entry[1] = image.size >= 256 ? 0 : image.size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += image.png.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

mkdirSync(iconsDir, { recursive: true });
const source = decodePng(readFileSync(sourcePath));
const images = SIZES.map((size) => ({ size, png: encodePng(size, size, resize(source, size).rgba) }));
for (const image of images) {
  writeFileSync(join(iconsDir, `${image.size}x${image.size}.png`), image.png);
}
writeFileSync(join(iconsDir, "128x128@2x.png"), images[images.length - 1].png);
writeFileSync(join(iconsDir, "icon.png"), images[images.length - 1].png);
writeFileSync(join(iconsDir, "icon.ico"), buildIco(images));
console.log(`كُتبت ${images.length} صورة + icon.ico في ${iconsDir}`);
