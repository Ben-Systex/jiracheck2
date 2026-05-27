import {
  type HttpEvent,
  type HttpErrorResponse,
  type HttpHandlerFn,
  type HttpInterceptorFn,
  type HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError, type Observable } from 'rxjs';
import { isProblemDetails, type ProblemDetails } from './problem';
import { I18nService } from '../i18n/i18n.service';

/**
 * ProblemErrorInterceptor：當 backend 回 RFC 7807，把 HttpErrorResponse
 * 包成 ProblemDetails 拋出，方便 UI 統一處理錯誤。
 * 非 problem+json 的錯誤則包成 internal cause + 通用訊息。
 */
export const problemErrorInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> => {
  const i18n = inject(I18nService);
  return next(req).pipe(
    catchError((err: unknown) => {
      const httpErr = err as HttpErrorResponse;
      if (isProblemDetails(httpErr?.error)) {
        return throwError(() => httpErr.error as ProblemDetails);
      }
      const fallback: ProblemDetails = {
        type: 'https://jiracheck.local/problem/internal',
        title: i18n.t('error_unexpected'),
        status: httpErr?.status ?? 0,
        cause: 'internal',
      };
      return throwError(() => fallback);
    }),
  );
};
