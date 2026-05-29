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
      // 排除：純 bootstrap / 外部 SDK wrapper / 純型別檔——
      // 這些需要整合測試（docker / 真實 SDK）才有意義，單元測試只是反向重現邏輯。
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.d.ts',
        'src/server.ts',
        'src/mcp/sse-session.ts',
        'src/mcp/types.ts',
        'src/services/nlq/llm.ts',
      ],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80,
      },
    },
  },
});
