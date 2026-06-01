// T053：US3 project-check-lists API service

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../../core/http/api-config';

export interface ProjectCheckListEntry {
  id: string;
  projectKey: string;
  addedBy: string;
  addedAt: string;
  note: string | null;
}

export interface ProjectCheckListListResponse {
  items: ProjectCheckListEntry[];
}

export interface AddProjectCheckListInput {
  projectKey: string;
  note?: string;
}

@Injectable({ providedIn: 'root' })
export class ProjectCheckListsApiService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  list(): Observable<ProjectCheckListListResponse> {
    return this.http.get<ProjectCheckListListResponse>(`${this.api.baseUrl}/project-check-lists`);
  }

  add(input: AddProjectCheckListInput): Observable<ProjectCheckListEntry> {
    return this.http.post<ProjectCheckListEntry>(
      `${this.api.baseUrl}/project-check-lists`,
      input,
    );
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.api.baseUrl}/project-check-lists/${id}`);
  }
}
