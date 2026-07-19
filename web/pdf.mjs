// PDF loading and extraction (text + scan image) via pdf.js.
import * as pdfjs from './vendor/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;

/**
 * Loads a PDF and extracts its concatenated text and one scan per page (the
 * largest image of each page — the others are logos and decorations).
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<{ text: string, images: HTMLCanvasElement[], numPages: number }>}
 */
export async function extractFromPdf(arrayBuffer) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;

  let text = '';
  const images = [];

  for (let p = 1; p <= doc.numPages; p += 1) {
    const page = await doc.getPage(p);

    const tc = await page.getTextContent();
    text += tc.items.map((i) => ('str' in i ? i.str : '')).join(' ') + '\n';

    const canvas = await extractLargestImage(page);
    if (canvas) images.push(canvas);
  }

  return { text, images, numPages: doc.numPages };
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
      continue; // undecodable image, skip it
    }
    const canvas = imgObjectToCanvas(img);
    if (!canvas) continue;
    const area = canvas.width * canvas.height;
    if (!best || area > best.area) best = { canvas, area };
  }
  return best ? best.canvas : null;
}

// Resolves an image object from the page (or document-wide) object store.
// Some objects (e.g. images nested in Form XObjects) are never registered:
// requesting them would hang forever, so unknown names are rejected up front
// and a timeout guards against silent stalls.
function getObj(page, name) {
  const store = page.objs.has(name) ? page.objs
    : page.commonObjs.has(name) ? page.commonObjs
    : null;
  if (!store) return Promise.reject(new Error(`unresolved image object ${name}`));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout resolving ${name}`)), 3000);
    try {
      store.get(name, (obj) => {
        clearTimeout(timer);
        if (obj) resolve(obj); else reject(new Error('null'));
      });
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}

// Normalizes the pdf.js image object (ImageBitmap OR {data,kind}) into a canvas.
function imgObjectToCanvas(img) {
  if (!img) return null;

  // Modern browser case: pdf.js returns an ImageBitmap.
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

  // Raw data case: { width, height, kind, data }.
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
    // 1 bit per pixel, packed per byte, MSB first.
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
