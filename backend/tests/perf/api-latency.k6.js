// T108：SC-001 api-latency smoke
// 20 vu / 60 秒；對 3 條主路徑量 p95。
// 跑法：
//   BASE_URL=https://stg.jiracheck.local \
//   PERF_SID=... \
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
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const SID = __ENV.PERF_SID || '';

function cookie() {
  return SID ? { Cookie: `sid=${SID}` } : {};
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

  sleep(1);
}
