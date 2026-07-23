// End-to-end check of the interface through a headless browser.
// Covers the three supported inputs: AD62 PDF, AD02 image, AD59 image.
import puppeteer from 'puppeteer';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = 'http://localhost:5199';
const downloadDir = mkdtempSync(join(tmpdir(), 'dl-'));

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
await browser.defaultBrowserContext().overridePermissions(BASE, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
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

// Help opens in a modal dialog.
await page.click('#helpBtn');
if (!(await page.evaluate(() => document.getElementById('helpDialog').open))) fail('help dialog should open');
await page.click('#helpClose');
if (await page.evaluate(() => document.getElementById('helpDialog').open)) fail('help dialog should close');

// Uploads one or several files and waits until processing completes, then
// returns the metadata fields, displayed dimensions and page navigator state.
async function processFiles(paths) {
  const input = await page.$('#file');
  await input.uploadFile(...paths);
  const expected = paths.length === 1
    ? `Traité : ${paths[0].split('/').pop()}`
    : `Traité : ${paths.length} fichiers`;
  await page.waitForFunction(
    (t) => document.getElementById('status').textContent === t,
    { timeout: 15000 },
    expected,
  );
  const meta = await page.evaluate(() => ({
    reference: document.getElementById('reference').value,
    viewNumber: document.getElementById('viewNumber').value,
    link: document.getElementById('link').value,
    hasImage: !document.getElementById('viewer').hidden,
    dims: document.getElementById('dims').textContent,
    pagenavVisible: !document.getElementById('pagenav').hidden,
    pageLabel: document.getElementById('pageLabel').textContent,
  }));
  console.log(paths.map((p) => p.split('/').pop()).join(' + '), '->', JSON.stringify(meta));
  return meta;
}

/* ------------------------- AD62 PDF case ------------------------- */

const pdf = await processFiles(['samples/62_LIEVIN_5-MIR-510-2_447.pdf']);
if (pdf.pagenavVisible) fail('pagenav should stay hidden for a single page');
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

// Clicking an empty spot of the overlay clears the whole selection (there is
// no dedicated button for that).
async function clickEmptyArea() {
  const bb = await (await page.$('#overlay')).boundingBox();
  await page.mouse.click(bb.x + 8, bb.y + 8);
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

// Zone B alone, to learn its dimensions. Clearing happens by clicking an
// empty area of the image.
await clickEmptyArea();
if (await page.evaluate(() => !document.getElementById('dlCrop').disabled)) {
  fail('clicking an empty area should clear the selection');
}
await dragRect(0.3, 0.35, 0.55, 0.75);
await setActDate('zoneB');
let prev = readdirSync(downloadDir);
await page.click('#dlCrop');
const zoneBFile = await newDownload(prev);
const zoneB = zoneBFile ? pngSize(zoneBFile) : { w: 0, h: 0 };
if (!zoneBFile) fail('zone B download missing');

// Zones A + B together (Shift+drag adds B), assembled vertically by default.
await clickEmptyArea();
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
if (combined.h !== zoneA.h + zoneB.h + 8) fail('combined height (with 8px gap)', combined, zoneA, zoneB);
await setActDate('');

// Copy the assembled selection to the clipboard, then read it back.
await page.click('#copySel');
await page.waitForFunction(
  () => document.getElementById('toast').textContent.includes('copiée'),
  { timeout: 5000 },
);
const clip = await page.evaluate(async () => {
  try {
    for (const item of await navigator.clipboard.read()) {
      if (item.types.includes('image/png')) {
        const bmp = await createImageBitmap(await item.getType('image/png'));
        const c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        const cx = c.getContext('2d');
        cx.drawImage(bmp, 0, 0);
        // Bottom-right corner is filler (zone B is narrower than the canvas):
        // it must be transparent in the PNG.
        const fillerAlpha = cx.getImageData(bmp.width - 2, bmp.height - 2, 1, 1).data[3];
        // A pixel inside zone A near the top must stay opaque.
        const contentAlpha = cx.getImageData(Math.floor(bmp.width / 2), 20, 1, 1).data[3];
        return { w: bmp.width, h: bmp.height, fillerAlpha, contentAlpha };
      }
    }
    return { error: 'no image in clipboard' };
  } catch (e) {
    return { error: e.message };
  }
});
console.log('CLIPBOARD:', JSON.stringify(clip));
if (clip.w !== combined.w || clip.h !== combined.h) fail('clipboard image', clip);
if (clip.fillerAlpha !== 0) fail('PNG filler should be transparent', clip);
if (clip.contentAlpha !== 255) fail('PNG content should stay opaque', clip);

/* ---------------------- Assembly adjustment (offset) ----------------------- */

// The adjust button shows with two zones. Open the dialog and drag the second
// part far to the left on the transverse axis: the exported canvas must widen
// (offset flows through to export) while its height stays the same.
if (await page.evaluate(() => document.getElementById('adjustRow').hidden)) {
  fail('adjust button should show with two zones');
}
await page.click('#adjustBtn');
if (!(await page.evaluate(() => document.getElementById('adjustDialog').open))) fail('adjust dialog should open');

const acv = await (await page.$('#adjustCanvas')).boundingBox();
// The second part sits in the lower half of the vertical stack; drag it left.
await page.mouse.move(acv.x + acv.width * 0.5, acv.y + acv.height * 0.75);
await page.mouse.down();
await page.mouse.move(acv.x + acv.width * 0.2, acv.y + acv.height * 0.75, { steps: 8 });
await page.mouse.up();

// Close the modal before downloading (it covers the export buttons).
await page.click('#adjustClose');
if (await page.evaluate(() => document.getElementById('adjustDialog').open)) fail('adjust dialog should close');

await setActDate('adjusted');
prev = readdirSync(downloadDir);
await page.click('#dlCrop');
const adjustedFile = await newDownload(prev);
const adjusted = adjustedFile ? pngSize(adjustedFile) : { w: 0, h: 0 };
if (!adjustedFile) fail('adjusted download missing');
console.log('ADJUSTED:', JSON.stringify(adjusted));
if (adjusted.w <= combined.w) fail('offset should widen the assembled image', adjusted, combined);
if (adjusted.h !== combined.h) fail('offset should not change the assembled height', adjusted, combined);

// Reset (from within the dialog) restores the original assembly.
await page.click('#adjustBtn');
await page.click('#adjustReset');
await page.click('#adjustClose');
await setActDate('reset');
prev = readdirSync(downloadDir);
await page.click('#dlCrop');
const resetFile = await newDownload(prev);
const resetDims = resetFile ? pngSize(resetFile) : { w: 0, h: 0 };
if (!resetFile) fail('reset download missing');
if (resetDims.w !== combined.w || resetDims.h !== combined.h) fail('reset should restore dimensions', resetDims, combined);
await setActDate('');

// JPG export keeps a white (opaque) background since JPEG has no transparency.
await page.select('#format', 'jpg');
await setActDate('jpg');
prev = readdirSync(downloadDir);
await page.click('#dlCrop');
const jpgFile = await newDownload(prev);
if (!jpgFile) fail('jpg download missing');
else if (!jpgFile.endsWith('.jpg')) fail('jpg export extension', jpgFile);
await page.select('#format', 'png'); // restore PNG for the rest of the run
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

const aisne = await processFiles(['samples/FRAD002_5Mi0493_0374.jpg']);
if (aisne.reference !== '5Mi0493') fail('aisne reference');
// The trailing filename number is a scan sequence, not the view number.
if (aisne.viewNumber !== '') fail('aisne viewNumber should be empty');
if (aisne.link !== '') fail('aisne link should be empty');
if (!aisne.hasImage) fail('aisne image not shown');
if (!aisne.dims.startsWith('3880 × 2464')) fail('aisne dims', aisne.dims);

/* ------------------------------ Nord image case ---------------------------- */

const nord = await processFiles([
  'samples/HAZEBROUCK M [1871-1888] - 1 Mi EC 295 R 005 - Lot 1 - Média 169 - Site Web des Archives départementales du Nord.jpg',
]);
if (nord.reference !== '1 Mi EC 295 R 005') fail('nord reference');
if (nord.viewNumber !== '169') fail('nord viewNumber');
if (nord.link !== '') fail('nord link should be empty');
if (!nord.hasImage) fail('nord image not shown');
if (!nord.dims.startsWith('3592 × 2600')) fail('nord dims', nord.dims);

/* -------------------- Two-page PDF (act across two pages) ------------------ */

const twoPage = await processFiles(['samples/3 E 032 6 - Angres - 1891-1913 - Vue 116-117.pdf']);
if (twoPage.reference !== '3 E 032/6') fail('two-page reference', twoPage.reference);
if (twoPage.viewNumber !== '116') fail('two-page viewNumber', twoPage.viewNumber);
if (!twoPage.link.includes('ark:/64297/4c27b634a9369e02bf90117a802ac917')) fail('two-page link');
if (!twoPage.pagenavVisible || twoPage.pageLabel !== 'Page 1/2') fail('two-page nav', twoPage.pageLabel);

// Zone on page 1, downloaded alone to learn its dimensions.
await dragRect(0.3, 0.3, 0.6, 0.6);
await setActDate('page1');
prev = readdirSync(downloadDir);
await page.click('#dlCrop');
const p1File = await newDownload(prev);
const p1 = p1File ? pngSize(p1File) : { w: 0, h: 0 };
if (!p1File) fail('page-1 crop download missing');

// Shift+drag on page 2 adds a second zone; both pages assemble vertically.
await page.click('#nextPage');
const label2 = await page.evaluate(() => document.getElementById('pageLabel').textContent);
if (label2 !== 'Page 2/2') fail('page label after next', label2);
await dragRect(0.35, 0.4, 0.6, 0.7, { shift: true });
await setActDate('twopages');
prev = readdirSync(downloadDir);
await page.click('#dlCrop');
const bothFile = await newDownload(prev);
const both = bothFile ? pngSize(bothFile) : { w: 0, h: 0 };
if (!bothFile) fail('two-page crop download missing');

// Zone of page 2 alone, to verify the assembled dimensions.
await clickEmptyArea();
await dragRect(0.35, 0.4, 0.6, 0.7);
await setActDate('page2');
prev = readdirSync(downloadDir);
await page.click('#dlCrop');
const p2File = await newDownload(prev);
const p2 = p2File ? pngSize(p2File) : { w: 0, h: 0 };
if (!p2File) fail('page-2 crop download missing');

console.log('TWO-PAGE ASSEMBLY:', JSON.stringify({ p1, p2, both }));
if (both.w !== Math.max(p1.w, p2.w)) fail('two-page combined width', both, p1, p2);
if (both.h !== p1.h + p2.h + 8) fail('two-page combined height (with 8px gap)', both, p1, p2);
await setActDate('');

/* --------------------- Several images loaded together ---------------------- */

const multi = await processFiles([
  'samples/FRAD002_5Mi0493_0374.jpg',
  'samples/HAZEBROUCK M [1871-1888] - 1 Mi EC 295 R 005 - Lot 1 - Média 169 - Site Web des Archives départementales du Nord.jpg',
]);
if (multi.reference !== '5Mi0493') fail('multi-image reference (first recognized file)', multi.reference);
if (!multi.pagenavVisible || multi.pageLabel !== 'Page 1/2') fail('multi-image nav', multi.pageLabel);
if (!multi.dims.startsWith('3880 × 2464')) fail('multi-image page 1 dims', multi.dims);
await page.click('#nextPage');
const dims2 = await page.evaluate(() => document.getElementById('dims').textContent);
if (!dims2.startsWith('3592 × 2600')) fail('multi-image page 2 dims', dims2);

/* ------------------------------- Square tool ------------------------------- */

await page.goto(BASE + '/coat-of-arms/', { waitUntil: 'networkidle0' });

// Inject a generated 50×60 red PNG through the file input.
await page.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 50;
  c.height = 60;
  const cx = c.getContext('2d');
  cx.fillStyle = '#f00';
  cx.fillRect(0, 0, 50, 60);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'blason.png', { type: 'image/png' }));
  const input = document.getElementById('file');
  input.files = dt.files;
  input.dispatchEvent(new Event('change'));
});
await page.waitForSelector('#result:not([hidden])', { timeout: 10000 });

// The 50×60 input must become 60×60: transparent corners, red center.
const square = await page.evaluate(() => {
  const c = document.getElementById('out');
  const ctx = c.getContext('2d');
  const corner = ctx.getImageData(0, 0, 1, 1).data;
  const center = ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
  return { w: c.width, h: c.height, cornerAlpha: corner[3], center: Array.from(center) };
});
console.log('SQUARE:', JSON.stringify(square));
if (square.w !== 60 || square.h !== 60) fail('square dims', square);
if (square.cornerAlpha !== 0) fail('square corner should be transparent', square);
if (square.center.join(',') !== '255,0,0,255') fail('square center should be red', square);

prev = readdirSync(downloadDir);
await page.click('#download');
const squareFile = await newDownload(prev);
if (!squareFile) fail('square download missing');
else {
  const s = pngSize(squareFile);
  if (squareFile !== 'blason-carre.png' || s.w !== 60 || s.h !== 60) fail('square file', squareFile, s);
}

console.log('CONSOLE ERRORS:', errors.length ? errors : 'none');
if (errors.length) fail('console errors');

await browser.close();

console.log(ok ? '\n✅ ALL CHECKS PASSED' : '\n❌ CHECKS FAILED');
process.exit(ok ? 0 : 1);
