// End-to-end check of the interface through a headless browser.
// Covers the three supported inputs: AD62 PDF, AD02 image, AD59 image.
import puppeteer from 'puppeteer';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

// Draws a rectangle on the overlay; Shift adds a zone instead of replacing.
async function dragRect(x1, y1, x2, y2, { shift = false } = {}) {
  const box = await page.$('#overlay');
  await box.scrollIntoView();
  const bb = await box.boundingBox();
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(bb.x + bb.width * x1, bb.y + bb.height * y1);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width * x2, bb.y + bb.height * y2, { steps: 8 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
}

// Waits for a download that was not in `prev`, returns its filename.
async function newDownload(prev) {
  let list = [];
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    list = readdirSync(downloadDir).filter((f) => !f.endsWith('.crdownload'));
    const fresh = list.find((f) => !prev.includes(f));
    if (fresh) return fresh;
  }
  return null;
}

// Reads the dimensions from a PNG header (IHDR chunk).
function pngSize(name) {
  const b = readFileSync(join(downloadDir, name));
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

// Simulate a crop selection on the overlay (drag).
await dragRect(0.25, 0.25, 0.65, 0.7);

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

/* ------------------------- Multi-zone assembly case ------------------------ */

// The single-zone crop just downloaded gives zone A's reference dimensions.
const zoneA = pngSize('5-MIR-510-2_447.png');

// Gives each crop a distinct filename (downloads with an already-used name
// silently overwrite in headless mode).
const setActDate = (v) => page.evaluate((val) => { document.getElementById('actDate').value = val; }, v);

// Zone B alone, to learn its dimensions.
await page.click('#clearSel');
await dragRect(0.3, 0.35, 0.55, 0.75);
await setActDate('zoneB');
let prev = readdirSync(downloadDir);
await page.click('#dlCrop');
const zoneBFile = await newDownload(prev);
const zoneB = zoneBFile ? pngSize(zoneBFile) : { w: 0, h: 0 };
if (!zoneBFile) fail('zone B download missing');

// Zones A + B together (Shift+drag adds B), assembled vertically by default.
await page.click('#clearSel');
await dragRect(0.25, 0.25, 0.65, 0.7);
await dragRect(0.3, 0.35, 0.55, 0.75, { shift: true });

const assemblyVisible = await page.evaluate(() => !document.getElementById('assemblyWrap').hidden);
if (!assemblyVisible) fail('assembly selector should show with two zones');

await setActDate('combined');
prev = readdirSync(downloadDir);
await page.click('#dlCrop');
const combinedFile = await newDownload(prev);
const combined = combinedFile ? pngSize(combinedFile) : { w: 0, h: 0 };
if (!combinedFile) fail('combined download missing');
console.log('ASSEMBLY:', JSON.stringify({ zoneA, zoneB, combined }));
if (combined.w !== Math.max(zoneA.w, zoneB.w)) fail('combined width', combined, zoneA, zoneB);
if (combined.h !== zoneA.h + zoneB.h) fail('combined height', combined, zoneA, zoneB);
await setActDate('');

// Delete zone B through its ✕ button (inside its top-right corner): one zone
// remains, so the assembly selector hides and crop stays enabled. The drawn
// rects are clamped to the image, so zone B's top is the image's on-screen
// top, recomputed here from the viewer's fit-and-center logic.
const obb = await (await page.$('#overlay')).boundingBox();
const fit = Math.min(1, (obb.width - 32) / 3000, (obb.height - 32) / 2341);
const imgTop = obb.y + (obb.height - 2341 * fit) / 2;
await page.mouse.click(obb.x + obb.width * 0.55 - 16, imgTop + 16);
const afterDelete = await page.evaluate(() => ({
  assemblyHidden: document.getElementById('assemblyWrap').hidden,
  cropEnabled: !document.getElementById('dlCrop').disabled,
}));
console.log('AFTER ZONE DELETE:', JSON.stringify(afterDelete));
if (!afterDelete.assemblyHidden) fail('assembly selector should hide after deleting a zone');
if (!afterDelete.cropEnabled) fail('crop should stay enabled with one zone left');

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
