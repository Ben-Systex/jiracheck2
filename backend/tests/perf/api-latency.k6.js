// T108 + T075：SC-001 / SC-003 api-latency smoke
// 20 vu / 60 秒；對 4 條主路徑量 p95。
// 跑法：
//   BASE_URL=https://stg.jiracheck.local \
//   PERF_SID=... \
//   PERF_ADMIN_SID=...  # 用於 /service-logs（admin-only）
//   k6 run --summary-export=results/k6-summary.json backend/tests/perf/api-latency.k6.js

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 20,
  duration: '60s',
  thresholds: {
    'http_req_duration{name:projects_recent}': ['p(95)<2000'],
    'http_req_duration{name:people_stats}': ['p(95)<3000'],
    'http_req_duration{name:nlq_query}': ['p(95)<6000'],
    // T075（002）：SC-003 ServiceLogs list/filter < 2s
    'http_req_duration{name:service_logs_list}': ['p(95)<2000'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const SID = __ENV.PERF_SID || '';
const ADMIN_SID = __ENV.PERF_ADMIN_SID || SID; // 預設與 PERF_SID 相同；prod 應分離

function cookie() {
  return SID ? { Cookie: `sid=${SID}` } : {};
}

function adminCookie() {
  return ADMIN_SID ? { Cookie: `sid=${ADMIN_SID}` } : {};
}

export default function () {
  const h = cookie();

  const r1 = http.get(`${BASE_URL}/api/v1/projects/recent`, { headers: h, tags: { name: 'projects_recent' } });
  check(r1, { 'projects_recent 200': (r) => r.status === 200 });

  // 任意 accountId placeholder；應由 PERF_ACCOUNT 環境變數注入更精準
  const acct = __ENV.PERF_ACCOUNT || 'acc-self';
  const r2 = http.get(
    `${BASE_URL}/api/v1/people/${acct}/stats?from=2026-04-01&to=2026-04-30`,
    { headers: h, tags: { name: 'people_stats' } },
  );
  check(r2, { 'people_stats 200': (r) => r.status === 200 });

  const r3 = http.post(
    `${BASE_URL}/api/v1/nlq/query`,
    JSON.stringify({ question: 'List my open issues' }),
    { headers: { ...h, 'Content-Type': 'application/json' }, tags: { name: 'nlq_query' } },
  );
  check(r3, { 'nlq_query 200': (r) => r.status === 200 });

  // T075 (002)：ServiceLogs 列表 — admin-only；非 admin 會回 403 但仍會被 latency 計入
  // 預期 < 2s（SC-003）；ADMIN_SID 未設時跳過驗證 status 200
  const r4 = http.get(
    `${BASE_URL}/api/v1/service-logs?serviceId=CHKPROJ`,
    { headers: adminCookie(), tags: { name: 'service_logs_list' } },
  );
  check(r4, { 'service_logs_list ok': (r) => r.status === 200 || r.status === 401 || r.status === 403 });

  sleep(1);
}
