import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ButtonComponent } from '../../ui/button/button.component';
import { CardComponent } from '../../ui/card/card.component';
import { AuthService } from '../../core/auth/auth.service';
import { I18nService } from '../../core/i18n/i18n.service';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [ButtonComponent, CardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="min-h-[60vh] flex items-center justify-center px-4">
      <div class="w-full max-w-md">
        <app-card>
          <h1 class="text-2xl font-semibold text-slate-900">{{ i18n.t('login_title') }}</h1>
          <p class="mt-2 text-sm text-slate-600">{{ i18n.t('login_subtitle') }}</p>
          <div class="mt-6">
            <app-button variant="primary" size="lg" (click)="auth.startLogin()">
              {{ i18n.t('login_button') }}
            </app-button>
          </div>
        </app-card>
      </div>
    </div>
  `,
})
export class LoginPageComponent {
  protected readonly auth = inject(AuthService);
  protected readonly i18n = inject(I18nService);
}
