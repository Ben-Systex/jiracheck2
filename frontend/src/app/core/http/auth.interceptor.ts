import {
  type HttpEvent,
  type HttpHandlerFn,
  type HttpInterceptorFn,
  type HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError, type Observable } from 'rxjs';

/**
 * AuthInterceptor：所有 API 呼叫帶 cookie；401 自動導向 /login
 * （session cookie 由 backend 設置；前端只需 withCredentials）
 */
export const authInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> => {
  const router = inject(Router);
  const cloned = req.clone({ withCredentials: true });
  return next(cloned).pipe(
    catchError((err: unknown) => {
      const status = (err as { status?: number }).status;
      if (status === 401 && !req.url.includes('/auth/')) {
        // 略過 /auth/* 自身的 401（避免 callback 失敗時無限導回）
        void router.navigate(['/login']);
      }
      return throwError(() => err);
    }),
  );
};
