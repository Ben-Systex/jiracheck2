// 全域 logger（pino）。
// 對應憲法 IV「可觀測性」：所有結構化日誌經此產出，後續可導向 stdout / file / log shipper。

import pino, { type Logger, type LoggerOptions } from 'pino';

function buildOptions(): LoggerOptions {
  const level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info');
  const base: LoggerOptions = {
    level,
    base: { service: 'jiracheck-backend' },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.password',
        '*.token',
        '*.refresh_token',
      ],
      remove: true,
    },
  };
  // 僅當明確要求 PRETTY_LOGS=true 時才掛 pino-pretty（避免 vitest worker 拉不到 transport）
  if (process.env.PRETTY_LOGS === 'true') {
    base.transport = {
      target: 'pino-pretty',
      options: { colorize: true, singleLine: true, translateTime: 'SYS:standard' },
    };
  }
  return base;
}

let cached: Logger | undefined;

export function getLogger(): Logger {
  if (!cached) cached = pino(buildOptions());
  return cached;
}

export function __resetLoggerForTesting(): void {
  cached = undefined;
}
