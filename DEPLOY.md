# Déploiement — Studio ENS

Site 100 % statique. Aucun build, aucun backend.

## Ce qui est expédié (~41 Mo)
- `index.html`, `style.css`, `main.js`
- `frames/` — séquence WebP du hero (scroll)
- `assets/` — photos réalisations + showreel (mp4 + poster)
- `vercel.json` — cache long sur `frames/` et `assets/`

## Ce qui est exclu (voir `.vercelignore` / `.gitignore`)
Sources brutes non utilisées par le site : `media/`, `velse.mp4`, la vidéo Kling,
`server.py`, images générées. (~17 Mo économisés.)

## Déployer

### Option A — CLI (le plus simple)
```
npm i -g vercel
cd D:/Project/Studio_ENS
vercel          # préversion
vercel --prod   # mise en production
```

### Option B — Git + import
1. `git init && git add . && git commit -m "Studio ENS"`
2. Pousser sur GitHub.
3. vercel.com → New Project → Import → Deploy.

## Dev local
```
python server.py 8010    # http://127.0.0.1:8010
```

## À vérifier avant prod
- **Meta partage** : dans `index.html`, remplacer `VOTRE-DOMAINE` par le vrai domaine
  (ex: `studio-ens.vercel.app`) dans les balises `og:url`, `og:image`, `twitter:image`.
  Sinon l'aperçu de partage (WhatsApp/Facebook) ne montrera pas l'image.
- Indicatif WhatsApp `wa.me/2290144387642` (supposé +229 Bénin).
- three.js chargé via CDN unpkg (externe) — OK sur Vercel.
