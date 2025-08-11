import sqlite3 from 'sqlite3';
import { promisify } from 'util';

const db = new sqlite3.Database('./test.db');

// Initialize tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS competitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week_number INTEGER NOT NULL,
    start_at DATETIME NOT NULL,
    end_at DATETIME NOT NULL,
    scoring_mode TEXT DEFAULT 'yolo',
    UNIQUE (week_number)
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    competition_id INTEGER REFERENCES competitions(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (competition_id, user_id)
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER REFERENCES entries(id) ON DELETE CASCADE,
    ticker TEXT NOT NULL,
    side TEXT DEFAULT 'long',
    entry_price REAL,
    entry_time DATETIME,
    exit_price REAL,
    exit_time DATETIME,
    pnl_pct REAL,
    comment TEXT,
    status TEXT DEFAULT 'open'
  )`);
});

const runAsync = promisify(db.run.bind(db));
const allAsync = promisify(db.all.bind(db));

export const query = async (text, params) => {
  if (text.toLowerCase().startsWith('select')) {
    const rows = await allAsync(text, params);
    return { rows };
  } else {
    const result = await runAsync(text, params);
    return { rows: [{ id: result?.lastID }] };
  }
};