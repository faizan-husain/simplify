import puppeteer from '../pdf-service/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve('frontend/dist');

// 1. Serve dist directory on port 4184
const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/' || !path.extname(reqPath)) reqPath = '/index.html';
  const filePath = path.join(distDir, reqPath);
  if (fs.existsSync(filePath)) {
    const ext = path.extname(filePath);
    const contentType =
      ext === '.html' ? 'text/html' :
      ext === '.js' ? 'application/javascript' :
      ext === '.css' ? 'text/css' :
      ext === '.json' ? 'application/json' :
      'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end();
  }
});

// 2. Start pdf-service child process on port 3005
console.log('[Harness] Starting pdf-service on port 3005...');
const serviceEnv = {
  ...process.env,
  PORT: '3005',
  MAX_CONCURRENT: '3',
};
const serviceProcess = spawn('node', ['src/server.js'], {
  cwd: path.resolve('pdf-service'),
  env: serviceEnv,
  stdio: 'pipe',
});

serviceProcess.stdout.on('data', (d) => {
  const msg = d.toString().trim();
  if (msg) console.log(`[Service] ${msg}`);
});
serviceProcess.stderr.on('data', (d) => {
  const msg = d.toString().trim();
  if (msg) console.error(`[Service ERR] ${msg}`);
});

// Wait for service to become healthy
async function waitForServiceHealth() {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch('http://127.0.0.1:3005/health');
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('PDF service failed to become healthy on port 3005');
}

