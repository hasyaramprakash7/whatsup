-- Place lookups (area name / pincode → map point, and back), cached so each place is looked up once.
-- lat NULL = "not found" (also cached, so typos are not looked up again).
CREATE TABLE geocache (
  key TEXT PRIMARY KEY,
  lat REAL,
  lng REAL,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
