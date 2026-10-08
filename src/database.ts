import { Database } from 'bun:sqlite';
import path from 'path';

const DB_PATH = process.env.DB_PATH || 'sync.db';
export const db = new Database(DB_PATH);

// Initialize schema
db.exec(`
CREATE TABLE IF NOT EXISTS files(
 id TEXT PRIMARY KEY,
 name TEXT,
 path TEXT,
 modified TEXT
);

CREATE TABLE IF NOT EXISTS auth_state(
 key TEXT PRIMARY KEY,
 value TEXT
);
`);

export function isUpToDate(id: string, modified: string) {
  const row = db.prepare('select modified from files where id=?').get(id) as
    | { modified: string }
    | undefined;
  return row ? row.modified === modified : false;
}

export function saveFile(
  id: string,
  name: string,
  path: string,
  modified: string
) {
  db.prepare(
    `
 INSERT OR REPLACE INTO files
 VALUES(?,?,?,?)
 `
  ).run(id, name, path, modified);
}

export function getAuthState(key: string): string | null {
  const row = db.prepare('SELECT value FROM auth_state WHERE key=?').get(key) as
    | { value: string }
    | undefined;
  return row ? row.value : null;
}

export function setAuthState(key: string, value: string) {
  db.prepare(
    `
 INSERT OR REPLACE INTO auth_state(key, value)
 VALUES(?, ?)
 `
  ).run(key, value);
}

export function deleteAuthState(key: string) {
  db.prepare('DELETE FROM auth_state WHERE key=?').run(key);
}
