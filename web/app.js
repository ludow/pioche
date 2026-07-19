import { extractFromPdf } from './pdf.mjs';
import { parseArchiveText, parseImageFilename } from './parse.mjs';

const $ = (id) => document.getElementById(id);

const drop = $('drop');
const fileInput = $('file');
const statusEl = $('status');
const results = $('results');

const displayCanvas = $('display');
const overlay = $('overlay');
const viewer = $('viewer');

let sourceCanvas = null; // full-resolution canvas (source of truth)
let meta = { reference: null, viewNumber: null, link: null };
// Selected zones in SOURCE coordinates [{x, y, w, h}, ...], in drawing order
// (= assembly order). Several zones capture an act split across columns.
let selections = [];
let activeSel = -1; // index of the zone being edited, -1 when none
const view = { scale: 1, tx: 0, ty: 0 }; // source -> screen transform
let fitScale = 1; // "fit to area" scale, reference point for the minimum zoom

/* ------------------------------ File loading ----------------------------- */

function isPdfFile(file) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function isImageFile(file) {
  return (file.type && file.type.startsWith('image/'))
    || /\.(jpe?g|png|webp|gif|bmp)$/i.test(file.name);
}

// Decodes an image file into a full-resolution canvas.
async function imageFileToCanvas(file) {
  const bitmap = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = bitmap.width;
  c.height = bitmap.height;
  c.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  return c;
}

async function handleFile(file) {
  if (!file) return;
  if (!isPdfFile(file) && !isImageFile(file)) {
    setStatus(`« ${file.name} » n'est ni un PDF ni une image.`);
    return;
  }
  setStatus(`Lecture de « ${file.name} »…`);
  try {
    let image;
    if (isPdfFile(file)) {
      // AD62 PDF: metadata comes from the embedded text.
      const extracted = await extractFromPdf(await file.arrayBuffer());
      image = extracted.image;
      meta = parseArchiveText(extracted.text);
    } else {
      // Plain image: metadata comes from the filename, when the provenance
      // (Aisne, Nord) is recognized; empty fields otherwise.
      image = await imageFileToCanvas(file);
      meta = parseImageFilename(file.name);
    }
    fillMeta(meta);

    // The right column is only shown when an image was extracted.
    // (before showImage: its visibility changes the checkerboard area width)
    results.hidden = !image;

    if (image) {
      sourceCanvas = image;
      showImage(image);
    } else {
      sourceCanvas = null;
      viewer.hidden = true;
      $('noimage').hidden = false;
    }

    setStatus(`Traité : ${file.name}`);
  } catch (err) {
    console.error(err);
    setStatus(`Erreur de lecture du fichier : ${err.message || err}`);
  }
}

function setStatus(msg) { statusEl.textContent = msg; }

function fillMeta({ reference, viewNumber, link }) {
  $('reference').value = reference || '';
  $('viewNumber').value = viewNumber || '';
  $('link').value = link || '';
}

/* --------------------------------- Image --------------------------------- */

const stage = document.querySelector('.stage');
const MAX_SCALE = 8; // max zoom: 8 screen px per source px

function showImage(canvas) {
  $('noimage').hidden = true;
  viewer.hidden = false;

  resizeCanvases();
  fitView();
  clearSelection();
  $('dims').textContent = `${canvas.width} × ${canvas.height} px`;
}

window.addEventListener('resize', () => {
  if (!sourceCanvas || viewer.hidden) return;
  resizeCanvases();
  fitView();
});

function resizeCanvases() {
  displayCanvas.width = stage.clientWidth;
  displayCanvas.height = stage.clientHeight;
  overlay.width = stage.clientWidth;
  overlay.height = stage.clientHeight;
}

// Fits the image to the area (initial zoom), centered.
function fitView() {
  const margin = 32;
  fitScale = Math.min(
    1,
    (overlay.width - margin) / sourceCanvas.width,
    (overlay.height - margin) / sourceCanvas.height,
  );
  view.scale = fitScale;
  view.tx = (overlay.width - sourceCanvas.width * fitScale) / 2;
  view.ty = (overlay.height - sourceCanvas.height * fitScale) / 2;
  drawAll();
}

// Always keeps part of the image visible in the area.
function clampView() {
  const m = 80;
  const iw = sourceCanvas.width * view.scale;
  const ih = sourceCanvas.height * view.scale;
  view.tx = Math.min(overlay.width - m, Math.max(m - iw, view.tx));
  view.ty = Math.min(overlay.height - m, Math.max(m - ih, view.ty));
}

