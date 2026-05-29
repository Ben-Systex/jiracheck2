# Atlassian OAuth 2.0 (3LO) 設定

Jira 小幫手以 Atlassian OAuth 2.0 三方授權碼流程（3LO）取得使用者的 Jira 存取權；不儲存使用者密碼。

## 1. 建立 Atlassian app

1. 進入 <https://developer.atlassian.com/console/myapps/>
2. **Create → OAuth 2.0 integration**
3. App 命名（例：`Jira 小幫手 — 內部`）

## 2. 設定 Permissions

新增以下 scopes（須選 `Jira API`）：

- `read:jira-work`
- `read:jira-user`
- `write:jira-work`（US4 批次更新需要）
- `offline_access`（取得 refresh token）

## 3. 設定 Authorization callback URL

- 本機開發：`http://localhost:8080/api/v1/auth/callback`
- Staging/Prod：對應 `ATLASSIAN_OAUTH_REDIRECT_URI`

## 4. 將憑證填入 `ops/.env`

```ini
ATLASSIAN_OAUTH_CLIENT_ID=xxxxx
ATLASSIAN_OAUTH_CLIENT_SECRET=xxxxx
ATLASSIAN_OAUTH_REDIRECT_URI=http://localhost:8080/api/v1/auth/callback
ATLASSIAN_OAUTH_SCOPES=read:jira-work read:jira-user write:jira-work offline_access
```

## 5. 產生 TOKEN_ENC_KEY

refresh token 在 DB 以 AES-256-GCM 加密儲存。產生 32-byte base64 金鑰：

```bash
openssl rand -base64 32
```

寫入 `TOKEN_ENC_KEY`；**不要使用範例值或重複 token**，prod 與 staging 必須各自獨立。
