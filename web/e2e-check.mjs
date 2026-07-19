// Vérification end-to-end de l'interface via un navigateur headless.
import puppeteer from 'puppeteer';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = 'http://localhost:5199';
const downloadDir = mkdtempSync(join(tmpdir(), 'dl-'));

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 2200 });
const errors = [];
// Ignore les échecs de ressources bénins (favicon, source maps).
const benign = (u) => /favicon\.ico$/.test(u) || /\.map$/.test(u);
page.on('response', (r) => { if (r.status() === 404 && !benign(r.url())) errors.push('404: ' + r.url()); });
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const client = await page.target().createCDPSession();
await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });

// Force le chemin « téléchargement classique » : le sélecteur de fichier
// (showSaveFilePicker) ne peut pas s'ouvrir en headless.
await page.evaluateOnNewDocument(() => { delete window.showSaveFilePicker; });

await page.goto(BASE, { waitUntil: 'networkidle0' });

// Injecte le PDF d'exemple dans l'input file.
const input = await page.$('#file');
await input.uploadFile('web/sample.pdf');

// Attend que les résultats apparaissent.
await page.waitForSelector('#results:not([hidden])', { timeout: 15000 });
await page.waitForFunction(() => document.getElementById('cote').value.length > 0, { timeout: 15000 });

const meta = await page.evaluate(() => ({
  cote: document.getElementById('cote').value,
  vue: document.getElementById('vue').value,
  lien: document.getElementById('lien').value,
  hasImage: !document.getElementById('viewer').hidden,
  srcW: window.__srcW,
}));

// Expose la taille source pour vérif.
const dims = await page.evaluate(() => document.getElementById('dims').textContent);

console.log('META:', JSON.stringify(meta));
console.log('DIMS:', dims);

// Simule une sélection de rognage sur l'overlay (drag).
const box = await page.$('#overlay');
await box.scrollIntoView();
const bb = await box.boundingBox();
await page.mouse.move(bb.x + bb.width * 0.25, bb.y + bb.height * 0.25);
await page.mouse.down();
await page.mouse.move(bb.x + bb.width * 0.65, bb.y + bb.height * 0.7, { steps: 8 });
await page.mouse.up();

const cropEnabled = await page.evaluate(() => !document.getElementById('dlCrop').disabled);
console.log('CROP button enabled after selection:', cropEnabled);

// Télécharge l'image entière puis la sélection.
await page.click('#dlFull');
await page.click('#dlCrop');

// Attend les fichiers (poll : l'encodage des grandes images peut prendre du temps).
const { readdirSync, statSync } = await import('node:fs');
let files = [];
for (let i = 0; i < 40 && files.length < 2; i++) {
  await new Promise((r) => setTimeout(r, 250));
  files = readdirSync(downloadDir)
    .filter((f) => !f.endsWith('.crdownload'))
    .map((f) => ({ f, size: statSync(join(downloadDir, f)).size }));
}
console.log('DOWNLOADS:', JSON.stringify(files));

console.log('CONSOLE ERRORS:', errors.length ? errors : 'none');

await browser.close();

// Assertions
let ok = true;
if (meta.cote !== '5 MIR 510/2') { console.error('FAIL cote'); ok = false; }
if (meta.vue !== '447') { console.error('FAIL vue'); ok = false; }
if (!meta.lien.includes('ark:/64297/09f7eeee8291e659013ed43af1bc5541')) { console.error('FAIL lien'); ok = false; }
if (!meta.hasImage) { console.error('FAIL image not shown'); ok = false; }
if (!dims.startsWith('3000 × 2341')) { console.error('FAIL dims', dims); ok = false; }
if (!cropEnabled) { console.error('FAIL crop not enabled'); ok = false; }
if (files.length < 2 || files.some((x) => x.size < 1000)) { console.error('FAIL downloads', files); ok = false; }
if (errors.length) { console.error('FAIL console errors'); ok = false; }

console.log(ok ? '\n✅ ALL CHECKS PASSED' : '\n❌ CHECKS FAILED');
process.exit(ok ? 0 : 1);
