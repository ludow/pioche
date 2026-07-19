#!/usr/bin/env node

/**
 * Assemble des tuiles des archives du Pas-de-Calais via genereImage.html.
 *
 * Exemples:
 * node pdc_tile_stitcher.mjs \
 *   --image /mnt/lustre/ad62/etat_civil_registres_3/510/frad062_3e_510_105/frad062_3e_510_105_0064.jpg \
 *   --view 64 \
 *   --output vue64_complete.jpg
 *
 * node pdc_tile_stitcher.mjs \
 *   --cote "3 E 510/105" \
 *   --view 64 \
 *   --output vue64_complete.jpg
 *
 * node pdc_tile_stitcher.mjs \
 *   --img-url "https://archivesenligne.pasdecalais.fr/v2/images/genereImage.html?r=0&n=0&b=0&c=0&o=IMG&id=visu_image_100&image=%2Fmnt%2Flustre%2F..." \
 *   --output vue100_complete.jpg
 */

import sharp from 'sharp';

const DEFAULTS = {
  baseUrl: 'https://archivesenligne.pasdecalais.fr',
  tileL: 891,
  tileH: 891,
  ol: 1080,
  oh: 1080,
  cropX: 0,
  cropY: 0,
  delay: 50,
  timeout: 20000,
  retries: 3,
};

function usage() {
  console.log(`
Usage:
  node pdc_tile_stitcher.mjs --image <path> --view <num> --output <file> [options]
  node pdc_tile_stitcher.mjs --cote "3 E 510/105" --view <num> --output <file> [options]
  node pdc_tile_stitcher.mjs --img-url <genereImage_o=IMG_url> --output <file> [options]

Required:
  (aucun argument strictement obligatoire)

One of these input modes:
  --image <path>             Chemin source cote serveur (/mnt/lustre/...jpg)
  --cote "3 E 510/105"       Cote lisible (tentative de construction auto)
  --img-url <url>            URL genereImage o=IMG (image+vue extraites)

View:
  --view <num>               Numero de vue (ex: 64), obligatoire sauf si present dans --img-url

Optional for --cote mode:
  --image-suffix <str>       Suffixe exact avant .jpg (ex: 0023a076)

Options:
  --base-url <url>           Defaut: ${DEFAULTS.baseUrl}
  --tile-l <int>             Defaut: ${DEFAULTS.tileL}
  --tile-h <int>             Defaut: ${DEFAULTS.tileH}
  --ol <int>                 Defaut: ${DEFAULTS.ol}
  --oh <int>                 Defaut: ${DEFAULTS.oh}
  --full-width <int>         Force la largeur source totale
  --full-height <int>        Force la hauteur source totale
  --half <left|right|top|bottom>
  --crop-width <int>         Largeur source a extraire
  --crop-height <int>        Hauteur source a extraire
  --crop-x <int>             Defaut: ${DEFAULTS.cropX}
  --crop-y <int>             Defaut: ${DEFAULTS.cropY}
  --delay <ms>               Pause entre requetes (defaut: ${DEFAULTS.delay})
  --timeout <ms>             Timeout HTTP (defaut: ${DEFAULTS.timeout})
  --retries <int>            Defaut: ${DEFAULTS.retries}
  --show-urls <0|1>          Affiche les URL generees (defaut: 1)
  -h, --help                 Aide
`);
}

