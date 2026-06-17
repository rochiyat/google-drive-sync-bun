import { Database } from 'bun:sqlite';

export const db = new Database('sync.db');

db.exec(`
CREATE TABLE IF NOT EXISTS files(
 id TEXT PRIMARY KEY,
 name TEXT,
 path TEXT,
 modified TEXT
)
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
