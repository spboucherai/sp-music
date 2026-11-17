# Music SP — music.spboucher.ai

Lecteur musical privé : il lit la bibliothèque audio personnelle de son propriétaire, hébergée sur son cluster.
Ce n'est pas un service de catalogue : la bibliothèque ne contient que des fichiers téléversés par un administrateur
(achats numériques, CD personnels numérisés, créations, licences appropriées). Rien n'est extrait d'un service de streaming.

- **Écoute** : accueil, recherche (titre, artiste, album, genre), pages album / artiste, file d'attente modifiable,
  « À suivre », aléatoire, répétition, favoris, listes de lecture, reprise de lecture par compte, écran « En cours de
  lecture », commandes média du système, PWA installable.
- **Administration** (`/admin`) : import par glisser-déposer (fichiers, dossiers, ZIP), envoi par morceaux avec reprise,
  détection des doublons, correction des tags et de l'ordre des pistes, pochettes, suppression auditée, comptes,
  santé du système, journal.
- **Accès** : clés d'accès WebAuthn uniquement (Face ID / Touch ID / code de l'appareil). Aucun mot de passe, aucune
  inscription publique. Deux rôles : administrateur et auditeur.

## Pile

| Élément | Choix |
|---|---|
| Interface + API | Next.js 16 (App Router), React 19, Tailwind 4 |
| Processus web | `server.ts` : serveur HTTP Node qui sert l'audio et les pochettes nativement (Range, Content-Length exacts) et délègue le reste à Next |
| Métadonnées | PostgreSQL 17 (`db/migrations/*.sql`, appliquées une fois, sommes de contrôle) |
| Fichiers | volume privé du nœud (`STORAGE_ROOT`), derrière l'interface `Storage` (`src/server/storage.ts`) |
| Traitement asynchrone | worker `tsx` ; la file est la table `uploads` (`FOR UPDATE SKIP LOCKED`) |
| Audio | `ffprobe` / `ffmpeg` appelés avec un vecteur d'arguments (jamais de shell) |
| WebAuthn | `@simplewebauthn/server` + `@simplewebauthn/browser` |
| Orchestration | PM2 via `mld` (MacLustr), HTTPS par Caddy sur la passerelle BHS64 |

## Démarrage local

```bash
pnpm install
createdb sp_music_dev
cp .env.example .env          # APP_URL=http://localhost:8690, DATABASE_URL, STORAGE_ROOT, APP_SECRET…
pnpm migrate && node_modules/.bin/tsx scripts/bootstrap.ts   # affiche le lien d'inscription du propriétaire
pnpm dev                      # http://localhost:8690  (localhost est un contexte sûr : les clés d'accès y fonctionnent)
pnpm worker                   # dans un second terminal
```

## Vérifications

```bash
pnpm typecheck && pnpm lint
pnpm test          # scripts/test.sh : base et stockage neufs, build de production, worker réel, ffmpeg réel
pnpm secrets:scan
```

`pnpm test` génère ses propres fichiers audio (ondes sinusoïdales) : aucun enregistrement commercial n'est dans le dépôt.
Il couvre : accès anonyme refusé, rôles côté serveur, WebAuthn (origine, RP ID, signature, vérification utilisateur,
challenge rejoué ou expiré, jeton à usage unique), CSRF, import par morceaux et reprise, doublons, fichiers piégés,
archives (traversée de chemin, bombe), Range / 206 / 416 / 304, édition, suppression auditée, redémarrage,
sauvegarde → restauration.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — composants, schéma, pipeline d'import, diffusion, API
- [`docs/SECURITY.md`](docs/SECURITY.md) — WebAuthn, sessions, domaine, en-têtes, menaces traitées, limites connues
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — installation, propriétaire, Face ID / Touch ID, déploiement, sauvegarde, restauration, dépannage