function parseArgs(argv) {
  const args = { ...DEFAULTS, showUrls: 1 };

  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '-h' || k === '--help') {
      args.help = true;
      continue;
    }

    if (!k.startsWith('--')) {
      throw new Error(`Argument inattendu: ${k}`);
    }

    const v = argv[i + 1];
    if (v == null || v.startsWith('--')) {
      throw new Error(`Valeur manquante pour ${k}`);
    }
    i += 1;

    switch (k) {
      case '--base-url': args.baseUrl = v; break;
      case '--image': args.image = v; break;
      case '--cote': args.cote = v; break;
      case '--img-url': args.imgUrl = v; break;
      case '--image-suffix': args.imageSuffix = v; break;
      case '--view': args.view = Number.parseInt(v, 10); break;
      case '--tile-l': args.tileL = Number.parseInt(v, 10); break;
      case '--tile-h': args.tileH = Number.parseInt(v, 10); break;
      case '--ol': args.ol = Number.parseInt(v, 10); break;
      case '--oh': args.oh = Number.parseInt(v, 10); break;
      case '--full-width': args.fullWidth = Number.parseInt(v, 10); break;
      case '--full-height': args.fullHeight = Number.parseInt(v, 10); break;
      case '--half': args.half = v; break;
      case '--crop-width': args.cropWidth = Number.parseInt(v, 10); break;
      case '--crop-height': args.cropHeight = Number.parseInt(v, 10); break;
      case '--crop-x': args.cropX = Number.parseInt(v, 10); break;
      case '--crop-y': args.cropY = Number.parseInt(v, 10); break;
      case '--output': args.output = v; break;
      case '--delay': args.delay = Number.parseInt(v, 10); break;
      case '--timeout': args.timeout = Number.parseInt(v, 10); break;
      case '--retries': args.retries = Number.parseInt(v, 10); break;
      case '--show-urls': args.showUrls = Number.parseInt(v, 10); break;
      default:
        throw new Error(`Option inconnue: ${k}`);
    }
  }

  return args;
}

function padView(view) {
  return String(view).padStart(4, '0');
}

function padPiece(piece) {
  if (!/^\d+$/.test(piece)) return piece;
  return String(Number.parseInt(piece, 10)).padStart(2, '0');
}

function parseCote(cote) {
  const cleaned = cote
    .toLowerCase()
    .replace(/[°]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const m = cleaned.match(/^(\d+)\s*([a-z]+)\s*(\d+)\s*\/\s*([a-z0-9]+)$/i);
  if (!m) {
    throw new Error(
      `Format de cote non reconnu: ${cote}. Exemple attendu: "3 E 510/105" ou "5 MIR 510/1"`
    );
  }

  const serieNum = m[1];
  const serieCode = m[2].toLowerCase();
  const reel = m[3];
  const piece = padPiece(m[4].toLowerCase());

  return {
    serieNum,
    serieCode,
    reel,
    piece,
    token: `${serieNum}${serieCode}_${reel}_${piece}`,
  };
}

function buildImagePathFromCote({ cote, view, imageSuffix }) {
  const parsed = parseCote(cote);
  const baseName = `frad062_${parsed.token}`;
  const suffix = imageSuffix || padView(view);
  const image = `/mnt/lustre/ad62/etat_civil_registres_3/${parsed.reel}/${baseName}/${baseName}_${suffix}.jpg`;
  return { image, parsed };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, { timeoutMs, retries }) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        },
      });
      clearTimeout(timer);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) {
        await sleep(300 * attempt);
      }
    }
  }
  throw new Error(`Echec HTTP apres ${retries} tentatives: ${String(lastErr)}`);
}

function makeGenereImageUrl({
  baseUrl, image, tileId, l, h, ol, oh, x, y,
}) {
  const u = new URL('/v2/images/genereImage.html', baseUrl);
  u.searchParams.set('l', String(l));
  u.searchParams.set('h', String(h));
  u.searchParams.set('ol', String(ol));
  u.searchParams.set('oh', String(oh));
  u.searchParams.set('x', String(x));
  u.searchParams.set('y', String(y));
  u.searchParams.set('r', '0');
  u.searchParams.set('n', '0');
  u.searchParams.set('b', '0');
  u.searchParams.set('c', '0');
  u.searchParams.set('o', 'TILE');
  u.searchParams.set('id', tileId);
  u.searchParams.set('image', image);
  return u.toString();
}

function makeImgGenereUrl({ baseUrl, image, view }) {
  const u = new URL('/v2/images/genereImage.html', baseUrl);
  u.searchParams.set('r', '0');
  u.searchParams.set('n', '0');
  u.searchParams.set('b', '0');
  u.searchParams.set('c', '0');
  u.searchParams.set('o', 'IMG');
  u.searchParams.set('id', `visu_image_${view}`);
  u.searchParams.set('image', image);
  return u.toString();
}

function parseImgUrl(imgUrl) {
  const u = new URL(imgUrl);
  const image = u.searchParams.get('image') || undefined;
  const id = u.searchParams.get('id') || '';
  const m = id.match(/visu_image_(\d+)/);
  const view = m ? Number.parseInt(m[1], 10) : undefined;
  return { image, view };
}

