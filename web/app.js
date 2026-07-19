import { extractFromPdf } from './pdf.mjs';
import { parseArchiveText } from './parse.mjs';

const $ = (id) => document.getElementById(id);

const drop = $('drop');
const fileInput = $('file');
const statusEl = $('status');
const results = $('results');

const displayCanvas = $('display');
const overlay = $('overlay');
const viewer = $('viewer');

let sourceCanvas = null; // canvas pleine résolution (source de vérité)
let meta = { cote: null, vue: null, lien: null };
let selection = null; // en coordonnées SOURCE: {x, y, w, h}
const view = { scale: 1, tx: 0, ty: 0 }; // transformation source -> écran
let fitScale = 1; // échelle « ajustée à la zone », référence pour le zoom min

/* ------------------------- Chargement du fichier ------------------------- */

async function handleFile(file) {
  if (!file) return;
  if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    setStatus(`« ${file.name} » n'est pas un PDF.`);
    return;
  }
  setStatus(`Lecture de « ${file.name} »…`);
  try {
    const buf = await file.arrayBuffer();
    const { text, image } = await extractFromPdf(buf);

    meta = parseArchiveText(text);
    fillMeta(meta);

    // La colonne de droite n'est montrée que si une image a été extraite.
    // (avant showImage : sa visibilité change la largeur de la zone damier)
    results.hidden = !image;

    if (image) {
      sourceCanvas = image;
      showImage(image);
    } else {
      sourceCanvas = null;
      viewer.hidden = true;
      $('imgtools').hidden = true;
      $('noimage').hidden = false;
    }

    setStatus(`Traité : ${file.name}`);
  } catch (err) {
    console.error(err);
    setStatus(`Erreur de lecture du PDF : ${err.message || err}`);
  }
}

function setStatus(msg) { statusEl.textContent = msg; }

function fillMeta({ cote, vue, lien }) {
  $('cote').value = cote || '';
  $('vue').value = vue || '';
  $('lien').value = lien || '';
}

/* ------------------------------- Image ---------------------------------- */

const stage = document.querySelector('.stage');
const MAX_SCALE = 8; // zoom max : 8 px écran par px source

function showImage(canvas) {
  $('noimage').hidden = true;
  viewer.hidden = false;
  $('imgtools').hidden = false;

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

// Ajuste l'image à la zone (zoom initial), centrée.
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

// Garde toujours une partie de l'image visible dans la zone.
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

/* --------------------- Coordonnées écran <-> source ---------------------- */

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

/* ---------------------- Zoom / déplacement de l'image -------------------- */

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
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceHeld = false; });

/* ------------------------ Sélection / rognage --------------------------- */

const HANDLE = 7; // demi-taille (px écran) de la zone de saisie des poignées
const SEL_COLOR = '#ff3d00'; // orange vif, lisible sur les scans noir et blanc
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

function hitTest(p) {
  if (selection && selection.w > 0 && selection.h > 0) {
    const r = toScreenRect(selection);
    for (const h of handlePositions(r)) {
      if (Math.abs(p.x - h.x) <= HANDLE && Math.abs(p.y - h.y) <= HANDLE) return { type: 'resize', handle: h.id };
    }
    if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return { type: 'move' };
  }
  return { type: 'draw' };
}

overlay.addEventListener('pointerdown', (e) => {
  if (!sourceCanvas) return;
  overlay.setPointerCapture(e.pointerId);
  const p = screenPoint(e);

  if (e.button === 1 || e.ctrlKey || e.metaKey || spaceHeld) {
    action = { type: 'pan', start: p, startView: { tx: view.tx, ty: view.ty } };
    overlay.style.cursor = 'grabbing';
  } else {
    const hit = hitTest(p);
    if (hit.type === 'resize') {
      action = { type: 'resize', handle: hit.handle, start: p, startSel: { ...selection } };
    } else if (hit.type === 'move') {
      action = { type: 'move', start: p, startSel: { ...selection } };
    } else {
      action = { type: 'draw', startSrc: toSource(p) };
      selection = null;
      updateCropButtons();
      drawOverlay();
    }
  }
  // Bloque l'autoscroll du clic molette (préserver les clics/dblclics sinon).
  if (e.button === 1) e.preventDefault();
});