function drawAll() {
  const ctx = displayCanvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.setTransform(view.scale, 0, 0, view.scale, view.tx, view.ty);
  ctx.drawImage(sourceCanvas, 0, 0);
  drawOverlay();
}

/* ---------------------- Screen <-> source coordinates --------------------- */

function screenPoint(e) {
  const r = overlay.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function toSource(p) {
  return { x: (p.x - view.tx) / view.scale, y: (p.y - view.ty) / view.scale };
}

function toScreenRect(s) {
  return { x: s.x * view.scale + view.tx, y: s.y * view.scale + view.ty, w: s.w * view.scale, h: s.h * view.scale };
}

function clampPt(p) {
  return {
    x: Math.max(0, Math.min(p.x, sourceCanvas.width)),
    y: Math.max(0, Math.min(p.y, sourceCanvas.height)),
  };
}

function normRect(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

/* -------------------------- Image zoom / panning -------------------------- */

overlay.addEventListener('wheel', (e) => {
  if (!sourceCanvas || viewer.hidden) return;
  e.preventDefault();
  const p = screenPoint(e);
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  const newScale = Math.max(fitScale * 0.2, Math.min(MAX_SCALE, view.scale * factor));
  const f = newScale / view.scale;
  view.tx = p.x - (p.x - view.tx) * f;
  view.ty = p.y - (p.y - view.ty) * f;
  view.scale = newScale;
  clampView();
  drawAll();
}, { passive: false });

overlay.addEventListener('dblclick', () => {
  if (!sourceCanvas) return;
  fitView();
});

let spaceHeld = false;
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target === document.body) { spaceHeld = true; e.preventDefault(); }
  // Delete the active zone (only when focus is not in a form field).
  if ((e.key === 'Delete' || e.key === 'Backspace') && e.target === document.body && activeSel >= 0) {
    e.preventDefault();
    deleteZone(activeSel);
  }
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceHeld = false; });

/* --------------------------- Selection / cropping -------------------------- */

const HANDLE = 7; // half-size (screen px) of the handle hit area
const SEL_COLOR = '#ff3d00'; // bright orange, readable on black-and-white scans
const RESIZE_CURSORS = {
  nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize', w: 'ew-resize', e: 'ew-resize',
};

let action = null; // { type: 'draw'|'move'|'resize'|'pan', ... }

function handlePositions(r) {
  return [
    { id: 'nw', x: r.x, y: r.y }, { id: 'n', x: r.x + r.w / 2, y: r.y }, { id: 'ne', x: r.x + r.w, y: r.y },
    { id: 'w', x: r.x, y: r.y + r.h / 2 }, { id: 'e', x: r.x + r.w, y: r.y + r.h / 2 },
    { id: 'sw', x: r.x, y: r.y + r.h }, { id: 's', x: r.x + r.w / 2, y: r.y + r.h }, { id: 'se', x: r.x + r.w, y: r.y + r.h },
  ];
}

// Delete button (✕) of a zone: a small box inside its top-right corner,
// offset so it never overlaps the corner/top resize handles.
function deleteButtonRect(r) {
  return { x: r.x + r.w - 26, y: r.y + 6, w: 20, h: 20 };
}

function zoneFitsDeleteButton(r) {
  return r.w >= 34 && r.h >= 32;
}

