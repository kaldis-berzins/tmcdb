const fs = require('fs/promises');
const path = require('path');
const { chromium } = require('playwright');

function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickOriginalLanguage(entry) {
  const originals = Array.isArray(entry.languagesOriginal) ? entry.languagesOriginal : [];
  if (!originals.length) return null;

  // Prefer English if present
  return (
    originals.find(lang =>
      (lang.code || '').toLowerCase() === 'en' ||
      /english/i.test(lang.label || '')
    ) || originals[0]
  );
}

function getExtensionFromUrl(url) {
  try {
    const ext = path.extname(new URL(url).pathname);
    return ext || '.pdf';
  } catch {
    return '.pdf';
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function downloadFile(context, url, filePath) {
  const page = await context.newPage();

  try {
    // Start listening for a browser download
    const downloadPromise = page
      .waitForEvent('download', { timeout: 5000 })
      .catch(() => null);

    let response = null;

    try {
      response = await page.goto(url, {
        waitUntil: 'commit',
        timeout: 120000,
      });
    } catch (err) {
      // This is expected for direct file downloads
      if (!String(err.message).includes('Download is starting')) {
        throw err;
      }
    }

    const download = await downloadPromise;

    if (download) {
      await download.saveAs(filePath);
      return;
    }

    if (response && response.ok()) {
      const buffer = await response.body();
      await fs.writeFile(filePath, buffer);
      return;
    }

    throw new Error('Neither a download event nor a valid response was received');
  } finally {
    await page.close().catch(() => {});
  }
}

async function downloadWithRetry(context, url, filePath, attempts = 4) {
  let lastErr;

  for (let i = 1; i <= attempts; i++) {
    try {
      await downloadFile(context, url, filePath);
      return;
    } catch (err) {
      lastErr = err;

      const message = String(err.message || err);
      const retryable =
        message.includes('ECONNRESET') ||
        message.includes('net::ERR_CONNECTION_RESET') ||
        message.includes('net::ERR_ABORTED') ||
        message.includes('Timeout') ||
        message.includes('timeout') ||
        message.includes('Download is starting');

      if (i < attempts && retryable) {
        const delay = 1500 * i;
        console.warn(`Retry ${i}/${attempts} after ${delay}ms: ${message}`);
        await sleep(delay);
        continue;
      }

      throw err;
    }
  }

  throw lastErr;
}

async function main() {
  const inputPath = process.argv[2];
  const outDir = process.argv[3] || 'downloads';
  const headlessArg = process.argv[4];

  if (!inputPath) {
    console.error('Usage: node download-originals.js <input.json> [output-dir] [headless=true|false]');
    process.exit(1);
  }

  const headless = headlessArg === 'false' ? false : true;

  const raw = await fs.readFile(inputPath, 'utf8');
  const data = JSON.parse(raw);
  const results = Array.isArray(data.results) ? data.results : [];

  await fs.mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({
    headless,
  });

  const context = await browser.newContext({
    acceptDownloads: true,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    extraHTTPHeaders: {
      'accept-language': 'en-US,en;q=0.9',
      accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.8',
    },
  });

  try {
    for (let i = 0; i < results.length; i++) {
      const entry = results[i];
      const chosen = pickOriginalLanguage(entry);

      if (!chosen || !chosen.pdfUrl) {
        console.log(`Skipping item ${i + 1}: no original language PDF found`);
        continue;
      }

      const ext = getExtensionFromUrl(chosen.pdfUrl);
      const baseName = sanitizeFilename(
        [
          entry.date,
          entry.uniqueSolrKey || entry.caseNumber || `item-${i + 1}`,
          chosen.code || 'orig',
        ].filter(Boolean).join('_')
      );

      const filePath = path.join(outDir, `${baseName}${ext}`);

      try {
        console.log(`Downloading ${i + 1}/${results.length}: ${chosen.pdfUrl}`);
        await downloadWithRetry(context, chosen.pdfUrl, filePath, 4);
        console.log(`Saved: ${filePath}`);
      } catch (err) {
        console.error(`Failed item ${i + 1}: ${err.message}`);
      }

      // Be polite to the server
      await sleep(1000);
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});