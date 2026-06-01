// T045：project_check_lists repository（feature 002-scheduled-services / US3）
// CHKPROJ 服務之輸入清單；admin-only 全域資源。

import type { Pool } from 'pg';

export interface ProjectCheckListEntry {
  id: string;
  projectKey: string;
  addedBy: string;
  addedAt: Date;
  note: string | null;
}

export interface AddEntryArgs {
  projectKey: string;
  addedBy: string;
  note?: string | null;
}

export interface ProjectCheckListsRepo {
  list(): Promise<ProjectCheckListEntry[]>;
  add(args: AddEntryArgs): Promise<ProjectCheckListEntry>;
  remove(id: string): Promise<boolean>;
  getByProjectKey(projectKey: string): Promise<ProjectCheckListEntry | null>;
  listProjectKeys(): Promise<string[]>;
}

interface RawRow {
  id: string;
  project_key: string;
  added_by: string;
  added_at: Date;
  note: string | null;
}

function rowToEntry(r: RawRow): ProjectCheckListEntry {
  return {
    id: r.id,
    projectKey: r.project_key,
    addedBy: r.added_by,
    addedAt: r.added_at,
    note: r.note,
  };
}

const COLS = 'id, project_key, added_by, added_at, note';

export function createProjectCheckListsRepo(pool: Pool): ProjectCheckListsRepo {
  return {
    async list() {
      const { rows } = await pool.query<RawRow>(
        `SELECT ${COLS} FROM project_check_lists ORDER BY added_at DESC`,
      );
      return rows.map(rowToEntry);
    },

    async add(args) {
      const { rows } = await pool.query<RawRow>(
        `INSERT INTO project_check_lists (project_key, added_by, note)
         VALUES ($1, $2, $3)
         RETURNING ${COLS}`,
        [args.projectKey, args.addedBy, args.note ?? null],
      );
      return rowToEntry(rows[0]!);
    },

    async remove(id) {
      const { rowCount } = await pool.query(
        `DELETE FROM project_check_lists WHERE id = $1`,
        [id],
      );
      return (rowCount ?? 0) > 0;
    },

    async getByProjectKey(projectKey) {
      const { rows } = await pool.query<RawRow>(
        `SELECT ${COLS} FROM project_check_lists WHERE project_key = $1`,
        [projectKey],
      );
      const r = rows[0];
      return r ? rowToEntry(r) : null;
    },

    async listProjectKeys() {
      const { rows } = await pool.query<{ project_key: string }>(
        `SELECT project_key FROM project_check_lists ORDER BY added_at`,
      );
      return rows.map((r) => r.project_key);
    },
  };
}
