# 闭源 3.14.1 marketingTouch 契约(逆向提取)

## 服务端点

- GET `{base}/api/v1/marketing/touch?seq=<n>` — 查询当前营销触达配置
- POST `{base}/api/v1/marketing/touch/action` — 上报用户操作
- base 默认 `https://zcode.z.ai`(可 `ZCODE_BASE_URL` 覆盖)

## 请求头

- `X-Device-Mid: <uuid>`(从 deviceMid 服务取)
- `X-Client-Language: zh-CN|en-US`
- `X-ZCode-App-Version: <appVersion>`
- 可选 `Authorization: Bearer <zcodejwttoken>`

## touch 响应 schema(HM)

```ts
{
  schemaVersion: 1,           // literal(1)
  id: string,                 // campaign id
  revision: number(int, positive),
  kind: "campaign" | "feature" | "notice",
  locale: "zh-CN" | "en-US",
  dialog: {
    title: string(1-500),
    description: { format: "plain_text"|"html"|"markdown", text: string(max 20000) },
    hero?: GM,                // image/video/lottie
    buttons: [{ id, label(1-200), variant: "primary"|"secondary"|"link", theme?, actionId }](max 4)
  },
  actions: Record<string, KM> // actionId -> action
}
```

## action schema(KM, discriminatedUnion by type)

- `{ type: "close" }`
- `{ type: "dismiss_content" }`
- `{ type: "navigate", destination: "model_settings"|"plugin_store"|"settings" }`
- `{ type: "copy_text", text: string(max 20000) }`
- `{ type: "open_external", url: string }`
- `{ type: "claim_plan", planId: string }`

## report 请求体(I3)

```ts
{ locale: "zh-CN"|"en-US", scope: uuid, campaignId: string(1-128), actionType: "confirm"|"cancel" }
```

## 错误

- `marketing_identity_changed`: scope 校验失败(token 变更后 scope 不同)
- code!==0 抛错

## i18n 键(已补齐)

- marketingTouch.idle/verifying/submitting/preparing/failed/uncertain/succeeded
- rewards.title/menuTitle/menuBadge/loadFailed/openWebsite
