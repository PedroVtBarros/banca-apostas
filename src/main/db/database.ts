import { DatabaseSync } from 'node:sqlite';
import { migrate, getSchemaVersion } from './migrations';

export type Db = DatabaseSync;

/** Abre (ou cria) o banco, aplica PRAGMAs de segurança e migrations pendentes. */
export function openDatabase(file: string): Db {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  // Durabilidade total: cada commit é sincronizado no disco (sobrevive a queda de energia).
  db.exec('PRAGMA synchronous = FULL');
  db.exec('PRAGMA busy_timeout = 5000');
  migrate(db);
  return db;
}

export { getSchemaVersion };

/** Executa fn dentro de uma transação (BEGIN IMMEDIATE/COMMIT; ROLLBACK em qualquer erro). */
export function inTransaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* já revertido */
    }
    throw e;
  }
}
