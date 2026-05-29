// T095：CSRF double-submit — 對狀態變更請求（POST/PUT/PATCH/DELETE）
// 從 document.cookie 讀 csrf token 並帶到 X-CSRF-Token header。
// 若無 cookie（首次載入前）則不加，由後端決定（dev / test 通常 BYPASS_CSRF）。

import type { HttpInterceptorFn } from '@angular/common/http';

const CSRF_COOKIE = 'csrf';
const CSRF_HEADER = 'X-CSRF-Token';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const csrfInterceptor: HttpInterceptorFn = (req, next) => {
  if (!MUTATING_METHODS.has(req.method.toUpperCase())) return next(req);
  const token = readCsrfCookie();
  if (!token) return next(req);
  return next(req.clone({ setHeaders: { [CSRF_HEADER]: token } }));
};

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const pairs = document.cookie.split(';').map((s) => s.trim());
  for (const p of pairs) {
    const idx = p.indexOf('=');
    if (idx === -1) continue;
    if (p.slice(0, idx) === CSRF_COOKIE) return decodeURIComponent(p.slice(idx + 1));
  }
  return null;
}
