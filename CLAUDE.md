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
- **Multi-niveaux** : le plan `mall` a 3 niveaux (index 0 = parking -1, 1 = rez-de-chaussée, 2 = étage loisirs) reliés par des **connecteurs** (`escalator`, `ascenseur`, `escalier`) placés sur l'axe d'un couloir de chaque niveau desservi. Le filtre à particules ne travaille que sur le niveau courant (`filter.setArea`).
- **Changement de niveau** : détecté quand le visiteur reste **immobile plus de 1,5 s à moins de 5 m d'un connecteur du trajet** (on ne marche pas sur un escalator ni dans un ascenseur) ; le filtre est alors réinitialisé à la sortie du connecteur, en gardant le biais de cap et la foulée appris. Limite connue : une pause près d'un escalator du trajet peut déclencher un changement prématuré.
- **Itinéraire** : Dijkstra sur le graphe des couloirs de tous les niveaux, construit à la volée (extrémités + croisements + connecteurs + départ/arrivée), avec **pénalité par virage** et coût « virtuel » par connecteur (l'ascenseur inclut l'attente). Les trajets verticaux ont une longueur nulle dans `cum`. Instructions : virages + « Prenez l'ascenseur ↑ Niv. 1 ».
- **Rendu 2D** : Canvas 2D maison, pas de lib de carte, niveau courant uniquement. Caméra en mode suivi (zoom sur le point) ou vue d'ensemble (affichée 3 s au début de chaque trajet).
- **Mode PMR** (bouton fauteuil) : `findRoute(..., accessible)` n'emprunte que les ascenseurs ; escalators estompés en 2D/3D, ascenseurs mis en avant, « PMR » dans le bandeau.
- **Services** (`amenities` : sorties, toilettes, sécurité, accueil, secours, bébé, DAB, recharge) : pictogrammes de signalétique, panneau vert « SORTIE » ; libellés et mots-clés dans `AMENITY_INFO`.
- **Bons plans** (`promos`) : étiquette jaune sur la boutique (2D), bannière flottante au-dessus de la vitrine (3D), et **offre flash** (carte « Bon plan » + « Y aller ») quand le visiteur passe à moins de 25 m ; chaque offre une fois par session.
- **Recherche** (`search.ts`) : enseignes de tous les niveaux + services, filtres par groupe, tri par distance approximative (vol d'oiseau + 40 m par niveau) ; vue d'accueil = service le plus proche de chaque type puis enseignes.
- **Rendu 3D, vue par défaut** (`render3d.ts`, Three.js **chargé à la demande** via `import()`, repli en 2D si WebGL indisponible) : vue éclatée des niveaux (écart vertical exagéré à 90 m), niveau courant opaque, autres en transparence, volumes bas (2,4 m) pour ne pas masquer le trajet, logos dessinés sur les toits (texture tournée de 90° pour être lisible depuis la vue par défaut, depuis l'ouest). Rotation/zoom au doigt (OrbitControls, sans panoramique) ; la caméra suit la cible en gardant l'angle choisi. Toucher une boutique = itinéraire (raycast, niveau courant prioritaire).
- **AR** : seule une « AR légère » est jugée réaliste en web (flux caméra + flèche orientée par la boussole, sans ancrage au sol). WebXR `immersive-ar` n'existe pas sur Safari iOS ; 8th Wall a fermé. Ne pas viser l'AR ancrée/VPS dans ce prototype.
- Contraintes web : page ouverte obligatoire (Wake Lock pour garder l'écran allumé), permission capteurs iOS sur geste utilisateur, **HTTPS obligatoire** pour les capteurs.

## Stack & commandes

Vite + TypeScript (vanilla, sans framework). Dépendances runtime : polices embarquées (`@fontsource`) et **Three.js** (uniquement dans le chunk de la vue 3D, ~144 ko gzip, chargé au premier passage en 3D).

```bash
npm run dev        # HTTPS auto-signé + exposé sur le LAN (test sur téléphone : https://<ip-du-pc>:5173)
npm run dev:http   # HTTP sur :5174 — mode démo sur ordinateur / navigateur intégré (refuse le certificat auto-signé)
npm run build      # tsc (vérification de types) + build Vite
```

Paramètres d'URL : `?plan=mall|test`, `&anchor=<id d'un point de recalage>`, `&step=<foulée en m, défaut 0.7>`.

Il n'y a pas de tests automatisés. Pour vérifier la précision du filtre sans navigateur, bundler un script de bench avec `npx rolldown <fichier>.ts --file <scratch>/bench.mjs --format esm` puis l'exécuter avec `node` (faire tourner `Walker` + `ParticleFilter` sur `demoTrips`, reproduire la règle de changement de niveau de `main.ts`, mesurer l'erreur et les changements de niveau ratés). Référence actuelle en simulation : erreur médiane ~0,7 m, p90 ~2 m, 0 changement de niveau raté — optimiste par rapport à un vrai téléphone.

Piège connu : `filter.init(p, σ, true)` conserve biais et foulée ; sur un filtre neuf ils valent 0 (foulée nulle → la position ne bouge plus). Utiliser `keepLearned = false` au démarrage.

## Structure

| Fichier | Rôle |
|---|---|
| `src/main.ts` | Orchestration : modes Démo/Réel, vue 2D/3D, niveau courant et changement de niveau, destination et itinéraire, bandeau de guidage, boucle d'animation, interactions |
| `src/plan.ts` | Modèle de plan (niveaux, couloirs en polylignes, boutiques, connecteurs, points de recalage, trajets démo), classe `Floor` (géométrie : `walkable`, `snap`, `nearestOnAxis`, `shopAt`), plans `mall` (140 × 244 m, 3 niveaux) et `test` |
| `src/filter.ts` | Filtre à particules (position + biais de cap + foulée) sur une zone `Walkable`, `randn` |
| `src/sensors.ts` | Lecture des capteurs : cap lissé, détection de pas par pic d'accélération avec hystérésis |
| `src/route.ts` | Graphe multi-niveaux, Dijkstra avec pénalité de virage, instructions (virages, connecteurs), progression, découpage du trajet par niveau (`pieces`, `verticals`) |
| `src/sim.ts` | Marcheur simulé de la démo (boussole biaisée de 12°, foulée réelle ≠ foulée annoncée, immobile sur escalator/ascenseur) |
| `src/render.ts` | Rendu 2D canvas du niveau courant : couloirs, boutiques + logos, connecteurs, trajet, destination, particules, point de position, caméra. Exporte `Frame`, `TOP`, `BOTTOM` |
| `src/render3d.ts` | Rendu 3D Three.js (vue éclatée des niveaux, services, bannières promo), chargé à la demande |
| `src/search.ts` | Feuille de recherche : index des enseignes et services, filtres, liste triée par distance |
| `src/logos.ts` | Logos des enseignes fictives, pictogrammes des connecteurs et services (forme + couleurs + monogramme ou pictogramme SVG en `Path2D`), `logoFor`, panneau « SORTIE », étiquette promo |
| `src/style.css` | Styles de l'interface (bandeau, panneau, bascule 2D/3D, pastille de niveau) |

Repère des plans : mètres, x vers la droite, **y vers le bas** ; cap 0 = haut du plan, sens horaire (`dx = sin(h)·l`, `dy = −cos(h)·l`).

## Identité visuelle

Style **signalétique / éditorial, clair, contrasté, non futuriste** (le style néon sombre a été rejeté).
- Couleurs : papier `#faf7f1`, sable `#e8e2d6`, encre `#1d1b16`, **cobalt `#2a45e0`** (trajet, position, marque), **tomate `#f0532a`** (destination). Elles sont dupliquées entre `style.css` (variables CSS), `render.ts` et `render3d.ts` (constantes) : modifier les trois.
- Cartes UI : contour encre 2 px + ombre décalée pleine (`4px 4px 0`).
- Polices embarquées : **Bricolage Grotesque** (UI, monogrammes) et **DM Serif Display** (monogrammes « premium »). Préchargées dans `main.ts` car le canvas ne déclenche pas leur chargement.
- Toutes les enseignes et leurs logos sont **fictifs** : ne jamais reproduire de vraie marque.

## Conventions

- Code, commentaires et textes UI **en français**. Commentaires brefs, au même niveau de détail que l'existant.
- Rester minimal : pas de framework ni de lib de carte sans raison forte ; garder le prototype démontrable sur un téléphone.
- Après une modification visible, vérifier dans le navigateur (`npm run dev:http`, viewport mobile 375 × 812).

## Pistes non réalisées

Vue « Orientation » en AR légère (caméra + flèche), affluence simulée, mémorisation de la place de parking, tableau de bord foncière, déploiement Vercel pour test HTTPS.
