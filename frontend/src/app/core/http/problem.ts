// 與 backend RFC 7807 對齊；前端 ProblemErrorInterceptor 收到 application/problem+json
// 時將 HttpErrorResponse 包成 ProblemDetails，供 UI 統一呈現

export type ProblemCause =
  | 'validation'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'upstream'
  | 'rate_limited'
  | 'internal';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  cause: ProblemCause;
}

export function isProblemDetails(x: unknown): x is ProblemDetails {
  return (
    typeof x === 'object' &&
    x !== null &&
    'cause' in x &&
    'status' in x &&
    'title' in x
  );
}
