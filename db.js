import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

const DB_PATH = path.join(process.cwd(), 'data.sqlite');

function ensure() {
  const exists = fs.existsSync(DB_PATH);
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription_id INTEGER NOT NULL,
      task_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      fire_at INTEGER NOT NULL,
      sent INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(subscription_id) REFERENCES subscriptions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_schedules_fire ON schedules(fire_at, sent);
  `);
  return db;
}

const db = ensure();

export const Subscriptions = {
  upsert({ endpoint, keys }) {
    const sel = db.prepare('SELECT id FROM subscriptions WHERE endpoint = ?').get(endpoint);
    if (sel) return sel.id;
    const info = db.prepare(
      'INSERT INTO subscriptions(endpoint, p256dh, auth, created_at) VALUES(?,?,?,?)'
    ).run(endpoint, keys.p256dh, keys.auth, Date.now());
    return info.lastInsertRowid;
  },
  getById(id) {
    return db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id);
  },
  getByEndpoint(endpoint) {
    return db.prepare('SELECT * FROM subscriptions WHERE endpoint = ?').get(endpoint);
  }
};

export const Schedules = {
  insert({ subscription_id, task_id, title, body, fire_at }) {
    const info = db.prepare(
      'INSERT INTO schedules(subscription_id, task_id, title, body, fire_at, created_at) VALUES(?,?,?,?,?,?)'
    ).run(subscription_id, task_id, title, body ?? '', fire_at, Date.now());
    return info.lastInsertRowid;
  },
  markSent(id) {
    db.prepare('UPDATE schedules SET sent = 1 WHERE id = ?').run(id);
  },
  pending() {
    return db.prepare('SELECT * FROM schedules WHERE sent = 0 AND fire_at >= ?').all(Date.now());
  }
};