// Coat-of-arms tool: pads an image to a square, centered on a transparent
// background (typical use: Wikipedia coats of arms, e.g. 500×550 -> 550×550).

const $ = (id) => document.getElementById(id);

const drop = $('drop');
const fileInput = $('file');
const statusEl = $('status');
const result = $('result');
const out = $('out');

let baseName = 'image';

function setStatus(msg) { statusEl.textContent = msg; }

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 1800);
}

// "500px-Blason_ville_fr_Servins_62.svg.png" -> "500px-Blason_ville_fr_Servins_62"
function stripExtensions(name) {
  return name.replace(/\.[^.]+$/, '').replace(/\.svg$/i, '');
}

function squarify(bitmap) {
  const size = Math.max(bitmap.width, bitmap.height);
  $('dims').textContent = `${bitmap.width} × ${bitmap.height} px → ${size} × ${size} px`;
  out.width = size;
  out.height = size;
  const ctx = out.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(bitmap, Math.round((size - bitmap.width) / 2), Math.round((size - bitmap.height) / 2));
  bitmap.close();
  $('preview').hidden = false;
  result.hidden = false;
}

async function loadBlob(blob, name) {
  try {
    const bitmap = await createImageBitmap(blob);
    baseName = stripExtensions(name || '') || 'image';
    squarify(bitmap);
    setStatus(`Traité : ${name || 'image collée'}`);
  } catch (err) {
    console.error(err);
    setStatus(`Erreur de lecture de l'image : ${err.message || err}`);
  }
}

async function loadUrl(url) {
  if (!url) return;
  setStatus('Chargement de l\'image…');
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    await loadBlob(blob, name);
  } catch (err) {
    console.error(err);
    setStatus('Impossible de charger cette URL (réseau ou CORS). Téléchargez l\'image puis déposez-la ici.');
  }
}

/* --------------------------------- Export ---------------------------------- */

function toBlobAsync(canvas, mime) {
  return new Promise((resolve) => canvas.toBlob(resolve, mime));
}

$('download').addEventListener('click', async () => {
  const blob = await toBlobAsync(out, 'image/png');
  if (!blob) { toast('Échec de l\'export image'); return; }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${baseName}-carre.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});

$('copy').addEventListener('click', async () => {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
    toast('Copie d\'image non prise en charge par ce navigateur');
    return;
  }
  try {
    // A promise as ClipboardItem value keeps the write inside the user
    // gesture while the PNG is being encoded (required by Safari).
    const blobPromise = toBlobAsync(out, 'image/png').then((b) => {
      if (!b) throw new Error('encoding failed');
      return b;
    });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
    toast('Image copiée dans le presse-papier');
  } catch (err) {
    console.error(err);
    toast('Échec de la copie de l\'image');
  }
});

/* ------------------------- Drag & drop / paste / URL ------------------------ */

$('browse').addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
drop.addEventListener('click', (e) => {
  // Let the URL field and its button behave normally inside the drop zone.
  if (e.target.closest('.urlrow')) return;
  fileInput.click();
});
drop.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target === drop) { e.preventDefault(); fileInput.click(); }
});
fileInput.addEventListener('change', () => {
  const f = fileInput.files[0];
  if (f) loadBlob(f, f.name);
});

['dragenter', 'dragover'].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
['dragleave', 'drop'].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'dragleave' && e.target !== drop) return; drop.classList.remove('drag'); }));
drop.addEventListener('drop', (e) => {
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) loadBlob(f, f.name);
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

window.addEventListener('paste', (e) => {
  for (const item of e.clipboardData?.items || []) {
    if (item.type.startsWith('image/')) {
      const f = item.getAsFile();
      if (f) { loadBlob(f, f.name); return; }
    }
  }
  const text = e.clipboardData?.getData('text/plain')?.trim();
  if (text && /^https?:\/\//.test(text)) {
    $('url').value = text;
    loadUrl(text);
  }
});

$('loadUrl').addEventListener('click', () => loadUrl($('url').value.trim()));
$('url').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); loadUrl($('url').value.trim()); }
});