function hitTest(p) {
  const inRect = (r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  for (let i = selections.length - 1; i >= 0; i -= 1) {
    const r = toScreenRect(selections[i]);
    if (zoneFitsDeleteButton(r) && inRect(deleteButtonRect(r))) return { type: 'delete', index: i };
  }
  // Handles are only shown (and grabbable) on the active zone.
  const active = selections[activeSel];
  if (active && active.w > 0 && active.h > 0) {
    const r = toScreenRect(active);
    for (const h of handlePositions(r)) {
      if (Math.abs(p.x - h.x) <= HANDLE && Math.abs(p.y - h.y) <= HANDLE) return { type: 'resize', handle: h.id };
    }
  }
  for (let i = selections.length - 1; i >= 0; i -= 1) {
    if (inRect(toScreenRect(selections[i]))) return { type: 'move', index: i };
  }
  return { type: 'draw' };
}

function deleteZone(i) {
  selections.splice(i, 1);
  if (activeSel === i) activeSel = selections.length - 1;
  else if (activeSel > i) activeSel -= 1;
  drawOverlay();
  updateCropButtons();
}

overlay.addEventListener('pointerdown', (e) => {
  if (!sourceCanvas) return;
  overlay.setPointerCapture(e.pointerId);
  const p = screenPoint(e);

  if (e.button === 1 || e.ctrlKey || e.metaKey || spaceHeld) {
    action = { type: 'pan', start: p, startView: { tx: view.tx, ty: view.ty } };
    overlay.style.cursor = 'grabbing';
  } else {
    const hit = e.shiftKey ? { type: 'draw' } : hitTest(p);
    if (hit.type === 'delete') {
      deleteZone(hit.index);
      return;
    }
    if (hit.type === 'resize') {
      action = { type: 'resize', handle: hit.handle, start: p, startSel: { ...selections[activeSel] } };
    } else if (hit.type === 'move') {
      activeSel = hit.index;
      action = { type: 'move', start: p, startSel: { ...selections[activeSel] } };
    } else {
      // Plain drag replaces the selection; Shift+drag adds a zone to it.
      action = { type: 'draw', startSrc: toSource(p) };
      if (!e.shiftKey) selections = [];
      selections.push({ x: 0, y: 0, w: 0, h: 0 });
      activeSel = selections.length - 1;
      updateCropButtons();
      drawOverlay();
    }
  }
  // Blocks middle-click autoscroll (preserve clicks/double-clicks otherwise).
  if (e.button === 1) e.preventDefault();
});

overlay.addEventListener('pointermove', (e) => {
  const p = screenPoint(e);

  if (!action) {
    // Plain hover: match the cursor to whatever is under the mouse.
    if (!sourceCanvas) return;
    const hit = hitTest(p);
    overlay.style.cursor = spaceHeld ? 'grab'
      : hit.type === 'delete' ? 'pointer'
      : hit.type === 'resize' ? RESIZE_CURSORS[hit.handle]
      : hit.type === 'move' ? 'move'
      : 'crosshair';
    return;
  }

  if (action.type === 'pan') {
    view.tx = action.startView.tx + (p.x - action.start.x);
    view.ty = action.startView.ty + (p.y - action.start.y);
    clampView();
    drawAll();
    return;
  }

  if (action.type === 'draw') {
    selections[activeSel] = normRect(clampPt(action.startSrc), clampPt(toSource(p)));
  } else if (action.type === 'move') {
    const s = action.startSel;
    const dx = (p.x - action.start.x) / view.scale;
    const dy = (p.y - action.start.y) / view.scale;
    selections[activeSel] = {
      x: Math.max(0, Math.min(s.x + dx, sourceCanvas.width - s.w)),
      y: Math.max(0, Math.min(s.y + dy, sourceCanvas.height - s.h)),
      w: s.w,
      h: s.h,
    };
  } else if (action.type === 'resize') {
    const s = action.startSel;
    const dx = (p.x - action.start.x) / view.scale;
    const dy = (p.y - action.start.y) / view.scale;
    let x1 = s.x, y1 = s.y, x2 = s.x + s.w, y2 = s.y + s.h;
    if (action.handle.includes('w')) x1 += dx;
    if (action.handle.includes('e')) x2 += dx;
    if (action.handle.includes('n')) y1 += dy;
    if (action.handle.includes('s')) y2 += dy;
    selections[activeSel] = normRect(clampPt({ x: x1, y: y1 }), clampPt({ x: x2, y: y2 }));
  }
  drawOverlay();
  updateCropButtons();
});

overlay.addEventListener('pointerup', () => {
  if (action && action.type !== 'pan') {
    // Discard the edited zone when it collapsed below a usable size.
    const s = selections[activeSel];
    if (s && (s.w < 4 || s.h < 4)) {
      selections.splice(activeSel, 1);
      activeSel = selections.length - 1;
    }
  }
  action = null;
  overlay.style.cursor = 'crosshair';
  drawOverlay();
  updateCropButtons();
});

function drawOverlay() {
  const ctx = overlay.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  const zones = selections.filter((s) => s.w > 0 && s.h > 0);
  if (!zones.length) return;

  const img = toScreenRect({ x: 0, y: 0, w: sourceCanvas.width, h: sourceCanvas.height });

  // Darkens the image outside the zones.
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(img.x, img.y, img.w, img.h);
  for (const s of zones) {
    const r = toScreenRect(s);
    ctx.clearRect(r.x, r.y, r.w, r.h);
  }

  selections.forEach((s, i) => {
    if (s.w <= 0 || s.h <= 0) return;
    const r = toScreenRect(s);
    const isActive = i === activeSel;

    // Frame: white edging under a bright orange stroke, to stay visible
    // everywhere. Inactive zones get a thinner frame and no handles.
    ctx.lineWidth = isActive ? 4 : 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.lineWidth = isActive ? 2 : 1;
    ctx.strokeStyle = SEL_COLOR;
    ctx.strokeRect(r.x, r.y, r.w, r.h);

    if (isActive) {
      // Resize handles.
      for (const h of handlePositions(r)) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(h.x - 5, h.y - 5, 10, 10);
        ctx.lineWidth = 2;
        ctx.strokeStyle = SEL_COLOR;
        ctx.strokeRect(h.x - 5, h.y - 5, 10, 10);
      }
    }

    // Number badge showing the assembly order, once there are several zones.
    if (selections.length > 1) {
      ctx.fillStyle = SEL_COLOR;
      ctx.fillRect(r.x, r.y, 20, 20);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), r.x + 10, r.y + 11);
    }

    // Delete button (✕), skipped when the zone is too small to host it.
    if (zoneFitsDeleteButton(r)) {
      const d = deleteButtonRect(r);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fillRect(d.x, d.y, d.w, d.h);
      ctx.lineWidth = 1;
      ctx.strokeStyle = SEL_COLOR;
      ctx.strokeRect(d.x + 0.5, d.y + 0.5, d.w - 1, d.h - 1);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(d.x + 6, d.y + 6);
      ctx.lineTo(d.x + d.w - 6, d.y + d.h - 6);
      ctx.moveTo(d.x + d.w - 6, d.y + 6);
      ctx.lineTo(d.x + 6, d.y + d.h - 6);
      ctx.stroke();
    }
  });
}

