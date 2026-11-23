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

function encodeICO(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // 1 = ICO
  header.writeUInt16LE(count, 4);

  const dirSize = 16 * count;
  let currentOffset = 6 + dirSize;

  const dirBuffers = [];
  const imageBuffers = [];

  for (const img of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(img.width >= 256 ? 0 : img.width, 0);
    entry.writeUInt8(img.height >= 256 ? 0 : img.height, 1);
    entry.writeUInt8(0, 2); // Palette
    entry.writeUInt8(0, 3); // Reserved
    entry.writeUInt16LE(1, 4); // Planes
    entry.writeUInt16LE(32, 6); // Bits per pixel
    entry.writeUInt32LE(img.data.length, 8); // Size
    entry.writeUInt32LE(currentOffset, 12); // Offset

    dirBuffers.push(entry);
    imageBuffers.push(img.data);
    currentOffset += img.data.length;
  }

  return Buffer.concat([header, ...dirBuffers, ...imageBuffers]);
}

// 1. Read the user uploaded squircle/rounded icon master
const masterPath = path.resolve(__dirname, 'assets/app-icon-squircle.png');
const master = decodePNG(fs.readFileSync(masterPath));

// Clean master: pure white #FFFFFF for background inside card, transparent for outer corners
for (let y = 0; y < master.height; y++) {
  for (let x = 0; x < master.width; x++) {
    const idx = (y * master.width + x) * 4;
    const a = master.pixels[idx + 3];
    const r = master.pixels[idx];
    const g = master.pixels[idx + 1];
    const b = master.pixels[idx + 2];
    if (a > 180 && r > 210 && g > 210 && b > 210) {
      master.pixels[idx] = 255;
      master.pixels[idx + 1] = 255;
      master.pixels[idx + 2] = 255;
    }
    if (a < 8) {
      master.pixels[idx + 3] = 0;
    }
  }
}

// Extract logo alpha mask for transparent splash screen mark
const minX = 52, maxX = 282, minY = 44, maxY = 278;
const logoW = maxX - minX + 1;
const logoH = maxY - minY + 1;
const logoAlpha = new Float32Array(logoW * logoH);
for (let y = 0; y < logoH; y++) {
  for (let x = 0; x < logoW; x++) {
    const srcX = minX + x;
    const srcY = minY + y;
    const idx = (srcY * master.width + srcX) * 4;
    const r = master.pixels[idx];
    const g = master.pixels[idx + 1];
    const b = master.pixels[idx + 2];
    const a = master.pixels[idx + 3];
    const brightness = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
    const dark = a > 100 ? Math.max(0, Math.min(1, (0.94 - brightness) / 0.85)) : 0;
    logoAlpha[y * logoW + x] = dark;
  }
}

// Render transparent floating logo for splash screen (simplify-mark.png)
function renderTransparentMark(targetSize, scaleRatio = 0.60) {
  const buf = Buffer.alloc(targetSize * targetSize * 4);
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

        const darkVal = (a00 * (1 - fx) + a10 * fx) * (1 - fy) + (a01 * (1 - fx) + a11 * fx) * fy;

        if (darkVal > 0.02) {
          const idx = (dy * targetSize + dx) * 4;
          buf[idx] = 17;      // #111827 R
          buf[idx + 1] = 24;  // G
          buf[idx + 2] = 39;  // B
          buf[idx + 3] = Math.round(255 * Math.min(1, darkVal * 1.05));
        }
      }
    }
  }

  return encodePNG(targetSize, targetSize, buf);
}

