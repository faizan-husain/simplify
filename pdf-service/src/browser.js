import puppeteer from 'puppeteer-core';
import fs from 'fs';

let browserInstance = null;
let isLaunching = false;
let launchPromise = null;

// Concurrency queue configuration
const MAX_CONCURRENT_RENDERS = parseInt(process.env.MAX_CONCURRENT || '3', 10);
let activeRenders = 0;
const queue = [];

function findChromiumExecutable() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  // Common platform paths
  const candidatePaths = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe` : null,
  ].filter(Boolean);

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return 'google-chrome-stable';
}

export async function getBrowser() {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }

  if (isLaunching) {
    return launchPromise;
  }

  isLaunching = true;
  launchPromise = (async () => {
    const executablePath = findChromiumExecutable();
    console.log(`[PDF Service] Launching headless Chromium via ${executablePath}...`);

    const browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-sync',
        '--disable-translate',
        '--hide-scrollbars',
        '--metrics-recording-only',
        '--mute-audio',
      ],
    });

    browser.on('disconnected', () => {
      console.warn('[PDF Service] Chromium browser disconnected. Cleaning up...');
      browserInstance = null;
    });

    browserInstance = browser;
    isLaunching = false;
    return browser;
  })();

  return launchPromise;
}

/**
 * Executes a render task under the concurrency limiter.
 */
function acquireLock() {
  return new Promise((resolve) => {
    if (activeRenders < MAX_CONCURRENT_RENDERS) {
      activeRenders++;
      resolve();
    } else {
      queue.push(resolve);
    }
  });
}

function releaseLock() {
  activeRenders--;
  if (queue.length > 0) {
    activeRenders++;
    const next = queue.shift();
    next();
  }
}

export function getActiveRenderCount() {
  return activeRenders;
}

/**
 * Renders full HTML string into a vector PDF buffer using headless Chromium.
 */
export async function renderHtmlToPdf(fullHtml, options = {}) {
  await acquireLock();
  let page = null;

  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    // 1. Disable JavaScript execution in the document (prevents execution of untrusted client scripts)
    await page.setJavaScriptEnabled(false);

    // 2. Strict SSRF Protection: Intercept and abort all outbound network requests except inline data: URLs
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      if (url.startsWith('data:')) {
        req.continue();
      } else {
        req.abort('blockedbyclient');
      }
    });

    // 3. Emulate print media
    await page.emulateMediaType('print');

    // 4. Load full HTML content (timeout 20s)
    await page.setContent(fullHtml, {
      waitUntil: 'load',
      timeout: 20000,
    });

    // 5. Await embedded fonts ready state
    try {
      await page.evaluate(async () => {
        if (document.fonts && typeof document.fonts.ready !== 'undefined') {
          await document.fonts.ready;
        }
      });
    } catch {
      // Ignore evaluation errors
    }

    // 6. Generate vector PDF matching exact @page CSS
    const pdfBuffer = await page.pdf({
      preferCSSPageSize: true,
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    return pdfBuffer;
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        // Ignore close errors
      }
    }
    releaseLock();
  }
}