function clearSelection() {
  selections = [];
  activeSel = -1;
  drawOverlay();
  updateCropButtons();
}

function validZones() {
  return selections.filter((s) => s.w >= 4 && s.h >= 4);
}

function updateCropButtons() {
  const has = validZones().length > 0;
  $('dlCrop').disabled = !has;
  $('clearSel').disabled = !has;
  // The assembly direction only matters with several zones.
  $('assemblyWrap').hidden = selections.length < 2;
}

/* -------------------------------- Download -------------------------------- */

// Strips accents then replaces any character outside `keep` with `sep`
// (repeats collapsed, leading/trailing separators removed).
function cleanPart(value, keep, sep) {
  const flat = (value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  return flat
    .replace(keep, sep)
    .replace(new RegExp(`\\${sep}{2,}`, 'g'), sep)
    .replace(new RegExp(`^\\${sep}+|\\${sep}+$`, 'g'), '');
}

function baseFilename() {
  const reference = (meta.reference || 'archive').toLowerCase().replace(/\s+/g, '_').replace(/\//g, '-').replace(/[^a-z0-9_-]/g, '');
  const viewPart = meta.viewNumber ? `_vue${meta.viewNumber}` : '';
  return `${reference}${viewPart}`;
}

// Selection filename:
// PlaceCode_PlaceName_Date_ActCode_Individuals_Reference_View
// e.g. 59_Hazebrouck_17670114_MA_WERREBROUCK_Pierre_x_VERLEY_Marie_5-Mi-035-R-020_191D
function cropFilename() {
  const parts = [
    cleanPart($('placeCode').value, /[^0-9A-Za-z_-]+/g, '-'),
    cleanPart($('placeName').value, /[^0-9A-Za-z_-]+/g, '-'),
    cleanPart($('actDate').value, /[^0-9A-Za-z_-]+/g, '-'),
    cleanPart($('actCode').value, /[^0-9A-Za-z_-]+/g, '-'),
    cleanPart($('individuals').value, /[^0-9A-Za-z_]+/g, '_'), // alphanumeric + underscore only
    cleanPart($('reference').value, /[^0-9A-Za-z]+/g, '-'), // everything else becomes a dash
    cleanPart($('viewNumber').value, /[^0-9A-Za-z]+/g, '-'),
  ].filter(Boolean);
  return parts.length ? parts.join('_') : baseFilename();
}

function toBlobAsync(canvas, mime, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
}

async function download(canvas, name) {
  const fmt = $('format').value;
  const mime = fmt === 'png' ? 'image/png' : 'image/jpeg';
  const ext = fmt === 'png' ? 'png' : 'jpg';
  const filename = `${name}.${ext}`;
  const quality = fmt === 'png' ? undefined : 0.95;

  // Lets the user pick a location when the browser allows it (Chrome/Edge).
  // The picker must open during the user gesture, hence before encoding.
  if (window.showSaveFilePicker) {
    let handle = null;
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: fmt === 'png' ? 'Image PNG' : 'Image JPEG',
          accept: { [mime]: [`.${ext}`] },
        }],
      });
    } catch (err) {
      if (err && err.name === 'AbortError') return; // cancelled by the user
      handle = null; // unavailable => fall back to a classic download
    }
    if (handle) {
      const blob = await toBlobAsync(canvas, mime, quality);
      if (!blob) { toast('Échec de l\'export image'); return; }
      try {
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        toast('Image enregistrée');
      } catch {
        toast('Échec de l\'enregistrement');
      }
      return;
    }
  }

  // Fallback: classic download into the default folder.
  const blob = await toBlobAsync(canvas, mime, quality);
  if (!blob) { toast('Échec de l\'export image'); return; }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

