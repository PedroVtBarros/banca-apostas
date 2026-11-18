import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { ValidationError } from '../core/validation';
import type { BackupFileInfo } from '../shared/types';
import type { Db } from './db/database';
import { LATEST_SCHEMA_VERSION } from './db/migrations';

const REQUIRED_TABLES = ['houses', 'transactions', 'bets', 'audit_log'];

export function timestamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Cópia consistente do banco em um único arquivo (VACUUM INTO), sem parar o app. */
export function exportDatabase(db: Db, target: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) fs.unlinkSync(target);
  db.prepare('VACUUM INTO ?').run(target);
}

/** Confere se um arquivo é um backup válido e compatível. Lança ValidationError em português. */
export function validateBackupFile(file: string): { schemaVersion: number } {
  let probe: DatabaseSync | null = null;
  try {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new ValidationError('Arquivo não encontrado.');
    const head = Buffer.alloc(16);
    const fd = fs.openSync(file, 'r');
    try {
      fs.readSync(fd, head, 0, 16, 0);
    } finally {
      fs.closeSync(fd);
    }
    if (head.toString('latin1') !== 'SQLite format 3\0') {
      throw new ValidationError('O arquivo selecionado não é um backup válido do aplicativo.');
    }
    probe = new DatabaseSync(file, { readOnly: true });
    const integrity = probe.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (integrity.integrity_check !== 'ok') throw new ValidationError('O arquivo de backup está corrompido.');
    const tables = new Set(
      (probe.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name),
    );
    for (const t of REQUIRED_TABLES) {
      if (!tables.has(t)) throw new ValidationError('O arquivo selecionado não é um backup válido do aplicativo.');
    }
    const version = (probe.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    if (version > LATEST_SCHEMA_VERSION) {
      throw new ValidationError('Este backup foi criado por uma versão mais nova do aplicativo. Atualize o aplicativo para restaurá-lo.');
    }
    if (version < 1) throw new ValidationError('O arquivo selecionado não é um backup válido do aplicativo.');
    return { schemaVersion: version };
  } catch (e) {
    if (e instanceof ValidationError) throw e;
    throw new ValidationError('Não foi possível ler o arquivo de backup. Ele pode estar corrompido ou não ser do aplicativo.');
  } finally {
    try {
      probe?.close();
    } catch {
      /* ignore */
    }
  }
}

export function listBackups(dir: string): BackupFileInfo[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.db'))
    .map((name) => {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      return { name, path: p, sizeBytes: st.size, modifiedAt: st.mtime.toISOString() };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

/** Backup automático diário (mantém os 10 mais recentes). Falhas aqui nunca derrubam o app. */
export function autoBackup(db: Db, dir: string, now = new Date()): string | null {
  try {
    const has = (db.prepare('SELECT COUNT(*) AS n FROM houses').get() as { n: number }).n > 0;
    if (!has) return null;
    const day = timestamp(now).slice(0, 10);
    const target = path.join(dir, `automatico-${day}.db`);
    if (fs.existsSync(target)) return null;
    exportDatabase(db, target);
    const autos = fs
      .readdirSync(dir)
      .filter((n) => n.startsWith('automatico-') && n.endsWith('.db'))
      .sort();
    for (const old of autos.slice(0, Math.max(0, autos.length - 10))) fs.unlinkSync(path.join(dir, old));
    return target;
  } catch (e) {
    console.error('Falha no backup automático:', e);
    return null;
  }
}

/** Antes de migrar um banco existente para um esquema mais novo, guarda uma cópia de segurança. */
export function backupBeforeMigration(dbFile: string, dir: string): string | null {
  if (!fs.existsSync(dbFile)) return null;
  let probe: DatabaseSync | null = null;
  try {
    probe = new DatabaseSync(dbFile, { readOnly: true });
    const v = (probe.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    probe.close();
    probe = null;
    if (v >= LATEST_SCHEMA_VERSION || v === 0) return null;
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `antes-da-migracao-v${v}-${timestamp()}.db`);
    fs.copyFileSync(dbFile, target);
    return target;
  } catch (e) {
    console.error('Falha ao criar backup pré-migração:', e);
    try {
      probe?.close();
    } catch {
      /* ignore */
    }
    return null;
  }
}
