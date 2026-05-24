import {
  type HttpEvent,
  type HttpErrorResponse,
  type HttpHandlerFn,
  type HttpInterceptorFn,
  type HttpRequest,
} from '@angular/common/http';
import { catchError, throwError, type Observable } from 'rxjs';
import { isProblemDetails, type ProblemDetails } from './problem';

/**
 * ProblemErrorInterceptor：當 backend 回 RFC 7807，把 HttpErrorResponse
 * 包成 ProblemDetails 拋出，方便 UI 統一處理錯誤。
 * 非 problem+json 的錯誤則包成 internal cause + 通用訊息。
 */
export const problemErrorInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> => {
  return next(req).pipe(
    catchError((err: unknown) => {
      const httpErr = err as HttpErrorResponse;
      if (isProblemDetails(httpErr?.error)) {
        return throwError(() => httpErr.error as ProblemDetails);
      }
      const fallback: ProblemDetails = {
        type: 'https://jiracheck.local/problem/internal',
        title: '發生未預期的錯誤，請稍後再試。',
        status: httpErr?.status ?? 0,
        cause: 'internal',
      };
      return throwError(() => fallback);
    }),
  );
};
