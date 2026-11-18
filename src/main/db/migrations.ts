/**
 * Migrations versionadas via PRAGMA user_version. Cada migration roda em UMA transação.
 * Para evoluir o banco: adicione um novo item ao final (nunca altere os já publicados).
 */
import type { DatabaseSync } from 'node:sqlite';

export interface Migration {
  version: number;
  description: string;
  up: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Esquema inicial: casas, movimentações, apostas e histórico',
    up: `
      CREATE TABLE houses (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        name                  TEXT    NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(name)) > 0),
        initial_balance_cents INTEGER NOT NULL DEFAULT 0 CHECK (initial_balance_cents >= 0),
        initial_balance_at    TEXT    NOT NULL,
        archived              INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
        created_at            TEXT    NOT NULL,
        updated_at            TEXT    NOT NULL
      );

      CREATE TABLE transactions (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        house_id     INTEGER NOT NULL REFERENCES houses(id) ON DELETE RESTRICT,
        kind         TEXT    NOT NULL CHECK (kind IN ('deposit', 'withdrawal')),
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        occurred_at  TEXT    NOT NULL,
        note         TEXT    NOT NULL DEFAULT '',
        created_at   TEXT    NOT NULL,
        updated_at   TEXT    NOT NULL
      );
      CREATE INDEX idx_transactions_house ON transactions(house_id, occurred_at);

      CREATE TABLE bets (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        house_id    INTEGER NOT NULL REFERENCES houses(id) ON DELETE RESTRICT,
        stake_cents INTEGER NOT NULL CHECK (stake_cents > 0),
        odds_milli  INTEGER NOT NULL CHECK (odds_milli > 1000),
        placed_at   TEXT    NOT NULL,
        settled_at  TEXT,
        status      TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'green', 'red', 'void')),
        description TEXT    NOT NULL DEFAULT '',
        notes       TEXT    NOT NULL DEFAULT '',
        created_at  TEXT    NOT NULL,
        updated_at  TEXT    NOT NULL,
        CHECK ((status = 'pending') = (settled_at IS NULL))
      );
      CREATE INDEX idx_bets_house  ON bets(house_id);
      CREATE INDEX idx_bets_placed ON bets(placed_at);
      CREATE INDEX idx_bets_status ON bets(status);

      CREATE TABLE audit_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        at          TEXT    NOT NULL,
        entity_type TEXT    NOT NULL CHECK (entity_type IN ('bet', 'house', 'transaction', 'system')),
        entity_id   INTEGER,
        action      TEXT    NOT NULL,
        summary     TEXT    NOT NULL,
        before_json TEXT,
        after_json  TEXT
      );
      CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
      CREATE INDEX idx_audit_at     ON audit_log(at);
    `,
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

export function getSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  return row.user_version;
}

/** Aplica migrations pendentes. Retorna as versões aplicadas. */
export function migrate(db: DatabaseSync, migrations: Migration[] = MIGRATIONS): number[] {
  const current = getSchemaVersion(db);
  const applied: number[] = [];
  for (const m of migrations) {
    if (m.version <= current) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(m.up);
      db.exec(`PRAGMA user_version = ${Number(m.version)}`);
      db.exec('COMMIT');
      applied.push(m.version);
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`Falha na migration ${m.version} (${m.description}): ${(e as Error).message}`);
    }
  }
  return applied;
}
