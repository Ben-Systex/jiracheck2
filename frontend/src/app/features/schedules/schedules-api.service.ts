// T026：US1 排程 API service

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../../core/http/api-config';

export type ServiceId = 'CHKPROJ' | 'CHKISSUE';
export type FrequencyType = 'daily' | 'weekly' | 'monthly' | 'cron';

export interface ScheduleConfig {
  id: string;
  serviceId: ServiceId;
  frequencyType: FrequencyType;
  frequencyValue: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleConfigInput {
  serviceId: ServiceId;
  frequencyType: FrequencyType;
  frequencyValue: string;
  enabled: boolean;
}

export interface ScheduleListResponse {
  items: ScheduleConfig[];
}

export interface ScheduleListFilter {
  enabled?: boolean;
  serviceId?: ServiceId;
}

export interface TriggerResponse {
  serviceLogId: string;
}

@Injectable({ providedIn: 'root' })
export class SchedulesApiService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  list(filter: ScheduleListFilter = {}): Observable<ScheduleListResponse> {
    let params = new HttpParams();
    if (filter.enabled !== undefined) params = params.set('enabled', String(filter.enabled));
    if (filter.serviceId !== undefined) params = params.set('serviceId', filter.serviceId);
    return this.http.get<ScheduleListResponse>(`${this.api.baseUrl}/schedules`, { params });
  }

  get(id: string): Observable<ScheduleConfig> {
    return this.http.get<ScheduleConfig>(`${this.api.baseUrl}/schedules/${id}`);
  }

  create(input: ScheduleConfigInput): Observable<ScheduleConfig> {
    return this.http.post<ScheduleConfig>(`${this.api.baseUrl}/schedules`, input);
  }

  update(id: string, input: ScheduleConfigInput): Observable<ScheduleConfig> {
    return this.http.put<ScheduleConfig>(`${this.api.baseUrl}/schedules/${id}`, input);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.api.baseUrl}/schedules/${id}`);
  }

  trigger(id: string): Observable<TriggerResponse> {
    return this.http.post<TriggerResponse>(`${this.api.baseUrl}/schedules/${id}/trigger`, {});
  }
}
