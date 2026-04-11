import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'proxy-inspector/src/shared'),
    },
  },
  test: {
    include: ['test_scripts/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
  },
});
