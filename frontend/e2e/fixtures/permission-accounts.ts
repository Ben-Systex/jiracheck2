// T106：SC-007 跨權限抽測 fixture
// CI secrets：
//   E2E_USER_LOW_USERNAME / E2E_USER_LOW_PASSWORD
//   E2E_USER_HIGH_USERNAME / E2E_USER_HIGH_PASSWORD
// 本地：可填 ops/.env.test（已被 .gitignore 涵蓋）

export interface PermissionAccount {
  username: string;
  password: string;
  /** 該帳號於 Jira 可見的 project keys */
  visibleProjects: readonly string[];
}

const LOW_USERNAME = process.env['E2E_USER_LOW_USERNAME'] ?? '';
const LOW_PASSWORD = process.env['E2E_USER_LOW_PASSWORD'] ?? '';
const HIGH_USERNAME = process.env['E2E_USER_HIGH_USERNAME'] ?? '';
const HIGH_PASSWORD = process.env['E2E_USER_HIGH_PASSWORD'] ?? '';

export const USER_LOW: PermissionAccount = {
  username: LOW_USERNAME,
  password: LOW_PASSWORD,
  visibleProjects: ['PROJ-A'],
};

export const USER_HIGH: PermissionAccount = {
  username: HIGH_USERNAME,
  password: HIGH_PASSWORD,
  visibleProjects: ['PROJ-A', 'PROJ-B', 'PROJ-C'],
};

export function hasPermissionAccounts(): boolean {
  return Boolean(LOW_USERNAME && LOW_PASSWORD && HIGH_USERNAME && HIGH_PASSWORD);
}
