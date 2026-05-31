import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';
import { I18nService } from '../i18n/i18n.service';

/**
 * T029 (002-scheduled-services)：admin-only 路由 guard。
 * - 必須在 authGuard 之後使用（依賴 me 已載入）
 * - 非 admin → 重導 /dashboard，並透過 console.warn 留下痕跡（v1 暫無 toast 元件）
 *
 * 對應 [research R-010](../../../../specs/002-scheduled-services/research.md#r-010frontend-路由與權限導引)
 */
export const adminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const i18n = inject(I18nService);
  await auth.ensureLoaded();
  if (auth.isAdmin()) return true;
  // eslint-disable-next-line no-console
  console.warn('[adminGuard]', i18n.t('admin_required_toast'));
  return router.parseUrl('/dashboard');
};
