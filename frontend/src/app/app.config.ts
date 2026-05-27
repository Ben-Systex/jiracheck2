import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';

import { routes } from './app.routes';
import { authInterceptor } from './core/http/auth.interceptor';
import { problemErrorInterceptor } from './core/http/problem.interceptor';
import { csrfInterceptor } from './core/http/csrf.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    // 順序：先 problem（攔截 error 包成 ProblemDetails）→ 再 auth（401 redirect）
    provideHttpClient(
      withFetch(),
      withInterceptors([problemErrorInterceptor, authInterceptor, csrfInterceptor]),
    ),
    provideCharts(withDefaultRegisterables()),
  ],
};
