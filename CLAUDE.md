# InMap — contexte projet

Prototype (proof of concept) d'une **web app mobile de guidage piéton en intérieur** pour grands centres commerciaux. Sert de support de démo pour un pitch et pour des entretiens clients. Ce n'est pas un produit : privilégier la simplicité et l'effet démo à la complétude.

## Vision produit (résumé)

- **Stratégie « Web-to-App »** : web app sans installation (accès par QR code / NFC aux entrées et parkings) pour la majorité des visiteurs ; app native (AR complète, fidélité, push) plus tard pour les habitués.
- **Visiteurs** : position en temps réel, itinéraire A → B, mode PMR (éviter escaliers/escalators), affluence des boutiques, mémorisation de la place de parking, recherche produit en rayon.
- **Commerçants** : trafic qualifié, visibilité des zones secondaires, retail media (pastilles promo, bannières sponsorisées).
- **Foncières** : remplacement des bornes physiques, désengorgement des allées, analytics (heatmaps, dwell time, recherches sans résultat).
- **Modèle** : SaaS au m² + frais de déploiement + monétisation retail media.

### Positionnement marché (à garder en tête)
Le marché est occupé : **Wemap** (FR, web, positionnement caméra 1–3 m, client URW), **Mappedin** (QR → web app → point bleu via Wi-Fi), **Mapsted**, **Pointr**, Situm, Oriient. La techno seule n'est pas un différenciateur. Pistes de différenciation envisagées : milieu de marché français (centres moyens, offre simple et peu chère, déploiement rapide), modèle financé par les enseignes, niches (produit en rayon en hypermarché). Le taux réel d'usage (scan de QR) est l'hypothèse la plus fragile du modèle.

## Choix techniques clés

- **Pas de BLE/UWB/Wi-Fi scan possible en web** (aucune API navigateur ; iOS sans Bluetooth web). Localisation = **PDR** (détection de pas + cap boussole via `devicemotion` / `deviceorientation`) **+ filtre à particules contraint par le plan** (les hypothèses qui traversent un mur meurent) **+ recalage** par points QR/NFC (`?anchor=<id>`) ou toucher de la carte (mode Réel uniquement).
- Chaque particule porte un **biais de cap** et un **facteur de foulée** : le filtre apprend l'erreur de boussole et la longueur de pas.
- **Itinéraire** : Dijkstra sur le graphe des couloirs construit à la volée (extrémités + croisements + départ/arrivée), avec **pénalité par virage** pour préférer les trajets simples.
- **Rendu** : Canvas 2D maison, pas de lib de carte. Caméra en mode suivi (zoom sur le point) ou vue d'ensemble (affichée 3 s au début de chaque trajet).
- **AR** : seule une « AR légère » est jugée réaliste en web (flux caméra + flèche orientée par la boussole, sans ancrage au sol). WebXR `immersive-ar` n'existe pas sur Safari iOS ; 8th Wall a fermé. Ne pas viser l'AR ancrée/VPS dans ce prototype.
- Contraintes web : page ouverte obligatoire (Wake Lock pour garder l'écran allumé), permission capteurs iOS sur geste utilisateur, **HTTPS obligatoire** pour les capteurs.

## Stack & commandes

Vite + TypeScript (vanilla, sans framework), aucune dépendance runtime hormis les polices embarquées (`@fontsource`).

```bash
npm run dev        # HTTPS auto-signé + exposé sur le LAN (test sur téléphone : https://<ip-du-pc>:5173)
npm run dev:http   # HTTP sur :5174 — mode démo sur ordinateur / navigateur intégré (refuse le certificat auto-signé)
npm run build      # tsc (vérification de types) + build Vite
```

Paramètres d'URL : `?plan=mall|test`, `&anchor=<id d'un point de recalage>`, `&step=<foulée en m, défaut 0.7>`.

Il n'y a pas de tests automatisés. Pour vérifier la précision du filtre sans navigateur, bundler un script de bench avec `npx rolldown <fichier>.ts --file <scratch>/bench.mjs --format esm` puis l'exécuter avec `node` (faire tourner `Walker` + `ParticleFilter` sur `demoTrips` et mesurer l'erreur). Référence actuelle en simulation : erreur médiane ~0,8 m, p90 ~1,9 m — optimiste par rapport à un vrai téléphone.

## Structure

| Fichier | Rôle |
|---|---|
| `src/main.ts` | Orchestration : modes Démo/Réel, destination et itinéraire, bandeau de guidage, boucle d'animation, interactions |
| `src/plan.ts` | Modèle de plan (couloirs en polylignes, boutiques, points de recalage, trajets démo), géométrie (`walkable`, `snap`, `nearestOnAxis`), plans `mall` (140 × 244 m, 40 enseignes) et `test` |
| `src/filter.ts` | Filtre à particules (position + biais de cap + foulée), `randn` |
| `src/sensors.ts` | Lecture des capteurs : cap lissé, détection de pas par pic d'accélération avec hystérésis |
| `src/route.ts` | Graphe de couloirs, Dijkstra avec pénalité de virage, instructions (gauche/droite/demi-tour), progression le long du trajet |
| `src/sim.ts` | Marcheur simulé de la démo (boussole biaisée de 12°, foulée réelle ≠ foulée annoncée) |
| `src/render.ts` | Rendu canvas : couloirs, boutiques + logos, trajet, destination, particules, point de position, caméra |
| `src/logos.ts` | Logos des enseignes fictives (forme + couleurs + monogramme ou pictogramme SVG en `Path2D`) |
| `src/style.css` | Styles de l'interface (bandeau, panneau) |

Repère des plans : mètres, x vers la droite, **y vers le bas** ; cap 0 = haut du plan, sens horaire (`dx = sin(h)·l`, `dy = −cos(h)·l`).

## Identité visuelle

Style **signalétique / éditorial, clair, contrasté, non futuriste** (le style néon sombre a été rejeté).
- Couleurs : papier `#faf7f1`, sable `#e8e2d6`, encre `#1d1b16`, **cobalt `#2a45e0`** (trajet, position, marque), **tomate `#f0532a`** (destination). Elles sont dupliquées entre `style.css` (variables CSS) et `render.ts` (constantes) : modifier les deux.
- Cartes UI : contour encre 2 px + ombre décalée pleine (`4px 4px 0`).
- Polices embarquées : **Bricolage Grotesque** (UI, monogrammes) et **DM Serif Display** (monogrammes « premium »). Préchargées dans `main.ts` car le canvas ne déclenche pas leur chargement.
- Toutes les enseignes et leurs logos sont **fictifs** : ne jamais reproduire de vraie marque.

## Conventions

- Code, commentaires et textes UI **en français**. Commentaires brefs, au même niveau de détail que l'existant.
- Rester minimal : pas de framework ni de lib de carte sans raison forte ; garder le prototype démontrable sur un téléphone.
- Après une modification visible, vérifier dans le navigateur (`npm run dev:http`, viewport mobile 375 × 812).

## Pistes non réalisées

Vue « Orientation » en AR légère (caméra + flèche), multi-étages et mode PMR (types d'arêtes escalier/ascenseur), recherche de boutiques, promos géolocalisées, affluence simulée, parking, tableau de bord foncière, déploiement Vercel pour test HTTPS.
