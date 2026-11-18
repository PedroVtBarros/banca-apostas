/**
 * Ciclo de vida do banco: abrir, migrar, fazer backup e restaurar (trocando o arquivo com segurança).
 * Independe do Electron para poder ser testado com Vitest.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  autoBackup,
  backupBeforeMigration,
  exportDatabase,
  listBackups,
  timestamp,
  validateBackupFile,
} from './backup';
import { getSchemaVersion, openDatabase, type Db } from './db/database';
import { BancaService } from './service';
import { ValidationError } from '../core/validation';

export class DbManager {
  private db!: Db;
  service!: BancaService;
  readonly dbFile: string;
  readonly backupsDir: string;

  constructor(
    readonly dataDir: string,
    private readonly clock: () => Date = () => new Date(),
  ) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.dbFile = path.join(dataDir, 'banca.db');
    this.backupsDir = path.join(dataDir, 'backups');
  }

  open(): void {
    backupBeforeMigration(this.dbFile, this.backupsDir);
    this.db = openDatabase(this.dbFile);
    this.service = new BancaService(this.db, this.clock);
    autoBackup(this.db, this.backupsDir, this.clock());
  }

  close(): void {
    try {
      this.db?.close();
    } catch {
      /* já fechado */
    }
  }

  schemaVersion(): number {
    return getSchemaVersion(this.db);
  }

  info() {
    return {
      dbPath: this.dbFile,
      dbSizeBytes: fs.existsSync(this.dbFile) ? fs.statSync(this.dbFile).size : 0,
      dataDir: this.dataDir,
      backupsDir: this.backupsDir,
      autoBackups: listBackups(this.backupsDir),
      schemaVersion: this.schemaVersion(),
    };
  }

  exportTo(target: string): void {
    exportDatabase(this.db, target);
  }

  /**
   * Substitui o banco atual pelo conteúdo de `source`. Valida o arquivo, guarda uma cópia do banco
   * atual e só então troca; em caso de falha, volta ao banco anterior.
   */
  restoreFrom(source: string): void {
    validateBackupFile(source);
    fs.mkdirSync(this.backupsDir, { recursive: true });
    const safety = path.join(this.backupsDir, `antes-da-restauracao-${timestamp(this.clock())}.db`);
    exportDatabase(this.db, safety);

    this.close();
    const tmp = this.dbFile + '.restore';
    try {
      fs.copyFileSync(source, tmp);
      for (const suffix of ['-journal', '-wal', '-shm']) {
        const f = this.dbFile + suffix;
        if (fs.existsSync(f)) fs.unlinkSync(f);
      }
      fs.renameSync(tmp, this.dbFile);
      this.db = openDatabase(this.dbFile);
      this.service = new BancaService(this.db, this.clock);
    } catch (e) {
      // Reverte para o banco anterior.
      try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        fs.copyFileSync(safety, this.dbFile);
        this.db = openDatabase(this.dbFile);
        this.service = new BancaService(this.db, this.clock);
      } catch (e2) {
        console.error('Falha ao reverter restauração:', e2);
      }
      throw new ValidationError(
        `Não foi possível restaurar o backup: ${(e as Error).message}. Seus dados anteriores foram mantidos.`,
      );
    }
    this.service.logSystem('restore', `Backup restaurado do arquivo "${path.basename(source)}".`);
  }
}