// Resample master rounded-card icon to any targetSize with smooth anti-aliased border radius
function resampleRoundedIcon(targetSize) {
  const out = Buffer.alloc(targetSize * targetSize * 4);

  if (targetSize <= master.width) {
    // Area averaging for ultra-crisp downsampling (16, 32, 48, 180, 192)
    const scale = master.width / targetSize;
    for (let ty = 0; ty < targetSize; ty++) {
      const sy0 = ty * scale;
      const sy1 = (ty + 1) * scale;
      const startY = Math.floor(sy0);
      const endY = Math.min(master.height, Math.ceil(sy1));

      for (let tx = 0; tx < targetSize; tx++) {
        const sx0 = tx * scale;
        const sx1 = (tx + 1) * scale;
        const startX = Math.floor(sx0);
        const endX = Math.min(master.width, Math.ceil(sx1));

        let totalWeight = 0;
        let rSum = 0, gSum = 0, bSum = 0, aSum = 0;

        for (let sy = startY; sy < endY; sy++) {
          const yWeight = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
          for (let sx = startX; sx < endX; sx++) {
            const xWeight = Math.min(sx + 1, sx1) - Math.max(sx, sx0);
            const weight = xWeight * yWeight;
            const idx = (sy * master.width + sx) * 4;

            let a = master.pixels[idx + 3] / 255;
            let r = master.pixels[idx];
            let g = master.pixels[idx + 1];
            let b = master.pixels[idx + 2];

            if (a > 0.7 && r > 200 && g > 200 && b > 200) {
              r = 255; g = 255; b = 255;
            }

            rSum += r * a * weight;
            gSum += g * a * weight;
            bSum += b * a * weight;
            aSum += a * weight;
            totalWeight += weight;
          }
        }

        const outIdx = (ty * targetSize + tx) * 4;
        if (totalWeight > 0 && aSum > 0) {
          const finalA = aSum / totalWeight;
          const finalR = (rSum / aSum);
          const finalG = (gSum / aSum);
          const finalB = (bSum / aSum);
          out[outIdx] = Math.round(Math.min(255, Math.max(0, finalR)));
          out[outIdx + 1] = Math.round(Math.min(255, Math.max(0, finalG)));
          out[outIdx + 2] = Math.round(Math.min(255, Math.max(0, finalB)));
          out[outIdx + 3] = Math.round(Math.min(255, Math.max(0, finalA * 255)));
        }
      }
    }
  } else {
    // Bilinear for upsampling (512x512)
    const scaleX = (master.width - 1) / (targetSize - 1);
    const scaleY = (master.height - 1) / (targetSize - 1);

    for (let ty = 0; ty < targetSize; ty++) {
      const srcY = ty * scaleY;
      const y0 = Math.floor(srcY);
      const y1 = Math.min(master.height - 1, y0 + 1);
      const fy = srcY - y0;

      for (let tx = 0; tx < targetSize; tx++) {
        const srcX = tx * scaleX;
        const x0 = Math.floor(srcX);
        const x1 = Math.min(master.width - 1, x0 + 1);
        const fx = srcX - x0;

        const idx00 = (y0 * master.width + x0) * 4;
        const idx10 = (y0 * master.width + x1) * 4;
        const idx01 = (y1 * master.width + x0) * 4;
        const idx11 = (y1 * master.width + x1) * 4;

        const outIdx = (ty * targetSize + tx) * 4;
        for (let c = 0; c < 4; c++) {
          let v00 = master.pixels[idx00 + c];
          let v10 = master.pixels[idx10 + c];
          let v01 = master.pixels[idx01 + c];
          let v11 = master.pixels[idx11 + c];

          if (c < 3) {
            if (master.pixels[idx00 + 3] > 180 && v00 > 200) v00 = 255;
            if (master.pixels[idx10 + 3] > 180 && v10 > 200) v10 = 255;
            if (master.pixels[idx01 + 3] > 180 && v01 > 200) v01 = 255;
            if (master.pixels[idx11 + 3] > 180 && v11 > 200) v11 = 255;
          }

          const val = (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
          out[outIdx + c] = Math.round(val);
        }
      }
    }
  }

  return encodePNG(targetSize, targetSize, out);
}

// Generate the icons
const outDir = path.resolve(__dirname, '../frontend/public');

// 1. pwa-512x512.png (rounded border-radius card with transparent corners)
const pwa512 = resampleRoundedIcon(512);
fs.writeFileSync(path.join(outDir, 'pwa-512x512.png'), pwa512);

// 2. pwa-maskable-512x512.png
fs.writeFileSync(path.join(outDir, 'pwa-maskable-512x512.png'), pwa512);

// 3. pwa-192x192.png (rounded border-radius card)
const pwa192 = resampleRoundedIcon(192);
fs.writeFileSync(path.join(outDir, 'pwa-192x192.png'), pwa192);

// 4. apple-touch-icon.png (180x180, rounded border-radius card)
const appleIcon = resampleRoundedIcon(180);
fs.writeFileSync(path.join(outDir, 'apple-touch-icon.png'), appleIcon);

// 5. favicon.png (48x48, rounded border-radius card)
const fav48 = resampleRoundedIcon(48);
fs.writeFileSync(path.join(outDir, 'favicon.png'), fav48);

// 6. simplify-icon.png (512x512, rounded border-radius card)
fs.writeFileSync(path.join(outDir, 'simplify-icon.png'), pwa512);

// 6b. simplify-mark.png (192x192, 100% TRANSPARENT background with pure crisp charcoal calligraphy S)
const simplifyMark = renderTransparentMark(192, 0.60);
fs.writeFileSync(path.join(outDir, 'simplify-mark.png'), simplifyMark);

// 7. favicon.ico containing 16x16, 32x32, 48x48 (all with rounded border-radius card)
const fav16 = resampleRoundedIcon(16);
const fav32 = resampleRoundedIcon(32);
const favICO = encodeICO([
  { width: 16, height: 16, data: fav16 },
  { width: 32, height: 32, data: fav32 },
  { width: 48, height: 48, data: fav48 },
]);
fs.writeFileSync(path.join(outDir, 'favicon.ico'), favICO);

// 8. favicon.svg (SVG format with embedded high-res rounded card)
const base64Png = pwa512.toString('base64');
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <image href="data:image/png;base64,${base64Png}" width="512" height="512"/>
</svg>\n`;
fs.writeFileSync(path.join(outDir, 'favicon.svg'), svgContent, 'utf8');

console.log('✅ Generated all icons (favicon.ico, favicon.svg, favicon.png, pwa-192, pwa-512, apple-touch-icon) with smooth BORDER RADIUS!');
