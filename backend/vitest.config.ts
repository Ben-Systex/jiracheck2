import { defineConfig } from 'vitest/config';

// 預設關閉 CSRF 強制（保留既有 supertest 測試行為；csrf.spec.ts 自行測該規則）
process.env['BYPASS_CSRF'] ??= 'true';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.spec.ts', 'src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/**/*.d.ts'],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80,
      },
    },
  },
});
