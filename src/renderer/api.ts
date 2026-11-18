import type { Result } from '../shared/api';

export class ApiFailure extends Error {
  constructor(
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

/** Desembrulha um Result do IPC; lança ApiFailure com erros por campo. */
export async function call<T>(p: Promise<Result<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new ApiFailure(r.error.message, r.error.fields);
  return r.data;
}

export const api = () => window.banca;

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
