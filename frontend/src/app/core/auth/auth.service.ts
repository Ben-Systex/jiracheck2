import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { API_CONFIG } from '../http/api-config';
import { firstValueFrom } from 'rxjs';

export interface CurrentUser {
  accountId: string;
  displayName: string;
  email: string | null;
  avatarUrl?: string | null;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  private readonly _me = signal<CurrentUser | null>(null);
  private readonly _loaded = signal(false);
  readonly me = computed(() => this._me());
  readonly isLoggedIn = computed(() => this._me() !== null);
  readonly initialized = computed(() => this._loaded());

  /** App 啟動或路由 guard 首次呼叫；失敗（401）視為未登入 */
  async ensureLoaded(): Promise<void> {
    if (this._loaded()) return;
    try {
      const me = await firstValueFrom(this.http.get<CurrentUser>(`${this.api.baseUrl}/me`));
      this._me.set(me);
    } catch {
      this._me.set(null);
    } finally {
      this._loaded.set(true);
    }
  }

  /** 觸發後端 OAuth 流程（瀏覽器 redirect） */
  startLogin(): void {
    window.location.href = `${this.api.baseUrl}/auth/login`;
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.http.post(`${this.api.baseUrl}/auth/logout`, {}));
    } finally {
      this._me.set(null);
    }
  }
}
