# Exploitation

## Où tournent les choses

| | |
|---|---|
| Site | https://music.spboucher.ai |
| App mld | `sp-music`, épinglée sur son nœud (`mld status`), port 8690 |
| Dépôt (source de vérité) | sur le nœud : `~/apps/sp-music` ; origin spbgit `sp-music.git` |
| Processus PM2 | `sp-music-web` (`tsx server.ts`), `sp-music-worker`, `sp-music-backup` (cron 03:45) |
| Base | PostgreSQL 17 local, base `sp_music`, rôle `spmusic_app` |
| Bibliothèque | `~/data/sp-music/library` (originaux, pochettes, rendus), mode 0700 |
| Sauvegardes | `~/backups/sp-music` |
| Secrets | `~/apps/sp-music/.env` (0600), `~/.config/sp-music/backup-passphrase` |

## Prérequis du domaine

- DNS : `A music.spboucher.ai → 51.161.112.61` (passerelle BHS64).
- HTTPS : certificat obtenu et renouvelé par Caddy ; HTTP redirigé vers HTTPS. Route posée par `mld deploy` (`tunnel.domain`).
- Le proxy transmet les corps en flux ; un morceau d'envoi fait 8 Mo (`UPLOAD_MAX_CHUNK_MB` borne le serveur) : garder la limite de corps du proxy au-dessus.
- `APP_URL` doit être exactement `https://music.spboucher.ai` : c'est l'origine que WebAuthn vérifie.

## Première installation (faite par le déploiement, pour mémoire)

```bash
# sur le nœud
brew install ffmpeg                                   # ffmpeg + ffprobe
createuser spmusic_app --pwprompt ; createdb -O spmusic_app sp_music
psql -d sp_music -c 'CREATE EXTENSION IF NOT EXISTS citext; CREATE EXTENSION IF NOT EXISTS pg_trgm;'
mkdir -p ~/data/sp-music/library ~/backups/sp-music ~/.config/sp-music && chmod 700 ~/data/sp-music ~/backups/sp-music ~/.config/sp-music
openssl rand -base64 48 > ~/.config/sp-music/backup-passphrase && chmod 600 ~/.config/sp-music/backup-passphrase
cp .env.example .env && chmod 600 .env                # remplir APP_SECRET, DATABASE_URL, OWNER_EMAIL, chemins
# depuis le laptop
mld stage <dossier> sp-music && mld deploy sp-music   # pnpm install, migrations, bootstrap, build, PM2, route HTTPS
```

## Créer le propriétaire et inscrire Face ID / Touch ID

1. Le déploiement a créé le compte propriétaire et écrit un lien à usage unique (24 h) :
   `ssh <nœud> cat ~/data/sp-music/setup-url.txt`
   Lien expiré ? `ssh <nœud>` puis `cd ~/apps/sp-music && node_modules/.bin/tsx scripts/setup-token.ts`.
2. Ouvrir ce lien **sur l'appareil à inscrire** (iPhone, iPad ou Mac), dans Safari.
3. « Créer la clé d'accès » : iOS / macOS affiche sa propre boîte de dialogue et demande Face ID ou Touch ID. Avec le trousseau iCloud activé, la clé est synchronisée sur vos autres appareils Apple.
4. Noter les huit codes de récupération (affichés une seule fois) hors ligne.
5. Autres appareils : `/compte` → Clés d'accès → Ajouter, depuis une session ouverte ; sur un appareil sans session, le navigateur propose d'utiliser un iPhone à proximité (QR code).
6. Installer en PWA : Safari → Partager → « Sur l'écran d'accueil ».

Auditeurs : `/admin` → Comptes → Nouveau compte → transmettre le lien (72 h, usage unique).

## Mettre à jour (sur le nœud — remote-first)

```bash
ssh <nœud> ; cd ~/apps/sp-music
git pull --ff-only                      # ou éditer sur place
pnpm install --frozen-lockfile
node_modules/.bin/tsx scripts/migrate.ts
node_modules/.bin/next build
pm2 restart sp-music-web sp-music-worker
git add -A && git commit -m "…" && git push origin main
```

