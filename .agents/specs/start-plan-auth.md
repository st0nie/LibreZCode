# 闭源 3.14.1 Start Plan 鉴权链路(curl 逆向提取)

## 结论:x-coding-plan-api-key 来源

Start Plan 调 GLM 用**双凭证**:

- `Authorization: Bearer <zcodeJwtToken>`
- `X-Coding-Plan-Api-Key: <codingPlanApiKey>`

`zcodeJwtToken` 来自 OAuth `/api/v1/oauth/token` 响应的 `data.token`。
`codingPlanApiKey` 通过 `accountProviderCredentialService.loadCodingPlanApiKey`:
先查缓存 → 无则用 accessToken(JWT) 调 `resolveProviderApiKey(family, accessToken)` 换取。

## access.type

个人 Start Plan 用 **`zhipu-coding-plan-api-key`** 访问类型(区别于普通 `api-key`)。
enum: `["api-key", "zhipu-coding-plan-api-key"]`

## GLM 模型推理端点(Anthropic 兼容)

- base: `https://api.z.ai/api/v1/zcode-plan/anthropic` + `/v1/messages`
- 请求头:
  - `content-type: application/json`
  - `authorization: Bearer <zcodeJwtToken>`
  - `x-coding-plan-api-key: <codingPlanApiKey>`
- 判定:`pathname.includes("/api/anthropic") || includes("/zcode-plan/anthropic")` → anthropic 类型

## OAuth 端点

- authorize: `/api/v1/oauth/authorize`(appId `zcode`,redirectUri `zcode://oauth/callback`)
- token: `/api/v1/oauth/token`
- 响应: `{ access_token, refresh_token?, token (=zcodeJwtToken), expires_in }`
- ZAI: appId `client_P8X5CMWmlaRO9gyO-KSqtg`, userinfo `https://chat.z.ai/api/oauth/userinfo`, login `https://api.z.ai/api/auth/z/login`

## 团队/组织 API key(不同链路)

`AccountProviderApiKeyResolver`: `getCustomerInfo` → `organization/{id}` → `apikey/list` → `apikey/{key}/copy`
端点: `/api/biz/customer/getCustomerInfo`, `/api/biz/v1/organization/{orgId}`

## entitlement/badge 端点

- Start Plan quota: 见 usage-stats(bigmodelUsageQuotaProvider)
- 闭源有 `/api/v1/zcode-plan/anthropic`(推理) + billing/claim + billing/preview

## 数据链路(左下角 badge)

登录 → OAuth token(data.token=zcodeJwtToken) → resolveCurrent(reason:"usage") → loadCodingPlanApiKey(JWT 换 apiKey) → entitlement 快照 → hasActiveCodingPlanSnapshot → badge 显示剩余 remaining.count

## 开源现状

- `loadCodingPlanApiKey` / `resolveProviderApiKey` / `accountProviderCredentialService` **已存在**(packages/services/src/model-provider/accountProviderCredentialService.ts)
- 但 **GLM 模型调用路径(/api/v1/zcode-plan/anthropic)+ 该端点的鉴权头注入未实现**
- Start Plan entitlement 的 provider.id 匹配可能不一致致 badge 不显示

## curl 实测验证(2026-09-22)

- 解密 `~/.zcode/v2/credentials.json`:AES-256-GCM,key=sha256(`zcode-credential-fallback:{platform}:{homedir}:{username}`)
- zcodejwttoken 已解密(255 chars, eyJ... JWT)
- coding-plan-api-key credential key: `account-provider:coding-plan:account:zai-individual-coding-plan:account:{id}:api-key`,已解密(49 chars)
- **GLM 端点**: `POST https://api.z.ai/api/anthropic/v1/messages`(非 zcode-plan/anthropic,那 404)
- **实测**: 带 JWT + x-coding-plan-api-key → HTTP 401 `token expired or incorrect`
- **根因**: zcodejwttoken 已过期,无 refresh_token(oauth:zai:access_token 是纯 string,存的是旧 access_token)

## auth_failed 结论

用户遇到的 provider_code=3007 auth_failed 根因是 **zcodejwttoken 过期**,不是缺 x-coding-plan-api-key,也不是开源实现缺链路。凭证基础设施(loadCodingPlanApiKey/resolveProviderApiKey/coding-plan-api-key.ts)开源已齐全。需重新登录刷新 JWT。

## Start Plan entitlement/badge 端点(curl 实测确认)

- **quota 端点**: `GET https://api.z.ai/api/monitor/usage/quota/limit`(可带 `?model=GLM-5.3`)
- 请求头: `Authorization: Bearer <zcodejwttoken>` + `X-Coding-Plan-Api-Key: <codingPlanApiKey>`
- 响应: `{code, msg, success, data}`;token 过期时 `code:401, msg:"token expired or incorrect"`(网关 HTTP 200,业务 401)
- 代码链路: `useUsageEntitlement` → `IUsageStatsService.getEntitlementSnapshot` → `BigModelUsageQuotaProvider.getCodingPlanUsageSnapshot` → `buildZaiQuotaUrl` → 上述端点
- 返回的 `remaining.count` 即 badge 显示的剩余 token 数

## badge 渲染链路(已接线)

`useUsageEntitlementWithService` → service.getEntitlementSnapshot → snapshot.remaining.count → `WorkspaceSidebarFooterPlanBadge`(已加 compact remaining 显示)→ 左下角渲染

## 二次诊断:token 已刷新,真实根因是风控(2026-09-22 重登后)

用户重新登录后 zcodejwttoken 已刷新(iat=2026-09-22T07:44,无 exp),但 GLM 调用仍失败。

### 两个 JWT 的关键区别

| token                        | 长度     | 用途                                                                |
| ---------------------------- | -------- | ------------------------------------------------------------------- |
| `zcodejwttoken`              | 255      | 平台 session,只有 {user_id, token_version:0, iat},**无 exp**        |
| **`oauth:zai:access_token`** | **1404** | **业务 token**,payload 含 user_type:PERSONAL, user_key, customer_id |

### curl 实测(用 1404 业务 token)

- `POST /api/anthropic/v1/messages` + oauth:zai:access_token → **HTTP 429 rate_limit code 1113 "Insufficient balance or no resource package"**(鉴权通过!)
- `GET /api/monitor/usage/quota/limit` + oauth:zai:access_token → **500 "当前用户不存在coding plan"**
- `GET zcode.z.ai/api/v1/zcode-plan/billing/current` + zcodejwttoken → **405 code 3012 "request has been blocked due to unusual activity"** ← **风控拦截!**

### 真正根因

1. **调 GLM 应用 oauth:zai:access_token(1404),不是 zcodejwttoken(255)**
2. **请求被 ZAI 网关风控拦截(3012 unusual activity)** —— 可能是 curl 高频请求触发,或 IP/设备指纹异常
3. 该账号 oauth token 对应 customer 无 coding plan 资源包(429 insufficient balance)

### 正确端点(Start Plan)

- 模型推理: `POST {zcode-origin}/api/v1/zcode-plan/anthropic/v1/messages`
- 额度余额: `GET {zcode-origin}/api/v1/zcode-plan/billing/balance?app_version={v}`
- 当前套餐: `GET {zcode-origin}/api/v1/zcode-plan/billing/current?app_version={v}`
- {zcode-origin} = https://zcode.z.ai
- 请求头: `Authorization: <zcodejwttoken>`(裸 token,闭源码 headers:{Authorization:t},t 即完整 Bearer 串由调用方传)

### badge 数据

billing/balance 或 billing/current 返回的余额 → 左下角 badge。需应用正常登录态(非风控)才能拉到。
