import { InjectionToken } from '@angular/core';

export interface ApiConfig {
  baseUrl: string;
}

export const API_CONFIG = new InjectionToken<ApiConfig>('API_CONFIG', {
  providedIn: 'root',
  // 預設指向同 origin 的 /api/v1（讓 nginx / dev proxy 處理 cross-origin）
  factory: () => ({ baseUrl: '/api/v1' }),
});
