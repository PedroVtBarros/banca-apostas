import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // node:sqlite precisa rodar no processo principal do Node
    pool: 'forks',
  },
});