async function requestImgProbe({ baseUrl, image, view, timeoutMs, retries }) {
  const url = makeImgGenereUrl({ baseUrl, image, view });
  const res = await fetchWithRetry(url, { timeoutMs, retries });
  const text = (await res.text()).trim();
  const parts = text.split(/\s+/);

  if (parts.length < 7) {
    throw new Error(`Reponse IMG inattendue: ${text}`);
  }

  return {
    url,
    cachePath: parts[1],
    fullW: Number.parseInt(parts[4], 10),
    fullH: Number.parseInt(parts[5], 10),
  };
}

async function requestGenereImage({
  baseUrl, image, tileId, l, h, ol, oh, x, y, timeoutMs, retries,
}) {
  const url = makeGenereImageUrl({ baseUrl, image, tileId, l, h, ol, oh, x, y });
  const res = await fetchWithRetry(url, { timeoutMs, retries });
  const text = (await res.text()).trim();
  const parts = text.split(/\s+/);

  if (parts.length < 7) {
    throw new Error(`Reponse genereImage inattendue: ${text}`);
  }

  return {
    cachePath: parts[1],
    returnedOl: Number.parseInt(parts[2], 10),
    returnedOh: Number.parseInt(parts[3], 10),
    fullW: Number.parseInt(parts[4], 10),
    fullH: Number.parseInt(parts[5], 10),
  };
}

async function downloadTileBuffer({ baseUrl, cachePath, timeoutMs, retries }) {
  const tileUrl = new URL(cachePath, baseUrl).toString();
  const res = await fetchWithRetry(tileUrl, { timeoutMs, retries });
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}

function resolveRegion({
  fullW, fullH, half, cropX, cropY, cropWidth, cropHeight,
}) {
  if (half) {
    switch (half) {
      case 'left':
        return { x0: 0, y0: 0, w: Math.floor(fullW / 2), h: fullH };
      case 'right': {
        const x0 = Math.floor(fullW / 2);
        return { x0, y0: 0, w: fullW - x0, h: fullH };
      }
      case 'top':
        return { x0: 0, y0: 0, w: fullW, h: Math.floor(fullH / 2) };
      case 'bottom': {
        const y0 = Math.floor(fullH / 2);
        return { x0: 0, y0, w: fullW, h: fullH - y0 };
      }
      default:
        throw new Error(`Valeur invalide pour --half: ${half}`);
    }
  }

  const x0 = Math.max(0, cropX ?? 0);
  const y0 = Math.max(0, cropY ?? 0);

  const maxW = Math.max(1, fullW - x0);
  const maxH = Math.max(1, fullH - y0);

  const w = Math.max(1, Math.min(cropWidth ?? maxW, maxW));
  const h = Math.max(1, Math.min(cropHeight ?? maxH, maxH));

  return { x0, y0, w, h };
}

function inferFormat(output) {
  const lc = output.toLowerCase();
  if (lc.endsWith('.png')) return 'png';
  if (lc.endsWith('.webp')) return 'webp';
  return 'jpeg';
}

async function resolveImageAndView(args) {
  let image = args.image;
  let view = Number.isFinite(args.view) ? args.view : undefined;
  let parsedCote;
  let imageWasGuessed = false;

  if (args.imgUrl) {
    const parsed = parseImgUrl(args.imgUrl);
    if (!image && parsed.image) image = parsed.image;
    if (!view && Number.isFinite(parsed.view)) view = parsed.view;
  }

  if (!image && args.cote && Number.isFinite(view)) {
    const built = buildImagePathFromCote({ cote: args.cote, view, imageSuffix: args.imageSuffix });
    parsedCote = built.parsed;

    if (args.imageSuffix) {
      image = built.image;
      imageWasGuessed = true;
    } else {
      const candidates = [
        padView(view),
        String(view),
        String(view).padStart(3, '0'),
        String(view).padStart(5, '0'),
      ];

      for (const suffix of [...new Set(candidates)]) {
        const candidate = buildImagePathFromCote({ cote: args.cote, view, imageSuffix: suffix }).image;
        try {
          await requestImgProbe({
            baseUrl: args.baseUrl,
            image: candidate,
            view,
            timeoutMs: args.timeout,
            retries: Math.max(1, Math.min(2, args.retries)),
          });
          image = candidate;
          imageWasGuessed = true;
          break;
        } catch {
          // Essai candidat suivant.
        }
      }
    }
  }

  if (!view && image) {
    const m = image.match(/_(\d{1,4})\.jpg$/i);
    if (m) view = Number.parseInt(m[1], 10);
  }

  if (!image || !Number.isFinite(view)) {
    throw new Error(
      'Impossible de determiner image/vue. Utilise --image + --view, ou --img-url, ou --cote + --view (et au besoin --image-suffix).'
    );
  }

  return { image, view, parsedCote, imageWasGuessed };
}

