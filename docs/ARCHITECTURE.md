# Architecture

```
navigateur ──HTTPS──▶ Caddy (BHS64, TLS) ──WireGuard──▶ nœud :8690  server.ts
                                                          ├─ /api/v1/stream/<id>, /api/v1/art/<id>  → src/server/media-http.ts (Node natif)
                                                          └─ tout le reste                           → Next.js (pages + API JSON)
worker (tsx) ── uploads / tracks (PostgreSQL) ── ffprobe / ffmpeg ── STORAGE_ROOT (privé)
```

## Séparation

1. **Interface et lecteur** — `src/app`, `src/components` (le lecteur vit dans le layout : il survit à la navigation).
2. **API** — quatre surfaces, une route attrape-tout chacune, un garde exécuté *avant* la recherche du gestionnaire (`src/lib/api/router.ts`) :
   | Surface | Garde | Contenu |
   |---|---|---|
   | `/api/v1/auth/*` | aucun (limité en débit par adresse) | session, options/vérification WebAuthn, code de récupération, déconnexion |
   | `/api/v1/library/*` | `requireUser` | catalogue, recherche, favoris, listes, état de lecture, demande de rendu AAC |
   | `/api/v1/me/*` | `requireUser` | clés d'accès, sessions, préférences du compte |
   | `/api/v1/admin/*` | `requireAdmin` | import, édition, suppression, comptes, santé, journal |
   Un gestionnaire d'administration ne peut pas être atteint sans le contrôle de rôle : il n'est même pas recherché avant.
3. **Métadonnées** — PostgreSQL. La base ne contient que des métadonnées et des clés de stockage.
4. **Originaux** — `STORAGE_ROOT/originals/<aa>/<sha256>.<ext>`, jamais modifiés, jamais sous `public/`.
5. **Pochettes et rendus** — `art/<aa>/<sha256>/{orig.*,96.jpg,320.jpg,640.jpg}`, `renditions/<aa>/<track>.m4a`.
6. **Traitement asynchrone** — `src/worker/index.ts`.

## Schéma (db/migrations/001_init.sql)

`users` (rôle `admin`/`listener`, un seul `is_owner`), `authenticators` (clé d'accès : identifiant, clé **publique**,
compteur, transports, nom, dates), `sessions`, `setup_tokens`, `recovery_codes` (hachés), `webauthn_challenges`,
`rate_limits`, `audit_events` · `artists`, `genres`, `albums`, `tracks`, `artworks`, `media_assets` (original, rendu,
pochette, miniature) · `uploads` (import + file de traitement) · `playlists`, `playlist_tracks`, `favorites`,
`favorite_albums`, `playback_state`.

