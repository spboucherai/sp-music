# Sécurité

## Clés d'accès (WebAuthn)

- **RP ID** : `music.spboucher.ai` (hôte de `APP_URL` ; `WEBAUTHN_RP_ID` permet un domaine parent). **Origine attendue** : `https://music.spboucher.ai`, comparée à l'identique. Le développement utilise `http://localhost:8690` (RP ID `localhost`), dans une base distincte.
- **Vérifié côté serveur à chaque opération** : challenge à usage unique (la ligne est supprimée à sa lecture, 5 minutes de validité), signature, origine, RP ID, présence **et vérification** de l'utilisateur (`userVerification: required`, `requireUserVerification: true`), compteur.
- **Stocké** : identifiant de la clé, clé publique, compteur, transports, type d'appareil, indicateur de synchronisation, nom, dates de création et de dernière utilisation. **Jamais** de clé privée ni de donnée biométrique : Face ID et Touch ID restent sur l'appareil, le site ne reçoit qu'une signature.
- Plusieurs clés par compte, renommables et révocables (`/compte`). La dernière clé ne peut pas être retirée depuis l'interface.
- Clés découvrables : la connexion n'envoie aucune liste de comptes ; une clé inconnue et une signature fausse produisent la même réponse.

### Si le site est ouvert autrement

| Adresse | Effet |
|---|---|
| `http://music.spboucher.ai` | redirigé en HTTPS par Caddy |
| adresse IP, `nœud:8690`, autre sous-domaine | pas de contexte sûr ou RP ID différent : le navigateur refuse WebAuthn ; la page de connexion l'explique ; aucune clé ne peut être créée ni utilisée |
| `http://localhost:8690` | développement seulement (contexte sûr par exception) |

## Création du propriétaire, comptes, récupération

- `scripts/bootstrap.ts` crée l'unique compte propriétaire depuis `OWNER_EMAIL` et, **tant qu'il n'a aucune clé d'accès**, écrit un lien d'inscription à usage unique (24 h) dans `SETUP_URL_FILE` (mode 0600) — jamais dans un journal. Dès qu'une clé existe, plus aucun lien n'est émis : le mode d'installation est fermé. Il n'y a ni `admin/admin`, ni mot de passe, ni secret par défaut.
- Seul le SHA-256 des jetons est en base ; le jeton voyage dans le fragment d'URL (`#…`), qui n'apparaît ni dans les requêtes, ni dans les journaux du proxy, ni dans `Referer`.
- **Aucune inscription publique.** Un compte n'existe que parce qu'un administrateur l'a créé (`/admin` → Comptes) ; il reçoit un lien d'inscription à usage unique, affiché une seule fois (72 h).
- **Récupération** : (1) huit codes à usage unique, affichés une fois à la première clé, stockés hachés ; (2) pour le propriétaire, depuis le shell du nœud : `tsx scripts/setup-token.ts [--recovery]` ; `--recovery` remplace toutes les clés et ferme toutes les sessions ; (3) pour les autres comptes, un nouveau lien émis par un administrateur. Il n'existe aucune autre voie.

## Sessions

Cookie `spmusic_session` : jeton aléatoire de 256 bits (seul son SHA-256 est en base), `HttpOnly`, `Secure` en production, `SameSite=Lax`, sans attribut `Domain` (jamais envoyé à un autre sous-domaine de spboucher.ai), 30 jours. Un nouveau jeton à chaque authentification. Révocation côté serveur : par l'utilisateur (une session, ou toutes les autres), par un administrateur (toutes les sessions d'un compte), par la suspension du compte, par la récupération.

**CSRF** : toute requête modifiante doit venir de notre origine (`Origin`, `Sec-Fetch-Site`) et porter le jeton CSRF de la session dans `X-CSRF-Token`.

## Autorisation

Rôle lu en base à chaque requête. `/api/v1/admin/*` passe par `requireAdmin` avant toute recherche de gestionnaire ; masquer un bouton n'est jamais l'autorisation. Les données personnelles (listes, favoris, état de lecture, clés, sessions) sont filtrées par `user_id` : l'identifiant d'un autre compte répond `404`. Le propriétaire ne peut être ni rétrogradé, ni suspendu, ni supprimé.

## Téléversement

Type vérifié sur le contenu ; tailles bornées à la création, à chaque morceau (compté en flux) et à l'analyse ; quota optionnel ; espace disque vérifié. Les noms de fichiers ne servent qu'à l'affichage (nettoyés) : les chemins de stockage sont construits par le serveur à partir d'empreintes et d'UUID, et le pilote refuse toute clé hors de sa racine. Images : JPEG/PNG/WebP, 25 Mo et 8000 px par côté au plus.

## En-têtes

CSP (`default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, aucune origine tierce), `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy`. Les réponses audio et image ajoutent `Cross-Origin-Resource-Policy: same-origin` et un cache strictement privé. Aucune ressource externe n'est chargée ; aucun titre écouté ni fichier n'est transmis à un service tiers.

## Limitation de débit et journal

Compteurs en base par adresse : authentification 30 / 10 min, codes de récupération 5 / 15 min. Échecs de connexion journalisés avec leur cause, sans secret. `audit_events` consigne les actions d'administration (import remplacé, édition, suppression avec titre et empreinte du fichier, comptes, sessions) ; jamais de contenu audio, de cookie, de jeton, de code ni de challenge. Les erreurs renvoyées au client ne contiennent ni trace, ni chemin.

## Limites connues

- `script-src` et `style-src` autorisent `'unsafe-inline'` (amorçage de Next.js sans nonce). Aucun contenu tiers n'est chargé.
- Le port 8690 du nœud est joignable depuis le réseau local sans TLS ; l'en-tête `X-Forwarded-For` y est falsifiable (seule la limitation de débit en dépend). L'accès prévu passe par la passerelle.
- Les originaux ne sont pas chiffrés au repos par l'application (dossier en mode 0700 sur le nœud) ; les sauvegardes de la base le sont.
- La sauvegarde quotidienne est sur le même disque que la bibliothèque tant qu'une copie hors nœud n'est pas mise en place (voir OPERATIONS.md).
- Pas de service worker : pas de lecture hors ligne.
