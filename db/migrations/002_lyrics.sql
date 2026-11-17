-- Synchronised lyrics (karaoke view). Generated on the node by a local speech-to-text model from the track's own
-- audio, or typed/corrected by an administrator. Nothing is fetched from or sent to an external lyrics service.
CREATE TABLE lyrics (
  track_id   uuid PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  -- queued → working → ready | empty (no words found: instrumental) | error
  state      text NOT NULL CHECK (state IN ('queued', 'working', 'ready', 'empty', 'error')),
  language   text,                                   -- language of the stored lines (ISO 639-1)
  requested_language text,                           -- hint given when queued; NULL = detect
  source     text NOT NULL DEFAULT 'whisper' CHECK (source IN ('whisper', 'manual')),
  model      text,
  -- [{ "t": startMs, "e": endMs, "text": "…", "w": [[startMs, endMs, "word"], …] }]  ("w" absent on hand-typed lines)
  lines      jsonb NOT NULL DEFAULT '[]',
  edited     boolean NOT NULL DEFAULT false,         -- corrected by hand: never overwritten without an explicit request
  error      text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lyrics_queue ON lyrics (updated_at) WHERE state = 'queued';
