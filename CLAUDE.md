# Agent instructions

## Language conventions

- **Everything developer-facing is in English**: code comments, variable and
  function names, CSS class names, HTML ids, commit messages, documentation
  (README, this file).
- **Everything user-facing stays in French**: UI labels, buttons, status and
  toast messages, `aria-label`s, placeholders, page `<title>`. The tool targets
  French-speaking users of the AD62 archives.
- Domain terms are translated in code: the French archival term *cote* is
  `reference`, *vue* is `viewNumber`, *lien* is `link`. Keep UI labels in
  French («Côte», «Vue», «Lien ARK»).

## Project facts

- Static web app, **no build step**: plain ES modules in `web/`, served as-is.
  Do not introduce a bundler or framework without being asked.
- pdf.js is **vendored** in `web/vendor/` (copied from `pdfjs-dist`, kept as a
  devDependency only to refresh those copies). Never import from
  `node_modules` in browser code.
- Deployed to GitHub Pages by `.github/workflows/pages.yml`, which publishes
  the `web/` folder on every push to `main`. Keep all asset paths relative.
- Supported inputs: AD62 PDFs (metadata parsed from embedded text)
  and plain images (provenance detected from the filename for Aisne/AD02 and
  Nord/AD59 — rules live in `web/parse.mjs`). Unknown images show empty
  fields for the user to fill in.
- `samples/` holds one real example per supported source; the e2e check runs
  against all of them.
- E2E test: `node web/serve.mjs 5199 &` then `node web/e2e-check.mjs`
  (requires puppeteer, installed ad hoc).
