// ESLint flat config（v9）— 對應憲法 I：複雜度 ≤ 10、無懸置 TODO
import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      // 憲法 I：複雜度
      complexity: ['error', 10],
      // 憲法 I：無懸置 TODO（CI 報 warn → 由 ci.yml 把 warning 視為 fail）
      'no-warning-comments': [
        'warn',
        {
          terms: ['todo', 'fixme', 'hack'],
          location: 'start',
        },
      ],
      // TypeScript 推薦規則的子集
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-unused-vars': 'off', // 用 ts 版
      // 不允許 console.log（健康檢查用 logger）
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  prettier,
];
