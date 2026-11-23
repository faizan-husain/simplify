const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

// Simple CRC32 implementation
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) c = 0xedb88320 ^ (c >>> 1);
    else c = c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function decodePNG(buf) {
  let pos = 8;
  const idat = [];
  let width, height;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    if (type === 'IHDR') {
      width = buf.readUInt32BE(pos + 8);
      height = buf.readUInt32BE(pos + 12);
    } else if (type === 'IDAT') {
      idat.push(buf.slice(pos + 8, pos + 8 + len));
    }
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = 1 + width * bpp;
  const out = Buffer.alloc(width * height * 4);
  let prevRow = Buffer.alloc(width * bpp);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * stride];
    const row = Buffer.alloc(width * bpp);
    for (let x = 0; x < width * bpp; x++) {
      const rawVal = raw[y * stride + 1 + x];
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = prevRow[x];
      const c = x >= bpp ? prevRow[x - bpp] : 0;
      let val = rawVal;
      if (filter === 1) val = (rawVal + a) & 0xff;
      else if (filter === 2) val = (rawVal + b) & 0xff;
      else if (filter === 3) val = (rawVal + Math.floor((a + b) / 2)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
        val = (rawVal + pr) & 0xff;
      }
      row[x] = val;
      out[(y * width + Math.floor(x / 4)) * 4 + (x % 4)] = val;
    }
    prevRow = row;
  }
  return { width, height, pixels: out };
}

function encodePNG(width, height, rgbaBuffer) {
  const bpp = 4;
  const rawScanlines = Buffer.alloc(height * (1 + width * bpp));
  for (let y = 0; y < height; y++) {
    const rawOffset = y * (1 + width * bpp);
    rawScanlines[rawOffset] = 0; // Filter 0 (None)
    rgbaBuffer.copy(rawScanlines, rawOffset + 1, y * width * bpp, (y + 1) * width * bpp);
  }

  const compressed = zlib.deflateSync(rawScanlines, { level: 9 });

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // 8 bits per channel
  ihdrData[9] = 6; // RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const ihdrChunk = makeChunk('IHDR', ihdrData);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(12 + len);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const typeAndData = chunk.slice(4, 8 + len);
  chunk.writeUInt32BE(crc32(typeAndData), 8 + len);
  return chunk;
}

// 1. Read the user uploaded screenshot to extract the calligraphy S logo
const srcPath = 'C:/Users/Dell/.gemini/antigravity/brain/9e099f40-0e48-4c69-9073-925e8850f59b/.user_uploaded/media_1795413803895_09e64100.png';
const srcImg = decodePNG(fs.readFileSync(srcPath));

// Logo bounds inside userImg:
const minX = 72, maxX = 204, minY = 93, maxY = 226;
const logoW = maxX - minX + 1; // 133
const logoH = maxY - minY + 1; // 134

// Extract logo alpha mask (0 = white/background, 1 = solid black logo)
const logoAlpha = new Float32Array(logoW * logoH);
for (let y = 0; y < logoH; y++) {
  for (let x = 0; x < logoW; x++) {
    const srcX = minX + x;
    const srcY = minY + y;
    const idx = (srcY * srcImg.width + srcX) * 4;
    const r = srcImg.pixels[idx];
    const g = srcImg.pixels[idx + 1];
    const b = srcImg.pixels[idx + 2];
    const brightness = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
    // Darkness: 1 = pure black, 0 = pure white
    const dark = Math.max(0, Math.min(1, (0.94 - brightness) / 0.85));
    logoAlpha[y * logoW + x] = dark;
  }
}

// Function to render icon onto solid white canvas of size targetSize x targetSize
function renderIcon(targetSize, scaleRatio = 0.68) {
  const buf = Buffer.alloc(targetSize * targetSize * 4);
  // Fill 100% with solid pure white #FFFFFF
  buf.fill(255);

  const destW = targetSize * scaleRatio;
  const destH = targetSize * scaleRatio * (logoH / logoW);
  const startX = (targetSize - destW) / 2;
  const startY = (targetSize - destH) / 2;

  for (let dy = 0; dy < targetSize; dy++) {
    for (let dx = 0; dx < targetSize; dx++) {
      const lx = ((dx - startX) / destW) * logoW;
      const ly = ((dy - startY) / destH) * logoH;

      if (lx >= 0 && lx < logoW - 1 && ly >= 0 && ly < logoH - 1) {
        const x0 = Math.floor(lx);
        const y0 = Math.floor(ly);
        const fx = lx - x0;
        const fy = ly - y0;

        const a00 = logoAlpha[y0 * logoW + x0];
        const a10 = logoAlpha[y0 * logoW + x0 + 1];
        const a01 = logoAlpha[(y0 + 1) * logoW + x0];
        const a11 = logoAlpha[(y0 + 1) * logoW + x0 + 1];

        // Bilinear interpolation
        const darkVal = (a00 * (1 - fx) + a10 * fx) * (1 - fy) + (a01 * (1 - fx) + a11 * fx) * fy;

        if (darkVal > 0) {
          const colorByte = Math.round(255 * (1 - darkVal * 0.98));
          const idx = (dy * targetSize + dx) * 4;
          buf[idx] = colorByte;     // R
          buf[idx + 1] = colorByte; // G
          buf[idx + 2] = colorByte; // B
          buf[idx + 3] = 255;       // A (100% solid, NEVER transparent)
        }
      }
    }
  }

  return encodePNG(targetSize, targetSize, buf);
}

// Generate the icons
const outDir = path.resolve(__dirname, '../frontend/public');

// 1. pwa-512x512.png (solid white background, clean safe margin)
const pwa512 = renderIcon(512, 0.68);
fs.writeFileSync(path.join(outDir, 'pwa-512x512.png'), pwa512);

// 2. pwa-maskable-512x512.png (solid white edge-to-edge, safe zone = 60% scale so Android never cuts it)
const pwaMaskable = renderIcon(512, 0.60);
fs.writeFileSync(path.join(outDir, 'pwa-maskable-512x512.png'), pwaMaskable);

// 3. pwa-192x192.png (solid white)
const pwa192 = renderIcon(192, 0.68);
fs.writeFileSync(path.join(outDir, 'pwa-192x192.png'), pwa192);

// 4. apple-touch-icon.png (180x180, solid white)
const appleIcon = renderIcon(180, 0.68);
fs.writeFileSync(path.join(outDir, 'apple-touch-icon.png'), appleIcon);

// 5. favicon.png (48x48)
const fav48 = renderIcon(48, 0.72);
fs.writeFileSync(path.join(outDir, 'favicon.png'), fav48);

// 6. simplify-icon.png (512x512, solid white edge-to-edge)
const simplifyIcon = renderIcon(512, 0.68);
fs.writeFileSync(path.join(outDir, 'simplify-icon.png'), simplifyIcon);

console.log('✅ Generated all icons including simplify-icon.png with 100% solid white edge-to-edge background, NO strokes, NO black borders!');
