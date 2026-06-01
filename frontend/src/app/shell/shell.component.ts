import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth/auth.service';
import { I18nService } from '../core/i18n/i18n.service';
import { ButtonComponent } from '../ui/button/button.component';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="min-h-screen bg-slate-50">
      <header class="bg-white border-b border-slate-200">
        <div class="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <a routerLink="/dashboard" class="text-lg font-semibold text-slate-900">{{ i18n.t('app_brand') }}</a>
          <div class="flex items-center gap-3 text-sm">
            @if (auth.me(); as me) {
              <span class="text-slate-600">{{ me.displayName }}</span>
              <app-button variant="ghost" size="sm" (click)="logout()">{{ i18n.t('shell_logout') }}</app-button>
            }
          </div>
        </div>
      </header>
      <div class="max-w-7xl mx-auto px-4 py-6 grid grid-cols-12 gap-6">
        <nav [attr.aria-label]="i18n.t('nav_aria_main')" class="col-span-12 md:col-span-3 lg:col-span-2">
          <ul class="space-y-1 text-sm">
            <li>
              <a
                routerLink="/dashboard"
                routerLinkActive="bg-blue-50 text-blue-700"
                class="block rounded-md px-3 py-2 text-slate-700 hover:bg-slate-100"
              >{{ i18n.t('nav_dashboard') }}</a>
            </li>
            <li>
              <a
                routerLink="/nlq"
                routerLinkActive="bg-blue-50 text-blue-700"
                class="block rounded-md px-3 py-2 text-slate-700 hover:bg-slate-100"
              >{{ i18n.t('nav_nlq') }}</a>
            </li>
            <li>
              <a
                routerLink="/people"
                routerLinkActive="bg-blue-50 text-blue-700"
                class="block rounded-md px-3 py-2 text-slate-700 hover:bg-slate-100"
              >{{ i18n.t('nav_people') }}</a>
            </li>
            <li>
              <a
                routerLink="/bulk"
                routerLinkActive="bg-blue-50 text-blue-700"
                class="block rounded-md px-3 py-2 text-slate-700 hover:bg-slate-100"
              >{{ i18n.t('nav_bulk_update') }}</a>
            </li>
            @if (auth.isAdmin()) {
              <li class="pt-2 mt-2 border-t border-slate-200">
                <a
                  routerLink="/schedules"
                  routerLinkActive="bg-blue-50 text-blue-700"
                  class="block rounded-md px-3 py-2 text-slate-700 hover:bg-slate-100"
                >{{ i18n.t('nav_schedules') }}</a>
              </li>
              <li>
                <a
                  routerLink="/service-logs"
                  routerLinkActive="bg-blue-50 text-blue-700"
                  class="block rounded-md px-3 py-2 text-slate-700 hover:bg-slate-100"
                >{{ i18n.t('nav_service_logs') }}</a>
              </li>
              <li>
                <a
                  routerLink="/project-check-lists"
                  routerLinkActive="bg-blue-50 text-blue-700"
                  class="block rounded-md px-3 py-2 text-slate-700 hover:bg-slate-100"
                >{{ i18n.t('nav_project_check_lists') }}</a>
              </li>
            }
          </ul>
        </nav>
        <main class="col-span-12 md:col-span-9 lg:col-span-10">
          <router-outlet />
        </main>
      </div>
    </div>
  `,
})
export class ShellComponent {
  protected readonly auth = inject(AuthService);
  protected readonly i18n = inject(I18nService);

  async logout(): Promise<void> {
    await this.auth.logout();
    window.location.href = '/login';
  }
}
