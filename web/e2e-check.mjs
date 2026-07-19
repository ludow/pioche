// End-to-end check of the interface through a headless browser.
// Covers the three supported inputs: AD62 PDF, AD02 image, AD59 image.
import puppeteer from 'puppeteer';
import { mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = 'http://localhost:5199';
const downloadDir = mkdtempSync(join(tmpdir(), 'dl-'));

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 2200 });
const errors = [];
// Ignore benign resource failures (favicon, source maps).
const benign = (u) => /favicon\.ico$/.test(u) || /\.map$/.test(u);
page.on('response', (r) => { if (r.status() === 404 && !benign(r.url())) errors.push('404: ' + r.url()); });
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const client = await page.target().createCDPSession();
await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });

// Force the "classic download" path: the file picker
// (showSaveFilePicker) cannot open in headless mode.
await page.evaluateOnNewDocument(() => { delete window.showSaveFilePicker; });

await page.goto(BASE, { waitUntil: 'networkidle0' });

let ok = true;
const fail = (...msg) => { console.error('FAIL', ...msg); ok = false; };

// Uploads a file and waits until it has been processed, then returns the
// metadata fields and displayed dimensions.
async function processFile(path) {
  const input = await page.$('#file');
  await input.uploadFile(path);
  await page.waitForFunction(
    (name) => document.getElementById('status').textContent === `Traité : ${name}`,
    { timeout: 15000 },
    path.split('/').pop(),
  );
  const meta = await page.evaluate(() => ({
    reference: document.getElementById('reference').value,
    viewNumber: document.getElementById('viewNumber').value,
    link: document.getElementById('link').value,
    hasImage: !document.getElementById('viewer').hidden,
    dims: document.getElementById('dims').textContent,
  }));
  console.log(path.split('/').pop(), '->', JSON.stringify(meta));
  return meta;
}

/* ------------------------- AD62 PDF case ------------------------- */

const pdf = await processFile('samples/62_LIEVIN_5-MIR-510-2_447.pdf');
if (pdf.reference !== '5 MIR 510/2') fail('pdf reference');
if (pdf.viewNumber !== '447') fail('pdf viewNumber');
if (!pdf.link.includes('ark:/64297/09f7eeee8291e659013ed43af1bc5541')) fail('pdf link');
if (!pdf.hasImage) fail('pdf image not shown');
if (!pdf.dims.startsWith('3000 × 2341')) fail('pdf dims', pdf.dims);

// Simulate a crop selection on the overlay (drag).
const box = await page.$('#overlay');
await box.scrollIntoView();
const bb = await box.boundingBox();
await page.mouse.move(bb.x + bb.width * 0.25, bb.y + bb.height * 0.25);
await page.mouse.down();
await page.mouse.move(bb.x + bb.width * 0.65, bb.y + bb.height * 0.7, { steps: 8 });
await page.mouse.up();

const cropEnabled = await page.evaluate(() => !document.getElementById('dlCrop').disabled);
console.log('CROP button enabled after selection:', cropEnabled);
if (!cropEnabled) fail('crop not enabled');

// Download the full image, then the selection.
await page.click('#dlFull');
await page.click('#dlCrop');

// Wait for the files (poll: encoding large images can take a while).
let files = [];
for (let i = 0; i < 40 && files.length < 2; i++) {
  await new Promise((r) => setTimeout(r, 250));
  files = readdirSync(downloadDir)
    .filter((f) => !f.endsWith('.crdownload'))
    .map((f) => ({ f, size: statSync(join(downloadDir, f)).size }));
}
console.log('DOWNLOADS:', JSON.stringify(files));
if (files.length < 2 || files.some((x) => x.size < 1000)) fail('downloads', files);

/* ----------------------------- Aisne image case ---------------------------- */

const aisne = await processFile('samples/FRAD002_5Mi0493_0374.jpg');
if (aisne.reference !== '5Mi0493') fail('aisne reference');
// The trailing filename number is a scan sequence, not the view number.
if (aisne.viewNumber !== '') fail('aisne viewNumber should be empty');
if (aisne.link !== '') fail('aisne link should be empty');
if (!aisne.hasImage) fail('aisne image not shown');
if (!aisne.dims.startsWith('3880 × 2464')) fail('aisne dims', aisne.dims);

/* ------------------------------ Nord image case ---------------------------- */

const nord = await processFile(
  'samples/HAZEBROUCK M [1871-1888] - 1 Mi EC 295 R 005 - Lot 1 - Média 169 - Site Web des Archives départementales du Nord.jpg',
);
if (nord.reference !== '1 Mi EC 295 R 005') fail('nord reference');
if (nord.viewNumber !== '169') fail('nord viewNumber');
if (nord.link !== '') fail('nord link should be empty');
if (!nord.hasImage) fail('nord image not shown');
if (!nord.dims.startsWith('3592 × 2600')) fail('nord dims', nord.dims);

console.log('CONSOLE ERRORS:', errors.length ? errors : 'none');
if (errors.length) fail('console errors');

await browser.close();

console.log(ok ? '\n✅ ALL CHECKS PASSED' : '\n❌ CHECKS FAILED');
process.exit(ok ? 0 : 1);
