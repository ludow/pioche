// Extraction des métadonnées depuis le texte d'un PDF des Archives du Pas-de-Calais.
// Module ESM utilisable dans le navigateur ET dans Node (pour les tests).

// Cote type: "5 MIR 510/2", "3 E 510/105", "5 Mi 12/3"...
// Nombre - Lettres de série - Numéro de bobine / pièce.
const COTE_RE = /(\d+)\s+([A-Za-zÀ-ÿ]{1,6})\s+(\d+)\s*\/\s*([A-Za-z0-9]+)/;

// "Vue 447/1621" ou "Vue 447" ou "VUE 447".
const VUE_RE = /\bVUE?\s+(\d+)(?:\s*\/\s*\d+)?/i;

// Lien ark: l'identifiant est hexadécimal, on s'arrête au premier caractère non-hex
// (robuste même si l'extraction PDF colle le texte suivant sans espace).
const ARK_RE = /https?:\/\/[^\s]*?ark:\/\d+\/[0-9a-fA-F]+/;

// Repli: n'importe quelle URL archivesenligne.
const FALLBACK_URL_RE = /https?:\/\/archivesenligne\.pasdecalais\.fr\/\S+/;

/**
 * @param {string} rawText Texte brut extrait du PDF.
 * @returns {{ cote: string|null, vue: string|null, lien: string|null }}
 */
export function parseArchiveText(rawText) {
  const text = (rawText || '').replace(/ /g, ' ').replace(/nbsp/g, ' ');

  return {
    cote: extractCote(text),
    vue: extractVue(text),
    lien: extractLien(text),
  };
}

export function extractCote(text) {
  const m = text.match(COTE_RE);
  if (!m) return null;
  // Normalise les espaces internes: "5 MIR 510/2".
  return `${m[1]} ${m[2].toUpperCase()} ${m[3]}/${m[4]}`;
}

export function extractVue(text) {
  const m = text.match(VUE_RE);
  return m ? m[1] : null;
}

export function extractLien(text) {
  const ark = text.match(ARK_RE);
  if (ark) return ark[0];
  const url = text.match(FALLBACK_URL_RE);
  if (url) return url[0].replace(/[.,;)\]]+$/, '');
  return null;
}
