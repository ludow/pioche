# Pioche ⛏️

Genealogy tooling for the [Pas-de-Calais online archives](https://archivesenligne.pasdecalais.fr).

The main tool is a **browser-based PDF extractor**: drop a PDF downloaded from the
archives website and it extracts the useful metadata and the full-resolution scan,
ready to be cropped and saved with a consistent, genealogy-friendly filename.

**Live version: <https://ludow.github.io/pioche/>**

## Features

- Extracts from the PDF:
  - **Reference** (French *cote*, e.g. `5 MIR 510/2`)
  - **View number** (e.g. `447`)
  - **ARK permalink** (when present)
- Displays the embedded scan at full resolution with zoom (mouse wheel), pan
  (Ctrl+drag, middle-click or Space) and a crop selection with resize handles.
- Downloads the full image or the cropped selection as PNG or JPG.
- Builds structured filenames from the metadata fields:
  `PlaceCode_PlaceName_Date_ActCode_Individuals_Reference_View`
  e.g. `59_Hazebrouck_17670114_MA_WERREBROUCK_Pierre_x_VERLEY_Marie_5-Mi-035-R-020_191D`
- **Fully client-side**: the PDF never leaves the browser, no server involved.

The interface is in French, as the tool targets users of the French archives.

## Running locally

No build step — the app is plain ES modules served as static files:

```bash
npm run web           # serves web/ at http://localhost:5173
# or: node web/serve.mjs 8080   to pick another port
```

Then open the page and drop a PDF (`web/sample.pdf` is provided as a demo file).

## Project layout

| Path | Role |
|---|---|
| `web/index.html`, `web/styles.css` | Interface |
| `web/app.js` | UI orchestration: viewer, crop selection, copy, download |
| `web/pdf.mjs` | pdf.js loading + extraction of the largest embedded image (the scan) |
| `web/parse.mjs` | Reference / view / link extraction from PDF text (pure, testable) |
| `web/serve.mjs` | Dependency-free static server for local development |
| `web/vendor/` | pdf.js build (`pdfjs-dist`) copied from `node_modules` |
| `.github/workflows/pages.yml` | GitHub Pages deployment (publishes `web/`) |

## Testing

End-to-end check with a headless browser:

```bash
npm i --no-save puppeteer && npx puppeteer browsers install chrome
node web/serve.mjs 5199 &        # in one terminal
node web/e2e-check.mjs           # checks text + image extraction, crop, download
```

## Updating pdf.js

pdf.js is vendored so the app works without a build step:

```bash
npm update pdfjs-dist
cp node_modules/pdfjs-dist/build/pdf.min.mjs        web/vendor/
cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs web/vendor/
```

## Deployment

Every push to `main` triggers the GitHub Actions workflow in
`.github/workflows/pages.yml`, which publishes the `web/` folder to GitHub Pages.
