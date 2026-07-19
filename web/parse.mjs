// Metadata extraction for archive documents: from the text of a AD62
// Archives PDF, or from the filename of a plain image (Aisne, Nord).
// ESM module usable both in the browser AND in Node (for tests).
// "Reference" translates the French archival term "cote" (document call number).

// Reference examples: "5 MIR 510/2", "3 E 510/105", "5 Mi 12/3"...
// Number - series letters - reel / item number.
const REFERENCE_RE = /(\d+)\s+([A-Za-zÀ-ÿ]{1,6})\s+(\d+)\s*\/\s*([A-Za-z0-9]+)/;

// "Vue 447/1621" or "Vue 447" or "VUE 447" ("vue" = view number in the archive viewer).
const VIEW_RE = /\bVUE?\s+(\d+)(?:\s*\/\s*\d+)?/i;

// ARK link: the identifier is hexadecimal, stop at the first non-hex character
// (robust even when PDF text extraction glues the next word without a space).
const ARK_RE = /https?:\/\/[^\s]*?ark:\/\d+\/[0-9a-fA-F]+/;

// Fallback: any archivesenligne URL.
const FALLBACK_URL_RE = /https?:\/\/archivesenligne\.pasdecalais\.fr\/\S+/;

/**
 * @param {string} rawText Raw text extracted from the PDF.
 * @returns {{ reference: string|null, viewNumber: string|null, link: string|null }}
 */
export function parseArchiveText(rawText) {
  const text = (rawText || '').replace(/ /g, ' ').replace(/nbsp/g, ' ');

  return {
    reference: extractReference(text),
    viewNumber: extractViewNumber(text),
    link: extractLink(text),
  };
}

export function extractReference(text) {
  const m = text.match(REFERENCE_RE);
  if (!m) return null;
  // Normalize internal spaces: "5 MIR 510/2".
  return `${m[1]} ${m[2].toUpperCase()} ${m[3]}/${m[4]}`;
}

export function extractViewNumber(text) {
  const m = text.match(VIEW_RE);
  return m ? m[1] : null;
}

export function extractLink(text) {
  const ark = text.match(ARK_RE);
  if (ark) return ark[0];
  const url = text.match(FALLBACK_URL_RE);
  if (url) return url[0].replace(/[.,;)\]]+$/, '');
  return null;
}

/* -------------------- Image filename parsing (Aisne, Nord) ----------------- */

// Nord (AD59) download names end with this fixed suffix.
const NORD_SUFFIX = 'Site Web des Archives départementales du Nord';

/**
 * Detects the provenance of a plain image from its filename and extracts what
 * it can. Unknown provenance returns all-null fields (the user fills them in).
 *
 * Aisne (AD02): "FRAD002_<reference>_<sequence>.jpg", e.g.
 * "FRAD002_5Mi0493_0374.jpg" -> reference "5Mi0493". The trailing number is a
 * scan sequence, NOT the view number, so it is deliberately ignored.
 *
 * Nord (AD59): " - "-separated elements, e.g. "HAZEBROUCK M [1871-1888] -
 * 1 Mi EC 295 R 005 - Lot 1 - Média 169 - <suffix>.jpg" -> title (ignored),
 * reference, lot (ignored), "Média <view>", site name.
 *
 * @param {string} filename
 * @returns {{ reference: string|null, viewNumber: string|null, link: string|null }}
 */
export function parseImageFilename(filename) {
  const base = (filename || '').replace(/\.[^.]+$/, '').trim();

  if (/^FRAD002_/i.test(base)) {
    const parts = base.split('_');
    return { reference: parts[1] || null, viewNumber: null, link: null };
  }

  const parts = base.split(' - ').map((p) => p.trim());
  if (parts.length >= 2 && parts[parts.length - 1] === NORD_SUFFIX) {
    const media = parts.find((p) => /^Média\s+\d+$/i.test(p));
    return {
      reference: parts[1] || null,
      viewNumber: media ? media.match(/(\d+)/)[1] : null,
      link: null,
    };
  }

  return { reference: null, viewNumber: null, link: null };
}
