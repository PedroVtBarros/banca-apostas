import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/main/db/database';
import { BancaService } from '../src/main/service';

export function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'banca-test-'));
}

/** Relógio controlável. */
export function makeClock(start = '2026-03-10T12:00:00.000Z') {
  let t = Date.parse(start);
  return {
    now: () => new Date(t),
    set: (iso: string) => {
      t = Date.parse(iso);
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

export function memService(clock = makeClock()) {
  const db = openDatabase(':memory:');
  return { db, svc: new BancaService(db, clock.now), clock };
}

export const iso = (s: string) => new Date(s).toISOString();
