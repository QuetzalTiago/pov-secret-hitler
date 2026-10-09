// Local persistence for rooms (SQLite via Node's built-in node:sqlite, no extra dependencies).
// One row per room holding a JSON snapshot. Secrets (tokens, hidden roles, the deck) stay on this machine.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

export interface StoredRoom {
  code: string;
  data: unknown;
  updatedAt: number;
}

/** node:sqlite prints an ExperimentalWarning on load; it is expected here, so keep the console clean. */
function loadSqlite(): typeof import('node:sqlite') {
  const listeners = process.listeners('warning');
  process.removeAllListeners('warning');
  process.on('warning', (w) => {
    if (w.name === 'ExperimentalWarning' && /SQLite/i.test(w.message)) return;
    for (const l of listeners) l(w);
  });
  return process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
}

export class RoomStore {
  private db: DatabaseSync;
  private pending = new Map<string, unknown>();
  private flushScheduled = false;

  constructor(public path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    const { DatabaseSync } = loadSqlite();
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS rooms (
        code TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  /** Queues a snapshot; bursts of changes in the same tick are written once. */
  save(code: string, data: unknown) {
    this.pending.set(code, data);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    setImmediate(() => this.flush());
  }

  flush() {
    this.flushScheduled = false;
    if (!this.pending.size) return;
    const stmt = this.db.prepare(
      'INSERT INTO rooms (code, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(code) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
    );
    const now = Date.now();
    this.db.exec('BEGIN');
    try {
      for (const [code, data] of this.pending) stmt.run(code, JSON.stringify(data), now);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      console.error('[store] write failed', e);
    }
    this.pending.clear();
  }

  delete(code: string) {
    this.pending.delete(code);
    this.db.prepare('DELETE FROM rooms WHERE code = ?').run(code);
  }

  /** Rooms saved within `maxAgeMs`; older ones are dropped. */
  load(maxAgeMs: number): StoredRoom[] {
    const cutoff = Date.now() - maxAgeMs;
    this.db.prepare('DELETE FROM rooms WHERE updated_at < ?').run(cutoff);
    const rows = this.db.prepare('SELECT code, data, updated_at FROM rooms').all() as { code: string; data: string; updated_at: number }[];
    const out: StoredRoom[] = [];
    for (const r of rows) {
      try {
        out.push({ code: r.code, data: JSON.parse(r.data), updatedAt: r.updated_at });
      } catch {
        this.delete(r.code); // corrupt row: drop it rather than crash
      }
    }
    return out;
  }

  close() {
    this.flush();
    this.db.close();
  }
}
