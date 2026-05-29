<!-- SPECKIT START -->
Current plan: specs/001-jira-assistant/plan.md
Related artifacts:
- Spec: specs/001-jira-assistant/spec.md
- Research: specs/001-jira-assistant/research.md
- Data model: specs/001-jira-assistant/data-model.md
- API contract: specs/001-jira-assistant/contracts/api.openapi.yaml
- Quickstart: specs/001-jira-assistant/quickstart.md

Tech stack snapshot:
- Frontend: Angular 19 (standalone) + Tailwind CSS + ng2-charts
- Backend: Express + TypeScript + @modelcontextprotocol/sdk (SSE → mcp-atlassian)
- MCP: ghcr.io/sooperset/mcp-atlassian (external container)
- LLM: Anthropic Claude (claude-sonnet-4-6 / haiku 4-5 fallback)
- Storage: PostgreSQL 16
- Deploy: Docker Compose (ops/)
- Tests: Vitest (backend) + Angular Testing Library + Playwright (E2E)

Constitution: .specify/memory/constitution.md (v1.0.0; testing NON-NEGOTIABLE; zh-TW user-facing text)
<!-- SPECKIT END -->