Les migrations sont transactionnelles et ne s'appliquent qu'une fois ; une migration appliquée puis modifiée fait échouer le déploiement (somme de contrôle). Ne jamais `mld move sp-music` sans déplacer la base et la bibliothèque (voir Restauration).

## Sauvegarde

`scripts/backup.sh`, chaque nuit (PM2 `sp-music-backup`) :

1. **Base** : `pg_dump` chiffré AES-256 → `~/backups/sp-music/db/sp-music-AAAAmmjj-HHMMSS.dump.enc` (30 jours), relu par `pg_restore --list` à chaque exécution.
2. **Bibliothèque** : miroir `rsync` des originaux et des pochettes → `~/backups/sp-music/library/` ; ce qui disparaît de la bibliothèque va dans `trash/<date>/` pendant `BACKUP_TRASH_DAYS` (30). Les rendus et miniatures, dérivés, ne sont pas sauvegardés.
3. `last-backup.json` alimente « Dernière sauvegarde » dans `/admin` → Système.

**À faire par le propriétaire** : cette sauvegarde est sur le même disque que la bibliothèque. Elle protège d'une suppression accidentelle, pas d'une panne du disque. Copie hors nœud, depuis une autre machine :
`rsync -a <nœud>:backups/sp-music/ /chemin/de/sauvegarde/sp-music/` (planifiable ; les processus PM2 du nœud ne peuvent pas joindre le réseau local). Conserver aussi `backup-passphrase` ailleurs : sans elle les dumps sont illisibles.

## Restauration

```bash
createdb -O spmusic_app sp_music                                   # base vide
scripts/restore.sh db ~/backups/sp-music/db/<fichier>.dump.enc "$DATABASE_URL"
scripts/restore.sh library ~/backups/sp-music/library ~/data/sp-music/library
node_modules/.bin/tsx scripts/rebuild-derived.ts                   # vérifie chaque original, refait les miniatures, remet les rendus en file
pm2 restart sp-music-web sp-music-worker
```

`rebuild-derived.ts` sort en erreur et liste tout original manquant. Les clés d'accès sont liées au domaine, pas au nœud : elles restent valides après une restauration tant que `APP_URL` / RP ID ne changent pas. La procédure est exécutée par `pnpm test` à chaque passage.

## Dépannage

| Symptôme | Cause probable / remède |
|---|---|
| « Clés d'accès indisponibles ici » | page ouverte en HTTP, par IP ou sur un autre hôte → ouvrir `https://music.spboucher.ai` |
| La boîte Face ID n'apparaît pas, « demande annulée » | aucune clé de ce site sur l'appareil (trousseau iCloud désactivé ?) → utiliser un autre appareil, un code de récupération, ou un nouveau lien |
| Connexion refusée après un changement de domaine | `APP_URL` ou `WEBAUTHN_RP_ID` modifiés : les clés existantes ne valent que pour l'ancien RP ID |
| Plus aucune clé ni code | sur le nœud : `tsx scripts/setup-token.ts --recovery` |
| Import bloqué sur « reçu » | worker arrêté : `pm2 logs sp-music-worker`, `pm2 restart sp-music-worker` ; `/admin` → Système indique « Traitement » |
| Import en erreur « type refusé » | le contenu n'est pas un format audio accepté (vérifié sur les octets, pas l'extension) |
| « Non lisible ici » sur une piste | DSD sans `TRANSCODE_DSD=true`, ou rendu AAC en préparation / en échec (`/admin` → Bibliothèque → Réanalyser) |
| La lecture ne démarre pas sur iPhone | iOS exige un geste : toucher Lecture. En arrière-plan, iOS garde la lecture d'un `<audio>` et les commandes de l'écran verrouillé ; le volume se règle par les boutons de l'appareil |
| 413 à l'envoi | fichier au-dessus de `UPLOAD_MAX_FILE_MB`, ou morceau au-dessus de la limite du proxy |
| Santé | `curl https://music.spboucher.ai/api/health` → `{ok, db, storage, worker}` |

Journaux : `pm2 logs sp-music-web|sp-music-worker|sp-music-backup` (aucun secret ni contenu audio n'y est écrit).