$('dlFull').addEventListener('click', () => {
  if (!sourceCanvas) return;
  download(sourceCanvas, baseFilename());
});

// Assembles the zones into a single canvas, in drawing order (= reading order
// of the act): stacked vertically or laid out side by side. With one zone this
// is a plain crop.
function composeZones(zones) {
  const rects = zones.map((s) => ({
    x: Math.round(s.x), y: Math.round(s.y), w: Math.round(s.w), h: Math.round(s.h),
  }));
  const vertical = $('assembly').value !== 'horizontal';
  const c = document.createElement('canvas');
  c.width = vertical ? Math.max(...rects.map((r) => r.w)) : rects.reduce((sum, r) => sum + r.w, 0);
  c.height = vertical ? rects.reduce((sum, r) => sum + r.h, 0) : Math.max(...rects.map((r) => r.h));
  const ctx = c.getContext('2d');
  // White filler where zone sizes differ.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  let offset = 0;
  for (const r of rects) {
    ctx.drawImage(sourceCanvas, r.x, r.y, r.w, r.h, vertical ? 0 : offset, vertical ? offset : 0, r.w, r.h);
    offset += vertical ? r.h : r.w;
  }
  return c;
}

$('dlCrop').addEventListener('click', () => {
  const zones = validZones();
  if (!sourceCanvas || !zones.length) return;
  download(composeZones(zones), cropFilename());
});

$('clearSel').addEventListener('click', clearSelection);

/* ---------------------------------- Copy ---------------------------------- */

async function copyText(text) {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

document.querySelectorAll('.copy').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const val = $(btn.dataset.target).value;
    if (!val) { toast('Rien à copier'); return; }
    if (await copyText(val)) {
      btn.classList.add('done');
      const old = btn.innerHTML;
      btn.innerHTML = '✓';
      setTimeout(() => { btn.classList.remove('done'); btn.innerHTML = old; }, 1200);
    } else {
      toast('Copie impossible');
    }
  });
});

$('copyAll').addEventListener('click', async () => {
  const lines = [];
  const push = (label, id) => { const v = $(id).value.trim(); if (v) lines.push(`${label}: ${v}`); };
  push('Côte', 'reference');
  push('Vue', 'viewNumber');
  push('Code Lieu', 'placeCode');
  push('Libellé Lieu', 'placeName');
  push('Date', 'actDate');
  push('Code Acte', 'actCode');
  push('Individus', 'individuals');
  push('Lien', 'link');
  if (!lines.length) { toast('Rien à copier'); return; }
  if (await copyText(lines.join('\n'))) toast('Informations copiées');
  else toast('Copie impossible');
});

/* ---------------------------------- Toast --------------------------------- */

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 1800);
}

/* --------------------------- Drag & drop / input --------------------------- */

$('browse').addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
drop.addEventListener('click', () => fileInput.click());
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));

['dragenter', 'dragover'].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
['dragleave', 'drop'].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'dragleave' && e.target !== drop) return; drop.classList.remove('drag'); }));
drop.addEventListener('drop', (e) => {
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) handleFile(f);
});

// Prevents the browser from opening a PDF dropped next to the drop zone.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());
