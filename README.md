# Telmi AI Studio

Studio familial mono-administrateur pour créer, relire, générer et publier des histoires interactives compatibles avec Telmi OS. Le projet est auto-hébergeable, en français par défaut et distribué sous AGPL-3.0.

## Fonctionnalités

- assistant de création en cinq étapes ;
- scénario JSON structuré via OpenRouter, OpenAI ou une API compatible OpenAI ;
- validation du graphe et validation explicite du parent avant les médias ;
- narration locale Piper par défaut, ElevenLabs en option, et illustrations OpenAI ;
- éditeur liste, graphe React Flow et JSON ;
- compilation en pack Telmi avec `metadata.json`, `nodes.json`, `notes.json`, médias et ZIP ;
- bibliothèque et store privé compatible Telmi Sync ;
- orchestration interne séquentielle avec reprise automatique ;
- budgets, journaux expurgés, corbeille 30 jours et sauvegardes chiffrées.

## Lancement Docker

Prérequis : Docker avec Compose.

```bash
cp .env.example .env
openssl rand -hex 32 # valeur de APP_ENCRYPTION_KEY
docker compose up -d --build
```

Ouvrir ensuite [http://localhost:3000](http://localhost:3000). L’assistant crée l’administrateur et les réglages. Dès que le premier administrateur existe, l’installation initiale est définitivement désactivée.

Les données persistantes sont dans le volume Docker `telmi-data`, monté sur `/data` : SQLite, médias, ZIP, sauvegardes et journaux. `APP_ENCRYPTION_KEY` doit être sauvegardée séparément ; sa perte rend les clés fournisseurs illisibles.

Pour une instance HTTPS :

```env
NEXT_PUBLIC_APP_URL=https://telmi.example.org
COOKIE_SECURE=true
```

## Développement local

Prérequis : Node.js 22, pnpm 11 et `ffmpeg`/`ffprobe`.

```bash
pnpm install
pnpm db:migrate
pnpm dev
```

Contrôles :

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

## Fournisseurs

Après l’installation, ouvrir **Paramètres** :

- texte : OpenRouter par défaut, ou toute API OpenAI-compatible ;
- images : OpenAI Images (`gpt-image-1` par défaut) ;
- voix : Piper local sans clé API (`fr_FR-beatrice` par défaut, comme Telmi
  Sync) avec toutes les variantes françaises officielles disponibles : Gilles,
  MLS, MLS 1840, Siwis, Tom et UPMC en qualité basse ou moyenne. Piper ne publie
  actuellement aucune variante française en qualité haute. ElevenLabs reste
  disponible en option (`eleven_multilingual_v2`). Les sorties sont normalisées
  en MP3 mono 44,1 kHz à 128 kb/s pour Telmi.

Les clés sont chiffrées dans SQLite. Elles ne sont jamais renvoyées par l’API.

## Orchestration des générations

Telmi AI Studio exécute directement les étapes `validate`, `tts` et `images` dans une file interne séquentielle. Aucun service n8n n’est nécessaire. Les étapes restent idempotentes, leur progression est enregistrée dans SQLite et un travail interrompu reprend automatiquement au démarrage suivant.

Après génération, le parent prévisualise, remplace ou régénère chaque média. La compilation du ZIP reste déclenchée uniquement après cette validation explicite.

## Store privé Telmi Sync

L’URL est :

```text
https://votre-instance/store
```

Le catalogue, les couvertures et les ZIP sont accessibles directement tant que le store est activé dans les paramètres. Le format du catalogue suit la [documentation officielle du store Telmi](https://wiki.telmi.fr/stores/creer_son_store_telmi/).

Le store historique peut encore être lancé pour comparaison :

```bash
docker compose --profile legacy-store up -d telmi-store
```

## Sauvegarde et restauration

Les paramètres permettent de créer une archive `.taisbackup` chiffrée par un mot de passe distinct. Elle contient la base et les packs. La restauration valide d’abord le chiffrement, les chemins de l’archive et l’intégrité SQLite, puis remplace les données et redémarre le conteneur.

## Fixture Telmi

Le pack fourni par le propriétaire du projet sert uniquement de référence locale. Il n’est pas distribué dans le dépôt tant que ses droits de redistribution ne sont pas établis.

## Dépôts

- source principale prévue : `https://git.acadenice.com/ludovicrubio/telmi-ai-studio` ;
- miroir prévu : `https://github.com/Aca-Ludo/telmi-ai-studio`.

Configurez le miroir dans Forgejo après la première publication. Le bouton de mise à jour de l’application ne modifie jamais le conteneur : il affiche seulement la commande Docker à exécuter.

## Licence

Copyright © 2026, contributeurs Telmi AI Studio. Code sous GNU Affero General Public License v3.0 uniquement (`AGPL-3.0-only`). Les visuels Telmi officiels ne sont pas inclus.