function sanitizeForFilename(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'sortie';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    usage();
    process.exit(0);
  }

  const resolved = await resolveImageAndView(args);
  args.image = resolved.image;
  args.view = resolved.view;

  if (!args.output) {
    const base = resolved.parsedCote
      ? `${resolved.parsedCote.token}_vue${args.view}`
      : `vue${args.view}`;
    args.output = `${sanitizeForFilename(base)}.jpg`;
  }

  const tileId = `tuile_${args.view}_4_3_4`;

  if (args.showUrls !== 0) {
    const imgGenUrl = makeImgGenereUrl({
      baseUrl: args.baseUrl,
      image: args.image,
      view: args.view,
    });
    const tilePreviewUrl = makeGenereImageUrl({
      baseUrl: args.baseUrl,
      image: args.image,
      tileId,
      l: args.tileL,
      h: args.tileH,
      ol: args.ol,
      oh: args.oh,
      x: 0,
      y: 0,
    });
    console.log(`Image source resolue: ${args.image}`);
    if (resolved.parsedCote) {
      console.log(`Cote parsee: token=${resolved.parsedCote.token}`);
      if (resolved.imageWasGuessed) {
        console.log('Note: chemin image determine par heuristique depuis cote+vue. Si resultat incoherent, fournis --img-url ou --image-suffix.');
      }
    }
    console.log(`URL generation IMG: ${imgGenUrl}`);
    console.log(`URL generation TILE (preview): ${tilePreviewUrl}`);
    console.log(`Fichier de sortie: ${args.output}`);
  }

  const probe = await requestGenereImage({
    baseUrl: args.baseUrl,
    image: args.image,
    tileId,
    l: args.tileL,
    h: args.tileH,
    ol: args.ol,
    oh: args.oh,
    x: 0,
    y: 0,
    timeoutMs: args.timeout,
    retries: args.retries,
  });

  const fullW = Number.isFinite(args.fullWidth) ? args.fullWidth : probe.fullW;
  const fullH = Number.isFinite(args.fullHeight) ? args.fullHeight : probe.fullH;

  const region = resolveRegion({
    fullW,
    fullH,
    half: args.half,
    cropX: args.cropX,
    cropY: args.cropY,
    cropWidth: args.cropWidth,
    cropHeight: args.cropHeight,
  });

  const cols = Math.ceil(region.w / args.tileL);
  const rows = Math.ceil(region.h / args.tileH);
  const total = rows * cols;

  console.log(`Dimensions source: ${fullW}x${fullH}`);
  console.log(`Region: x=${region.x0}, y=${region.y0}, w=${region.w}, h=${region.h}`);
  console.log(`Grille: ${cols}x${rows} (${total} tuiles)`);

  const firstL = Math.min(args.tileL, region.w);
  const firstH = Math.min(args.tileH, region.h);
  const firstX = region.x0;
  const firstY = region.y0;

  let firstCachePath;
  if (firstX === 0 && firstY === 0 && firstL === args.tileL && firstH === args.tileH) {
    firstCachePath = probe.cachePath;
  } else {
    const firstReq = await requestGenereImage({
      baseUrl: args.baseUrl,
      image: args.image,
      tileId,
      l: firstL,
      h: firstH,
      ol: args.ol,
      oh: args.oh,
      x: firstX,
      y: firstY,
      timeoutMs: args.timeout,
      retries: args.retries,
    });
    firstCachePath = firstReq.cachePath;
  }

  const firstBuffer = await downloadTileBuffer({
    baseUrl: args.baseUrl,
    cachePath: firstCachePath,
    timeoutMs: args.timeout,
    retries: args.retries,
  });
  const firstMeta = await sharp(firstBuffer).metadata();

  if (!firstMeta.width || !firstMeta.height) {
    throw new Error('Impossible de lire la taille de la premiere tuile');
  }

  const scaleX = firstMeta.width / firstL;
  const scaleY = firstMeta.height / firstH;

  const canvasW = Math.max(1, Math.round(region.w * scaleX));
  const canvasH = Math.max(1, Math.round(region.h * scaleY));

  console.log(`Echelle detectee: ${scaleX.toFixed(4)} x ${scaleY.toFixed(4)}`);
  console.log(`Sortie: ${canvasW}x${canvasH}`);

  const composites = [];
  composites.push({ input: firstBuffer, left: 0, top: 0 });

  let done = 1;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (row === 0 && col === 0) continue;

      const dx = col * args.tileL;
      const dy = row * args.tileH;

      const wantedW = Math.min(args.tileL, region.w - dx);
      const wantedH = Math.min(args.tileH, region.h - dy);
      const wantedX = region.x0 + dx;
      const wantedY = region.y0 + dy;

      // Garde une taille de requete stable pour conserver la meme echelle,
      // puis recadre les bords si la requete deborde en bas/a droite.
      const reqL = Math.min(args.tileL, fullW);
      const reqH = Math.min(args.tileH, fullH);
      const reqX = Math.max(0, Math.min(wantedX, fullW - reqL));
      const reqY = Math.max(0, Math.min(wantedY, fullH - reqH));

      const req = await requestGenereImage({
        baseUrl: args.baseUrl,
        image: args.image,
        tileId,
        l: reqL,
        h: reqH,
        ol: args.ol,
        oh: args.oh,
        x: reqX,
        y: reqY,
        timeoutMs: args.timeout,
        retries: args.retries,
      });

      const tileBufferRaw = await downloadTileBuffer({
        baseUrl: args.baseUrl,
        cachePath: req.cachePath,
        timeoutMs: args.timeout,
        retries: args.retries,
      });

      const tileMeta = await sharp(tileBufferRaw).metadata();
      if (!tileMeta.width || !tileMeta.height) {
        throw new Error('Impossible de lire la taille d une tuile');
      }

      const localScaleX = tileMeta.width / reqL;
      const localScaleY = tileMeta.height / reqH;

      const srcOffsetX = Math.max(0, wantedX - reqX);
      const srcOffsetY = Math.max(0, wantedY - reqY);

      const extractLeft = Math.round(srcOffsetX * localScaleX);
      const extractTop = Math.round(srcOffsetY * localScaleY);
      const extractWidth = Math.max(1, Math.round(wantedW * localScaleX));
      const extractHeight = Math.max(1, Math.round(wantedH * localScaleY));

      const safeExtractWidth = Math.min(extractWidth, tileMeta.width - extractLeft);
      const safeExtractHeight = Math.min(extractHeight, tileMeta.height - extractTop);

      const tileBuffer = await sharp(tileBufferRaw)
        .extract({
          left: Math.max(0, extractLeft),
          top: Math.max(0, extractTop),
          width: Math.max(1, safeExtractWidth),
          height: Math.max(1, safeExtractHeight),
        })
        .toBuffer();

      composites.push({
        input: tileBuffer,
        left: Math.round(dx * scaleX),
        top: Math.round(dy * scaleY),
      });

      done += 1;
      if (done % 5 === 0 || done === total) {
        console.log(`Progression: ${done}/${total}`);
      }

      if (args.delay > 0) {
        await sleep(args.delay);
      }
    }
  }

  const format = inferFormat(args.output);
  let pipeline = sharp({
    create: {
      width: canvasW,
      height: canvasH,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  }).composite(composites);

  if (format === 'png') pipeline = pipeline.png();
  else if (format === 'webp') pipeline = pipeline.webp({ quality: 92 });
  else pipeline = pipeline.jpeg({ quality: 92 });

  await pipeline.toFile(args.output);
  console.log(`Image finale enregistree: ${args.output}`);
}

main().catch((err) => {
  console.error(`Erreur: ${err.message || String(err)}`);
  process.exit(1);
});
