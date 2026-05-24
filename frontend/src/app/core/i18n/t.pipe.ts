import { Pipe, type PipeTransform, inject } from '@angular/core';
import { I18nService } from './i18n.service';
import type { MessageKey } from './messages';

/** 模板中使用：{{ 'login_button' | t }} */
@Pipe({ name: 't', standalone: true, pure: true })
export class TPipe implements PipeTransform {
  private readonly i18n = inject(I18nService);
  transform(key: MessageKey, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }
}
