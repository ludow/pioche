// Metadata extraction from the text of a Pas-de-Calais Archives PDF.
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