Contraintes notables : un seul original par piste ; un même fichier (SHA-256) ne peut pas être stocké deux fois ;
un album est unique par (artiste d'album, titre normalisé) ; index trigrammes pour la recherche.
Une migration appliquée n'est jamais modifiée (somme de contrôle vérifiée) : on en ajoute une.

## Import

```
navigateur : POST /admin/uploads {nom, taille}  →  PATCH /admin/uploads/<id>?offset=N (morceaux de 8 Mo, écrits en flux)
uploading → received → validating → extracting → ready | duplicate | error | cancelled
```

- **Reprise** : un morceau envoyé au mauvais décalage reçoit `409` avec le décalage attendu ; le client reprend là.
- **Validation** : type déterminé par les premiers octets (`sniff`), jamais par l'extension ; puis `ffprobe` doit trouver un flux audio mesurable. Exécutables, textes, vidéos : refusés.
- **Doublons** : `same_file` (même SHA-256) ou `same_track` (même artiste d'album, album, disque, numéro, titre). Rien n'est remplacé sans confirmation explicite ; le remplacement garde l'identifiant de la piste (listes et favoris intacts) et est journalisé.
- **ZIP** : chaque entrée audio est écrite sous un nom généré par le serveur ; limites sur le nombre d'entrées, la taille par entrée, la taille totale et le taux de compression, mesurées sur les octets produits ; archives chiffrées, imbriquées ou contenant un chemin `../` : refusées.
- **Tags** : titre, artiste, album, artiste d'album, piste, disque, année, genre ; à défaut, le nom du fichier (« 03 Titre.wav »).
- **Pochette** : extraite du fichier sans réencodage, dédupliquée par empreinte ; miniatures carrées JPEG générées à part.

## Diffusion

- `GET /api/v1/stream/<uuid>` exige la session ; `Range` → `206` avec `Content-Range` et `Content-Length` exacts ; `416` si la plage est hors fichier ; `ETag` = identifiant de l'asset, `Cache-Control: private, no-cache` (un fichier remplacé change d'asset, donc d'ETag).
- Lecture depuis le disque par `createReadStream({start, end})` : un morceau n'est jamais chargé en mémoire.
- **Original d'abord.** `tracks.web_playable` : `yes` (FLAC, MP3, AAC, WAV), `some` (ALAC, AIFF, Ogg : rendu AAC préparé à l'import), `no` (DSD : original conservé, rendu seulement si `TRANSCODE_DSD=true`).
- Le lecteur choisit avec `canPlayType` ; si le navigateur échoue à décoder un original, il demande le rendu (`POST /library/tracks/<id>/compat`) et reprend à la même position.
- Aucun transcodage haute résolution : le rendu de compatibilité est un AAC (`RENDITION_BITRATE_KBPS`, 44,1/48 kHz).

## Stockage

`src/server/storage.ts` définit `Storage` (`putFile`, `put`, `read(range)`, `size`, `delete`, `localPath`, `health`).
Seul le pilote `local` est livré : le cluster n'a pas de stockage objet. Un pilote S3 s'ajoute en implémentant cette
interface (`localPath` devant alors télécharger vers un fichier temporaire pour ffmpeg) ; `STORAGE_DRIVER=s3` échoue
aujourd'hui explicitement plutôt que de faire semblant.

## Internationalisation

`src/i18n/messages.ts` : une ligne par chaîne, `[français, English]`. Le français est la langue par défaut ; la langue
est une préférence du compte.

## Clients natifs (SP Music pour macOS)

L'application macOS (`ai.spboucher.spmusic`, dépôt `sp-music-macos`) garde sa propre copie du catalogue et lit hors ligne.
Elle utilise les mêmes surfaces que le site, plus ceci (migration `003_native_clients.sql`) :

| Route | Rôle |
|---|---|
| `GET /api/v1/library/sync?since=<rev>` | Catalogue incrémental : artistes, albums, pistes dont la révision dépasse `since`, et pierres tombales des suppressions. Chaque piste porte son fichier (`assetId`, `sha256`, `sizeBytes`, `mime`) pour le téléchargement vérifié. `more: true` = redemander avec le `rev` reçu. |
| `GET /api/v1/library/sync/me` | Listes (avec leurs entrées), favoris et état de lecture du compte, en une réponse. |
| `GET` / `POST /api/v1/library/history` | Historique d'écoute ; l'identifiant de chaque événement vient du client (renvoi sans doublon). |
| `PATCH playlists/:id`, `PUT playlists/:id/order` | Champ facultatif `baseUpdatedAt` : `409 conflict` si la liste a changé depuis la copie du client (modification faite hors ligne). |
| `POST /api/v1/auth/device/{start,poll,info,decide}` | Association d'appareil (voir SECURITY.md). Page d'approbation : `/appareil`. |
| `GET /.well-known/apple-app-site-association` | Autorise l'application (`APPLE_APP_IDS`) à utiliser les clés d'accès du site. |

**Révisions.** `artists`, `albums` et `tracks` portent une colonne `rev` tirée d'une seule séquence par un déclencheur ; un
verrou consultatif de transaction est pris *avant* le tirage, donc les révisions sont validées dans l'ordre croissant et
la plus haute révision d'une réponse est un curseur sûr. Un changement de fichier (`media_assets`) ou de paroles
(`lyrics`) fait avancer la révision de la piste. La lecture se fait dans un seul instantané (`REPEATABLE READ`).
