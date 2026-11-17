-- Music SP — initial schema. The database holds metadata and references only; audio lives in private storage.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Accounts and authentication ──────────────────────────────────────────────────────────────────────
CREATE TABLE users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        citext NOT NULL UNIQUE,
  display_name text NOT NULL,
  role         text NOT NULL DEFAULT 'listener' CHECK (role IN ('admin', 'listener')),
  is_owner     boolean NOT NULL DEFAULT false,
  locale       text NOT NULL DEFAULT 'fr' CHECK (locale IN ('fr', 'en')),
  accent       text NOT NULL DEFAULT 'ember',
  disabled_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_single_owner ON users (is_owner) WHERE is_owner;

-- Passkeys: public data only (credential id, public key, counter, metadata).
CREATE TABLE authenticators (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE,
  public_key    bytea NOT NULL,
  counter       bigint NOT NULL DEFAULT 0,
  transports    text[] NOT NULL DEFAULT '{}',
  device_type   text,
  backed_up     boolean NOT NULL DEFAULT false,
  name          text NOT NULL DEFAULT 'Passkey',
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz
);
CREATE INDEX authenticators_user ON authenticators (user_id);

-- One-time enrolment tokens: owner setup and recovery (shell only), listener/admin invitations (admin panel).
CREATE TABLE setup_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  purpose    text NOT NULL CHECK (purpose IN ('setup', 'recovery', 'invite')),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recovery_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  text NOT NULL UNIQUE,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE webauthn_challenges (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge  text NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('registration', 'authentication')),
  user_id    uuid REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  csrf_token   text NOT NULL,
  method       text NOT NULL,
  user_agent   text NOT NULL DEFAULT '',
  ip           text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);
CREATE INDEX sessions_user ON sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE rate_limits (
  key          text NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

CREATE TABLE audit_events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  actor      text NOT NULL,
  action     text NOT NULL,
  entity     text NOT NULL DEFAULT '',
  entity_id  text NOT NULL DEFAULT '',
  meta       jsonb NOT NULL DEFAULT '{}',
  ip         text
);
CREATE INDEX audit_events_at ON audit_events (at DESC);

CREATE TABLE worker_heartbeat (
  name    text PRIMARY KEY,
  beat_at timestamptz NOT NULL DEFAULT now(),
  info    jsonb NOT NULL DEFAULT '{}'
);

