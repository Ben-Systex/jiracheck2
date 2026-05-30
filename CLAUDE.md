<!-- SPECKIT START -->
Current plan: specs/002-scheduled-services/plan.md
Related artifacts:
- Spec: specs/002-scheduled-services/spec.md
- Research: specs/002-scheduled-services/research.md
- Data model: specs/002-scheduled-services/data-model.md
- API contract: specs/002-scheduled-services/contracts/api.openapi.yaml
- Quickstart: specs/002-scheduled-services/quickstart.md

Previous feature: specs/001-jira-assistant/（已合入 main，v0.1.0）

Tech stack snapshot:
- Frontend: Angular 19 (standalone) + Tailwind CSS + ng2-charts
- Backend: Express + TypeScript + @modelcontextprotocol/sdk (SSE → mcp-atlassian)
- MCP: ghcr.io/sooperset/mcp-atlassian (external container)
- LLM: Anthropic Claude (claude-sonnet-4-6 / haiku 4-5 fallback)
- Storage: PostgreSQL 16
- Scheduler (002): node-cron + cron-parser + PG advisory lock
- Deploy: Docker Compose (ops/)
- Tests: Vitest (backend) + Angular Testing Library + Playwright (E2E)
- Observability: prom-client + @opentelemetry/api（沿用 001 之 /metrics endpoint）

Constitution: .specify/memory/constitution.md (v1.0.0; testing NON-NEGOTIABLE; zh-TW user-facing text)
<!-- SPECKIT END -->
