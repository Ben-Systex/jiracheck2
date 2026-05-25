import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

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
          import('./shell/placeholder.component').then((m) => m.PlaceholderComponent),
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
          import('./shell/placeholder.component').then((m) => m.PlaceholderComponent),
        data: { titleKey: 'nav_bulk_update' },
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
