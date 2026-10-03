import { defineConfig } from 'vitest/config';
import fs from 'fs';
import path from 'path';

let testDbUrl = 'postgresql://newtonite:newtonite_dev@localhost:5432/newtonite_test';
try {
  const envFile = fs.readFileSync(path.resolve(__dirname, '../.env'), 'utf-8');
  const match = envFile.match(/TEST_DATABASE_URL=(.*)/);
  if (match) {
    testDbUrl = match[1].replace(/["']/g, '');
  }
} catch (e) {
  // Ignore
}

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
    env: {
      DATABASE_URL: testDbUrl
    },
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