server.listen(4184, async () => {
  try {
    await waitForServiceHealth();
    console.log('[Harness] PDF service is healthy. Launching browser...');

    const browser = await puppeteer.launch({
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const initPage = await browser.newPage();
    await initPage.goto('http://localhost:4184', { waitUntil: 'networkidle0' });

    // Extract compiled CSS from the live page
    const compiledCss = await initPage.evaluate(async () => {
      let css = '';
      for (const sheet of document.styleSheets) {
        try {
          if (sheet.cssRules) {
            for (const r of sheet.cssRules) {
              css += r.cssText + '\n';
            }
          }
        } catch {}
      }
      const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
      for (const link of links) {
        try {
          const res = await fetch(link.href);
          if (res.ok) css += (await res.text()) + '\n';
        } catch {}
      }
      return css;
    });
    console.log(`[Harness] Extracted ${compiledCss.length} bytes of compiled app CSS.`);
    await initPage.close();

    // Scenario generator helper
    async function runScenario(scenarioName, pageSize, htmlContent) {
      console.log(`[Harness] Running scenario: ${scenarioName} (${pageSize})...`);

      // 1. Generate Ground Truth (Native Print Preview Engine via isolated browser page)
      const gtPage = await browser.newPage();
      try {
        await gtPage.setViewport({ width: 1200, height: 900, deviceScaleFactor: 2 });
        await gtPage.goto('http://localhost:4184', { waitUntil: 'networkidle0' });

        const sizeRule = pageSize === 'A5' ? 'A5 portrait' : pageSize === 'A4' ? 'A4 portrait' : '80mm auto';

        await gtPage.evaluate((html, size) => {
          document.body.innerHTML = html;
          const style = document.createElement('style');
          style.innerHTML = `
            @page { size: ${size} !important; margin: 0 !important; }
            html, body { margin: 0 !important; padding: 0 !important; background: #ffffff !important; }
          `;
          document.head.appendChild(style);
        }, htmlContent, sizeRule);

        await gtPage.emulateMediaType('print');
        await gtPage.evaluate(async () => {
          if (document.fonts && document.fonts.ready) await document.fonts.ready;
        });

        const gtBuffer = await gtPage.pdf({
          preferCSSPageSize: true,
          printBackground: true,
          margin: { top: 0, right: 0, bottom: 0, left: 0 }
        });
        fs.writeFileSync(`qa/pdf/${scenarioName}_ground_truth.pdf`, gtBuffer);
      } finally {
        await gtPage.close();
      }

      // 2. Generate New Pipeline via pdf-service /render endpoint
      const renderRes = await fetch('http://127.0.0.1:3005/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          html: htmlContent,
          css: compiledCss,
          page: pageSize,
          filename: `${scenarioName}.pdf`,
        })
      });

      if (!renderRes.ok) {
        throw new Error(`Service returned HTTP ${renderRes.status} for ${scenarioName}`);
      }
      const newBuffer = Buffer.from(await renderRes.arrayBuffer());
      fs.writeFileSync(`qa/pdf/${scenarioName}_new_pipeline.pdf`, newBuffer);
    }

    // =========================================================================
    // Define the 10 Scenarios covering the 19 documents
    // =========================================================================

    // 1. Invoice Standard A5 (#INV-0004)
    const invoiceStandardHtml = `
      <div id="invoice-doc" style="box-sizing:border-box; width:148mm; max-width:148mm; padding:8mm 8mm 10mm 8mm; margin:0 auto; background:#ffffff; font-family:Inter,sans-serif;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; padding-bottom:10px; margin-bottom:10px; border-bottom:1px solid #CBD5E1;">
          <div>
            <h1 style="font-size:16px; font-weight:700; color:#0F172A; margin:0;">Global Computers</h1>
            <p style="font-size:10px; color:#64748B; margin:2px 0;">Printing &amp; Online Works</p>
            <p style="font-size:9.5px; color:#64748B; margin:1px 0;">Ali Sahab Mohalla, Nandurbar • 9764971786</p>
          </div>
          <div style="text-align:right;">
            <span style="display:inline-block; padding:2px 10px; border-radius:9999px; background:#F0FDFA; color:#115E59; font-weight:700; font-size:9px; text-transform:uppercase;">INVOICE</span>
            <div style="font-size:12px; font-weight:700; font-family:monospace; margin-top:3px;">#INV-0004</div>
            <div style="font-size:9.5px; color:#64748B;">Date: <strong>24 Nov 2026</strong></div>
          </div>
        </div>
        <div style="background:#EEF0F3; border:1px solid #CBD5E1; border-radius:8px; padding:10px; margin-bottom:10px; display:flex; justify-content:space-between;">
          <div>
            <div style="font-size:8.5px; font-weight:700; color:#64748B; text-transform:uppercase;">BILLED TO</div>
            <div style="font-size:12px; font-weight:700; color:#0F172A;">Sayyed Restorant</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:8.5px; font-weight:700; color:#64748B; text-transform:uppercase;">MOBILE</div>
            <div style="font-size:12px; font-family:monospace; font-weight:500;">7020257442</div>
          </div>
        </div>
        <div style="border:1px solid #CBD5E1; border-radius:8px; overflow:hidden; margin-bottom:10px;">
          <table style="width:100%; border-collapse:collapse; text-align:left; font-size:10.5px;">
            <thead>
              <tr style="background:#F8FAFC; color:#475569; font-size:9px; border-bottom:1px solid #CBD5E1;">
                <th style="padding:8px 12px;">DESCRIPTION</th>
                <th style="padding:8px 6px; text-align:center;">QTY</th>
                <th style="padding:8px 8px; text-align:right;">RATE</th>
                <th style="padding:8px 12px; text-align:right;">AMOUNT</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="padding:8px 12px;">
                  <span style="font-weight:500;">Hotel Menu Card</span>
                  <span style="display:block; font-size:9.5px; color:#64748B;">Particular: A4 size Front Back with Lamination and Spiral Binding</span>
                </td>
                <td style="padding:8px 6px; text-align:center;">8</td>
                <td style="padding:8px 8px; text-align:right;">₹775</td>
                <td style="padding:8px 12px; text-align:right; font-weight:600;">₹6,200</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
          <div style="border:1px solid #CBD5E1; border-radius:8px; padding:8px; display:flex; align-items:center; gap:8px;">
            <svg width="54" height="54" style="background:#f1f5f9;"></svg>
            <div style="font-size:8.5px;">
              <div style="font-weight:700; font-size:9.5px;">Scan &amp; Pay UPI</div>
              <div style="font-weight:700; font-size:11px; color:#0F766E;">₹6,200</div>
              <div style="font-family:monospace; font-weight:500;">global.graphics007-2@okhdfcbank</div>
            </div>
          </div>
          <div style="background:#F8FAFC; border:1px solid #CBD5E1; border-radius:8px; padding:10px; font-size:10.5px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Subtotal</span><span>₹6,200</span></div>
            <div style="display:flex; justify-content:space-between; font-weight:700; border-top:1px solid #CBD5E1; padding-top:6px;"><span>Total Amount</span><span>₹6,200</span></div>
          </div>
        </div>
        <div style="border-top:1px solid #CBD5E1; padding-top:8px; display:flex; justify-content:space-between; font-size:8.5px; color:#64748B;">
          <span>Powered by <strong>Simplify</strong></span>
          <span>Business Management &amp; Billing Software</span>
        </div>
      </div>
    `;
    await runScenario('invoice_standard_a5', 'A5', invoiceStandardHtml);

    // 2. Invoice Multi-line A5
    const invoiceMultilineHtml = invoiceStandardHtml.replace('Sayyed Restorant', 'M/S Royal Palace Luxury Banquet & Hospitality Services Pvt Ltd')
      .replace('Hotel Menu Card', 'Special Deluxe Visiting Card with Velvet Matte UV Spot Lamination & Embossing');
    await runScenario('invoice_multiline_a5', 'A5', invoiceMultilineHtml);

    // 3. Invoice Large Amounts A5
    const invoiceLargeAmountsHtml = invoiceStandardHtml.replace('₹6,200', '₹9,99,99,999.00').replace('₹775', '₹1,25,000');
    await runScenario('invoice_large_amounts_a5', 'A5', invoiceLargeAmountsHtml);

    // 4. Receipt Standard A5
    const receiptStandardHtml = `
      <div id="receipt-doc" style="box-sizing:border-box; width:148mm; max-width:148mm; padding:8mm 8mm 10mm 8mm; margin:0 auto; background:#ffffff; font-family:Inter,sans-serif;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; padding-bottom:10px; margin-bottom:10px; border-bottom:1px solid #CBD5E1;">
          <div>
            <h1 style="font-size:16px; font-weight:700; color:#0F172A; margin:0;">Global Computers</h1>
            <p style="font-size:10px; color:#64748B; margin:2px 0;">Printing &amp; Online Works</p>
          </div>
          <div style="text-align:right;">
            <span style="display:inline-block; padding:2px 10px; border-radius:9999px; background:#ECFDF5; color:#047857; font-weight:700; font-size:9px;">PAYMENT RECEIPT</span>
            <div style="font-size:12px; font-weight:700; font-family:monospace; margin-top:3px;">#RC-001</div>
            <div style="font-size:9.5px; color:#64748B;">Date: <strong>24 Nov 2026</strong></div>
          </div>
        </div>
        <div style="background:#EEF0F3; border:1px solid #CBD5E1; border-radius:8px; padding:10px; margin-bottom:12px;">
          <div style="font-size:8.5px; font-weight:700; color:#64748B;">RECEIVED FROM</div>
          <div style="font-size:13px; font-weight:700; color:#0F172A;">Aayesha Clinic (9623874183)</div>
        </div>
        <div style="border:1px solid #CBD5E1; border-radius:8px; padding:12px; margin-bottom:12px; background:#F8FAFC; text-align:center;">
          <div style="font-size:10px; color:#64748B;">AMOUNT RECEIVED</div>
          <div style="font-size:22px; font-weight:800; color:#0F766E; margin:4px 0;">₹6,000.00</div>
          <div style="font-size:10px; color:#475569;">Mode: <strong>CASH</strong> · Status: Confirmed</div>
        </div>
        <div style="border-top:1px solid #CBD5E1; padding-top:8px; display:flex; justify-content:space-between; font-size:8.5px; color:#64748B;">
          <span>Powered by <strong>Simplify</strong></span>
          <span>Official Payment Receipt</span>
        </div>
      </div>
    `;
    await runScenario('receipt_standard_a5', 'A5', receiptStandardHtml);

    // 5. Receipt Allocated A5
    const receiptAllocatedHtml = receiptStandardHtml.replace('CASH', 'UPI (Ref: 987654321098)');
    await runScenario('receipt_allocated_a5', 'A5', receiptAllocatedHtml);

    // 6. Customer Statement A4 (Multi-page 35 rows)
    let rowsHtml = '';
    for (let i = 1; i <= 35; i++) {
      rowsHtml += `
        <tr style="break-inside:avoid; page-break-inside:avoid; border-bottom:1px solid #E2E8F0;">
          <td style="padding:7px 10px; font-size:10.5px;">2026-11-${String(i % 28 + 1).padStart(2, '0')}</td>
          <td style="padding:7px 10px; font-size:10.5px; font-weight:500;">INV-${String(1000 + i)}</td>
          <td style="padding:7px 10px; font-size:10.5px;">Design &amp; Printing Service Item Row ${i}</td>
          <td style="padding:7px 10px; font-size:10.5px; text-align:right;">₹1,500.00</td>
          <td style="padding:7px 10px; font-size:10.5px; text-align:right;">₹0.00</td>
          <td style="padding:7px 10px; font-size:10.5px; text-align:right; font-weight:600;">₹${i * 1500}.00</td>
        </tr>
      `;
    }
    const customerStatementHtml = `
      <div id="statement-doc" style="box-sizing:border-box; width:194mm; max-width:194mm; padding:0; margin:0 auto; background:#ffffff; font-family:Inter,sans-serif;">
        <div style="padding-bottom:12px; margin-bottom:12px; border-bottom:2px solid #0F172A; display:flex; justify-content:space-between;">
          <div>
            <h1 style="font-size:18px; font-weight:700; margin:0;">Global Computers</h1>
            <p style="font-size:11px; color:#64748B; margin:2px 0;">Customer Statement / Ledger</p>
          </div>
          <div style="text-align:right;">
            <div style="font-size:12px; font-weight:600;">Sayyed Restorant</div>
            <div style="font-size:10px; color:#64748B;">Period: Nov 2026</div>
          </div>
        </div>
        <table style="width:100%; border-collapse:collapse; text-align:left;">
          <thead style="display:table-header-group; background:#F8FAFC; border-bottom:2px solid #CBD5E1;">
            <tr>
              <th style="padding:8px 10px; font-size:9.5px;">DATE</th>
              <th style="padding:8px 10px; font-size:9.5px;">REF NO</th>
              <th style="padding:8px 10px; font-size:9.5px;">DESCRIPTION</th>
              <th style="padding:8px 10px; font-size:9.5px; text-align:right;">DEBIT</th>
              <th style="padding:8px 10px; font-size:9.5px; text-align:right;">CREDIT</th>
              <th style="padding:8px 10px; font-size:9.5px; text-align:right;">BALANCE</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    `;
    await runScenario('customer_statement_a4', 'A4', customerStatementHtml);

    // 7. Vendor Statement A4
    const vendorStatementHtml = customerStatementHtml.replace('Customer Statement / Ledger', 'Vendor Statement / Outgoing Ledger');
    await runScenario('vendor_statement_a4', 'A4', vendorStatementHtml);

    // 8. Bank Ledger A4
    const bankLedgerHtml = customerStatementHtml.replace('Customer Statement / Ledger', 'Bank Account Passbook · HDFC Bank (••4821)');
    await runScenario('bank_ledger_a4', 'A4', bankLedgerHtml);

    // 9. Report P&L A4
    const reportPnlHtml = customerStatementHtml.replace('Customer Statement / Ledger', 'Profit & Loss Statement (P&L) — FY 2026-27');
    await runScenario('report_pnl_a4', 'A4', reportPnlHtml);

    // 10. Report Invoices Register A4
    const reportInvoicesHtml = customerStatementHtml.replace('Customer Statement / Ledger', 'Invoices Register — All Bills (FY 2026-27)');
    await runScenario('report_invoices_register_a4', 'A4', reportInvoicesHtml);

    await browser.close();
    server.close();
    serviceProcess.kill('SIGTERM');
    console.log('[Harness] All 10 scenarios generated successfully!');
    process.exit(0);
  } catch (err) {
    console.error('[Harness ERR]', err);
    server.close();
    serviceProcess.kill('SIGTERM');
    process.exit(1);
  }
});
