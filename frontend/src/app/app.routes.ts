import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { adminGuard } from './core/auth/admin.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/login/login.page').then((m) => m.LoginPageComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./shell/shell.component').then((m) => m.ShellComponent),
    // 各 feature page 於 Phase 3+ 加入；Phase 2 暫以空 router-outlet 顯示
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/dashboard.page').then((m) => m.DashboardPageComponent),
        data: { titleKey: 'nav_dashboard' },
      },
      {
        path: 'projects/:key',
        loadComponent: () =>
          import('./shell/placeholder.component').then((m) => m.PlaceholderComponent),
        data: { titleKey: 'nav_dashboard' },
      },
      {
        path: 'nlq',
        loadComponent: () =>
          import('./features/nlq/nlq.page').then((m) => m.NlqPageComponent),
        data: { titleKey: 'nav_nlq' },
      },
      {
        path: 'people',
        loadComponent: () =>
          import('./features/people/people.page').then((m) => m.PeoplePageComponent),
        data: { titleKey: 'nav_people' },
      },
      {
        path: 'bulk',
        loadComponent: () =>
          import('./features/bulk-update/bulk-update.page').then((m) => m.BulkUpdatePageComponent),
        data: { titleKey: 'nav_bulk_update' },
      },
      {
        path: 'bulk/history',
        loadComponent: () =>
          import('./features/bulk-update/history/history.page').then((m) => m.BulkHistoryPageComponent),
        data: { titleKey: 'nav_bulk_history' },
      },
      // ---- 002-scheduled-services ----
      {
        path: 'schedules',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./features/schedules/schedules.page').then((m) => m.SchedulesPageComponent),
        data: { titleKey: 'nav_schedules' },
      },
      {
        path: 'service-logs',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./features/service-logs/service-logs.page').then(
            (m) => m.ServiceLogsPageComponent,
          ),
        data: { titleKey: 'nav_service_logs' },
      },
      {
        path: 'service-logs/:id',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./features/service-logs/service-log-detail.page').then(
            (m) => m.ServiceLogDetailPageComponent,
          ),
        data: { titleKey: 'nav_service_logs' },
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
