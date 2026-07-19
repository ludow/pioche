// Chargement du PDF et extraction (texte + image de scan) via pdf.js.
import * as pdfjs from './vendor/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;

/**
 * Charge un PDF et en extrait le texte concaténé et la plus grande image (le scan).
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<{ text: string, image: HTMLCanvasElement|null, numPages: number }>}
 */
export async function extractFromPdf(arrayBuffer) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;

  let text = '';
  let biggest = null; // { canvas, area }

  for (let p = 1; p <= doc.numPages; p += 1) {
    const page = await doc.getPage(p);

    const tc = await page.getTextContent();
    text += tc.items.map((i) => ('str' in i ? i.str : '')).join(' ') + '\n';

    const canvas = await extractLargestImage(page);
    if (canvas) {
      const area = canvas.width * canvas.height;
      if (!biggest || area > biggest.area) biggest = { canvas, area };
    }
  }

  return { text, image: biggest ? biggest.canvas : null, numPages: doc.numPages };
}

async function extractLargestImage(page) {
  const ops = await page.getOperatorList();
  const { OPS } = pdfjs;

  const names = [];
  for (let i = 0; i < ops.fnArray.length; i += 1) {
    const fn = ops.fnArray[i];
    if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
      names.push(ops.argsArray[i][0]);
    }
  }

  let best = null;
  for (const name of names) {
    let img;
    try {
      img = await getObj(page, name);
    } catch {
      continue; // image non décodable, on ignore
    }
    const canvas = imgObjectToCanvas(img);
    if (!canvas) continue;
    const area = canvas.width * canvas.height;
    if (!best || area > best.area) best = { canvas, area };
  }
  return best ? best.canvas : null;
}

function getObj(page, name) {
  return new Promise((resolve, reject) => {
    try {
      page.objs.get(name, (obj) => (obj ? resolve(obj) : reject(new Error('null'))));
    } catch (e) {
      reject(e);
    }
  });
}

// Normalise l'objet image de pdf.js (ImageBitmap OU {data,kind}) vers un canvas.
function imgObjectToCanvas(img) {
  if (!img) return null;

  // Cas navigateur moderne: pdf.js renvoie un ImageBitmap.
  if (img.bitmap) {
    const c = document.createElement('canvas');
    c.width = img.bitmap.width;
    c.height = img.bitmap.height;
    c.getContext('2d').drawImage(img.bitmap, 0, 0);
    return c;
  }
  if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    return c;
  }

  // Cas données brutes: { width, height, kind, data }.
  const { width, height, kind, data } = img;
  if (!width || !height || !data) return null;

  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  const out = ctx.createImageData(width, height);
  const rgba = out.data;

  // pdf.js ImageKind: 1 = GRAYSCALE_1BPP, 2 = RGB_24BPP, 3 = RGBA_32BPP.
  if (kind === 3) {
    rgba.set(data.subarray(0, rgba.length));
  } else if (kind === 2) {
    for (let i = 0, j = 0; i < width * height; i += 1) {
      rgba[j++] = data[i * 3];
      rgba[j++] = data[i * 3 + 1];
      rgba[j++] = data[i * 3 + 2];
      rgba[j++] = 255;
    }
  } else if (kind === 1) {
    // 1 bit par pixel, empaqueté par octet, MSB en premier.
    const rowBytes = (width + 7) >> 3;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const byte = data[y * rowBytes + (x >> 3)];
        const bit = (byte >> (7 - (x & 7))) & 1;
        const v = bit ? 255 : 0;
        const j = (y * width + x) * 4;
        rgba[j] = rgba[j + 1] = rgba[j + 2] = v;
        rgba[j + 3] = 255;
      }
    }
  } else {
    return null;
  }

  ctx.putImageData(out, 0, 0);
  return c;
}
