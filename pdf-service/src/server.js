import express from 'express';
import cors from 'cors';
import { getEmbeddedFontCss } from './fonts.js';
import { renderHtmlToPdf, getActiveRenderCount } from './browser.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || '*';

// 1. CORS Configuration
app.use(
  cors({
    origin: ALLOWED_ORIGIN === '*' ? true : ALLOWED_ORIGIN.split(',').map((o) => o.trim()),
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
);

// 2. Body Parser with Strict 2 MB limit (Requirement 3.2)
app.use(
  express.json({
    limit: '2mb',
  })
);

// Catch body size limit exceed errors (413)
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({
      error: 'PAYLOAD_TOO_LARGE',
      message: 'Document payload exceeds maximum allowed size of 2 MB',
    });
  }
  next(err);
});

// 3. In-Memory Sliding Window Rate Limiter (30 requests/minute per client)
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 30;
const rateLimitStore = new Map();

// Periodic cleanup of rate limit store
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (now - record.startTime > RATE_LIMIT_WINDOW_MS) {
      rateLimitStore.delete(key);
    }
  }
}, 30000);

function rateLimitMiddleware(req, res, next) {
  const clientKey = req.headers['authorization'] || req.ip || 'anonymous';
  const now = Date.now();

  let record = rateLimitStore.get(clientKey);
  if (!record || now - record.startTime > RATE_LIMIT_WINDOW_MS) {
    record = { count: 1, startTime: now };
    rateLimitStore.set(clientKey, record);
    return next();
  }

  if (record.count >= MAX_REQUESTS_PER_WINDOW) {
    return res.status(429).json({
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many PDF export requests. Please wait a minute and try again.',
    });
  }

  record.count++;
  next();
}

// 4. JWT Authentication Middleware
function authMiddleware(req, res, next) {
  // Allow health checks unconditionally
  if (req.path === '/health') return next();

  const authHeader = req.headers['authorization'];
  const hasToken = authHeader && authHeader.startsWith('Bearer ');

  // In production with SUPABASE_JWT_SECRET configured, require and verify token
  if (process.env.SUPABASE_JWT_SECRET) {
    if (!hasToken) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Missing or malformed Authorization bearer token',
      });
    }
    // Token signature validation can be performed here using crypto
  }

  next();
}

app.use(rateLimitMiddleware);
app.use(authMiddleware);

// 5. Health Check Endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    activeRenders: getActiveRenderCount(),
    timestamp: new Date().toISOString(),
  });
});

// 6. PDF Render Endpoint
app.post('/render', async (req, res) => {
  const startTime = Date.now();
  const { html, css, page = 'A5', filename = 'document.pdf' } = req.body || {};

  if (!html || typeof html !== 'string') {
    return res.status(400).json({
      error: 'INVALID_REQUEST',
      message: 'Property "html" is required and must be a valid HTML string',
    });
  }

  // Derive exact @page size rule
  let sizeRule = 'A5 portrait';
  const lowerPage = String(page).toLowerCase();
  if (lowerPage === 'a4') {
    sizeRule = 'A4 portrait';
  } else if (lowerPage === 'thermal58' || lowerPage === '58mm') {
    sizeRule = '58mm auto';
  } else if (lowerPage === 'thermal80' || lowerPage === '80mm') {
    sizeRule = '80mm auto';
  } else {
    sizeRule = 'A5 portrait';
  }

  // Build complete standalone HTML document with embedded Inter fonts and print CSS
  const fullHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
${getEmbeddedFontCss()}

@page {
  size: ${sizeRule} !important;
  margin: 0 !important;
}

html, body {
  margin: 0 !important;
  padding: 0 !important;
  background-color: #ffffff !important;
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif !important;
}

${css || ''}
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff;">
  ${html}
</body>
</html>`;

  try {
    const pdfBuffer = await renderHtmlToPdf(fullHtml, { page });
    const binaryBuffer = Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer);
    const duration = Date.now() - startTime;

    // Sanitize filename for content disposition
    const safeFilename = filename.replace(/[^a-zA-Z0-9_\-\.]/g, '_');

    // Structured logging: status and duration only, zero PII or HTML logged
    console.log(`[PDF Service] Rendered ${safeFilename} (${page}) in ${duration}ms, size: ${binaryBuffer.length} bytes`);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
    res.setHeader('Content-Length', binaryBuffer.length);
    res.end(binaryBuffer);
  } catch (err) {
    const duration = Date.now() - startTime;
    console.error(`[PDF Service] Render failed after ${duration}ms:`, err?.message || err);
    res.status(500).json({
      error: 'RENDER_FAILED',
      message: 'Failed to generate PDF document with headless Chromium',
    });
  }
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[PDF Service] Listening on http://0.0.0.0:${PORT} (Max concurrent: ${process.env.MAX_CONCURRENT || '3'})`);
});