-- ── Library ──────────────────────────────────────────────────────────────────────────────────────────
-- *_norm columns hold the lower-cased, accent-stripped form used for search and duplicate constraints.
CREATE TABLE artists (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  name_norm  text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX artists_trgm ON artists USING gin (name_norm gin_trgm_ops);

CREATE TABLE genres (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name      text NOT NULL,
  name_norm text NOT NULL UNIQUE
);

-- Cover art, deduplicated by content hash. Files: art/<sha256>/orig.<ext> and art/<sha256>/<size>.jpg
CREATE TABLE artworks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sha256     text NOT NULL UNIQUE,
  mime       text NOT NULL,
  width      integer NOT NULL,
  height     integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE albums (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text NOT NULL,
  title_norm text NOT NULL,
  artist_id  uuid NOT NULL REFERENCES artists(id) ON DELETE RESTRICT,
  year       integer CHECK (year BETWEEN 1000 AND 2999),
  genre_id   uuid REFERENCES genres(id) ON DELETE SET NULL,
  artwork_id uuid REFERENCES artworks(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artist_id, title_norm)
);
CREATE INDEX albums_trgm ON albums USING gin (title_norm gin_trgm_ops);
CREATE INDEX albums_created ON albums (created_at DESC);

CREATE TABLE tracks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  title_norm   text NOT NULL,
  artist_id    uuid NOT NULL REFERENCES artists(id) ON DELETE RESTRICT,
  album_id     uuid NOT NULL REFERENCES albums(id) ON DELETE RESTRICT,
  track_no     integer,
  disc_no      integer NOT NULL DEFAULT 1,
  year         integer CHECK (year BETWEEN 1000 AND 2999),
  genre_id     uuid REFERENCES genres(id) ON DELETE SET NULL,
  duration_ms  integer NOT NULL DEFAULT 0,
  codec        text NOT NULL,
  container    text NOT NULL,
  sample_rate  integer,
  bit_depth    integer,
  channels     integer,
  bitrate      integer,
  -- 'yes': every supported browser decodes the original; 'some': Safari only (ALAC, AIFF); 'no': DSD and the like
  web_playable text NOT NULL CHECK (web_playable IN ('yes', 'some', 'no')),
  -- compatibility rendition (AAC): none | queued | working | ready | error | disabled
  compat_state text NOT NULL DEFAULT 'none' CHECK (compat_state IN ('none', 'queued', 'working', 'ready', 'error', 'disabled')),
  compat_error text,
  analysis_requested boolean NOT NULL DEFAULT false,   -- admin asked for a fresh analysis (worker picks it up)
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tracks_album ON tracks (album_id, disc_no, track_no);
CREATE INDEX tracks_artist ON tracks (artist_id);
CREATE INDEX tracks_trgm ON tracks USING gin (title_norm gin_trgm_ops);
CREATE INDEX tracks_compat ON tracks (compat_state) WHERE compat_state = 'queued';
CREATE INDEX tracks_analysis ON tracks (id) WHERE analysis_requested;

-- Every stored file: the untouched original, derived renditions, cover originals and thumbnails.
-- storage_key is an opaque key resolved by the storage driver; it never comes from a client.
CREATE TABLE media_assets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('original', 'rendition', 'artwork', 'thumbnail')),
  storage_key text NOT NULL UNIQUE,
  sha256      text,
  size_bytes  bigint NOT NULL,
  mime        text NOT NULL,
  track_id    uuid REFERENCES tracks(id) ON DELETE CASCADE,
  artwork_id  uuid REFERENCES artworks(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((track_id IS NULL) <> (artwork_id IS NULL))
);
-- One original per track, and the same audio file cannot be stored twice.
CREATE UNIQUE INDEX media_assets_original_track ON media_assets (track_id) WHERE kind = 'original';
CREATE UNIQUE INDEX media_assets_original_sha ON media_assets (sha256) WHERE kind = 'original';
CREATE UNIQUE INDEX media_assets_rendition_track ON media_assets (track_id) WHERE kind = 'rendition';
CREATE INDEX media_assets_artwork ON media_assets (artwork_id);

-- ── Imports (also the processing queue of the worker) ────────────────────────────────────────────────
CREATE TABLE uploads (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  parent_id      uuid REFERENCES uploads(id) ON DELETE CASCADE,   -- entry extracted from an archive
  filename       text NOT NULL,                                    -- display only, sanitised
  size_bytes     bigint NOT NULL,
  received_bytes bigint NOT NULL DEFAULT 0,
  -- uploading → received → validating → extracting → ready | duplicate | error | cancelled
  status         text NOT NULL DEFAULT 'uploading'
                 CHECK (status IN ('uploading', 'received', 'validating', 'extracting', 'ready', 'duplicate', 'error', 'cancelled')),
  error_code     text,
  error_detail   text,
  sha256         text,
  kind           text,                                             -- detected from content: flac, mp3, zip…
  track_id       uuid REFERENCES tracks(id) ON DELETE SET NULL,
  duplicate_of   uuid REFERENCES tracks(id) ON DELETE SET NULL,
  replace        boolean NOT NULL DEFAULT false,                   -- admin confirmed replacing the duplicate
  attempts       integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX uploads_queue ON uploads (created_at) WHERE status = 'received';
CREATE INDEX uploads_recent ON uploads (created_at DESC);

-- ── Per-user data ────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE playlists (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX playlists_user ON playlists (user_id, updated_at DESC);

CREATE TABLE playlist_tracks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id uuid NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id    uuid NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position    integer NOT NULL,
  added_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX playlist_tracks_order ON playlist_tracks (playlist_id, position);

CREATE TABLE favorites (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id   uuid NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, track_id)
);

CREATE TABLE favorite_albums (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  album_id   uuid NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, album_id)
);

-- Resume: the queue, the position in it and the player preferences of each account.
CREATE TABLE playback_state (
  user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  queue       uuid[] NOT NULL DEFAULT '{}',
  queue_index integer NOT NULL DEFAULT 0,
  position_ms integer NOT NULL DEFAULT 0,
  shuffle     boolean NOT NULL DEFAULT false,
  repeat      text NOT NULL DEFAULT 'off' CHECK (repeat IN ('off', 'all', 'one')),
  volume      real NOT NULL DEFAULT 1 CHECK (volume BETWEEN 0 AND 1),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