overlay.addEventListener('pointermove', (e) => {
  const p = screenPoint(e);

  if (!action) {
    // Simple survol : adapte le curseur à ce qui se trouve sous la souris.
    if (!sourceCanvas) return;
    const hit = hitTest(p);
    overlay.style.cursor = spaceHeld ? 'grab'
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
    selection = normRect(clampPt(action.startSrc), clampPt(toSource(p)));
  } else if (action.type === 'move') {
    const s = action.startSel;
    const dx = (p.x - action.start.x) / view.scale;
    const dy = (p.y - action.start.y) / view.scale;
    selection = {
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
    selection = normRect(clampPt({ x: x1, y: y1 }), clampPt({ x: x2, y: y2 }));
  }
  drawOverlay();
  updateCropButtons();
});

overlay.addEventListener('pointerup', () => {
  if (action && action.type !== 'pan' && selection && (selection.w < 4 || selection.h < 4)) selection = null;
  action = null;
  overlay.style.cursor = 'crosshair';
  drawOverlay();
  updateCropButtons();
});

function drawOverlay() {
  const ctx = overlay.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!selection || selection.w <= 0 || selection.h <= 0) return;

  const img = toScreenRect({ x: 0, y: 0, w: sourceCanvas.width, h: sourceCanvas.height });
  const r = toScreenRect(selection);

  // Assombrit l'image hors sélection.
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(img.x, img.y, img.w, img.h);
  ctx.clearRect(r.x, r.y, r.w, r.h);

  // Cadre : liseré blanc sous un trait orange vif, pour rester visible partout.
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  ctx.lineWidth = 2;
  ctx.strokeStyle = SEL_COLOR;
  ctx.strokeRect(r.x, r.y, r.w, r.h);

  // Poignées de redimensionnement.
  for (const h of handlePositions(r)) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(h.x - 5, h.y - 5, 10, 10);
    ctx.lineWidth = 2;
    ctx.strokeStyle = SEL_COLOR;
    ctx.strokeRect(h.x - 5, h.y - 5, 10, 10);
  }
}

function clearSelection() {
  selection = null;
  drawOverlay();
  updateCropButtons();
}

function updateCropButtons() {
  const has = !!(selection && selection.w >= 4 && selection.h >= 4);
  $('dlCrop').disabled = !has;
  $('clearSel').disabled = !has;
}

/* ------------------------------ Téléchargement -------------------------- */

function baseFilename() {
  const cote = (meta.cote || 'archive').toLowerCase().replace(/\s+/g, '_').replace(/\//g, '-').replace(/[^a-z0-9_-]/g, '');
  const vue = meta.vue ? `_vue${meta.vue}` : '';
  return `${cote}${vue}`;
}

function download(canvas, suffix) {
  const fmt = $('format').value;
  const mime = fmt === 'png' ? 'image/png' : 'image/jpeg';
  const ext = fmt === 'png' ? 'png' : 'jpg';
  canvas.toBlob((blob) => {
    if (!blob) { toast('Échec de l\'export image'); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseFilename()}${suffix}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, mime, fmt === 'png' ? undefined : 0.95);
}

$('dlFull').addEventListener('click', () => {
  if (!sourceCanvas) return;
  download(sourceCanvas, '');
});

$('dlCrop').addEventListener('click', () => {
  if (!sourceCanvas || !selection) return;
  const s = selection;
  const c = document.createElement('canvas');
  c.width = Math.round(s.w);
  c.height = Math.round(s.h);
  c.getContext('2d').drawImage(
    sourceCanvas,
    Math.round(s.x), Math.round(s.y), Math.round(s.w), Math.round(s.h),
    0, 0, c.width, c.height,
  );
  download(c, '_crop');
});

$('clearSel').addEventListener('click', clearSelection);

/* ------------------------------ Copie ----------------------------------- */

async function copyText(text) {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Repli pour contextes non sécurisés.
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
  if (meta.cote) lines.push(`Côte: ${meta.cote}`);
  if (meta.vue) lines.push(`Vue: ${meta.vue}`);
  if (meta.lien) lines.push(`Lien: ${meta.lien}`);
  if (!lines.length) { toast('Rien à copier'); return; }
  if (await copyText(lines.join('\n'))) toast('Informations copiées');
  else toast('Copie impossible');
});

/* ------------------------------ Toast ----------------------------------- */

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 1800);
}

/* ------------------------- Drag & drop / input -------------------------- */

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

// Empêche le navigateur d'ouvrir un PDF déposé à côté de la zone.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());
