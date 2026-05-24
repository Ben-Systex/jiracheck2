import { Injectable } from '@angular/core';
import { messages, type MessageKey } from './messages';

@Injectable({ providedIn: 'root' })
export class I18nService {
  /** 取得文字；可帶 params 做佔位符替換（{key} 形式） */
  t(key: MessageKey, params?: Record<string, string | number>): string {
    let s: string = messages[key];
    if (!params) return s;
    for (const [k, v] of Object.entries(params)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
    return s;
  }
}
