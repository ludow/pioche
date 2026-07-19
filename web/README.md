# Interface web — Extracteur PDF des Archives du Pas-de-Calais

Dépose un PDF téléchargé depuis [archivesenligne.pasdecalais.fr](https://archivesenligne.pasdecalais.fr)
et récupère :

- **Côte** (ex. `5 MIR 510/2`)
- **Vue** (ex. `447`)
- **Lien** ark (peut être absent)

…avec des boutons « Copier », plus l'**image du scan** que l'on peut télécharger
telle quelle ou après avoir tracé une zone de rognage.

Tout se fait **côté navigateur** : le PDF n'est jamais envoyé sur un serveur.

## Lancer

```bash
npm run web           # sert web/ sur http://localhost:5173
# ou : node web/serve.mjs 8080   pour choisir le port
```

Puis ouvrir http://localhost:5173 et déposer un PDF.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html`, `styles.css` | Interface |
| `app.js` | Orchestration UI, sélection/rognage, copie, téléchargement |
| `pdf.mjs` | Chargement pdf.js + extraction de la plus grande image (le scan) |
| `parse.mjs` | Extraction Côte / Vue / Lien depuis le texte (pur, testable) |
| `serve.mjs` | Serveur statique sans dépendance |
| `vendor/` | Build pdf.js (`pdfjs-dist` 4.10.38) copié depuis `node_modules` |

## Test

`sample.pdf` est un PDF de démonstration. Vérification end-to-end (navigateur headless) :

```bash
npm i --no-save puppeteer && npx puppeteer browsers install chrome
node web/serve.mjs 5199 &        # dans un terminal
node web/e2e-check.mjs           # vérifie extraction texte + image + rognage + téléchargement
```

## Mettre à jour pdf.js

```bash
npm update pdfjs-dist
cp node_modules/pdfjs-dist/build/pdf.min.mjs        web/vendor/
cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs web/vendor/
```
