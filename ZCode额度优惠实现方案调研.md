# ZCode 桌面端"额度优惠"实现方案调研文档

> 调研对象:`ZCode-3.14.1-linux-x64.AppImage`(Electron 应用,`@zcode/desktop` v3.14.1,生产 flavor)
> 解包方式:`--appimage-extract` → `resources/app.asar` → `@electron/asar extract`
> 代码分布:`out/host`(主进程业务服务)、`out/renderer`(React UI)、`out/main`(Electron 主进程)、`out/preload`

---

## 1. 结论概览

ZCode 的"额度优惠"(150% 配额活动 / First-time subscription discount 等)是一套**"服务端下发文案 + 客户端纯渲染"**的活动配置体系:

- **客户端不写死任何优惠数值**。"150% 配额"这类活动说明文字全部由服务端 `codingPlanBillingDiscount` 配置下发,客户端只做字段校验、缓存和 UI 呈现。
- 它有三类配套机制:**① 账单优惠徽章/说明**(`billingDiscount`)、**② 首购优惠标记**(`hasFirstTimeSubscriptionPromo`)、**③ 可领取的体验额度**(`manualClaimPlan`,限时领取 tokens)。
- 价格优惠(原价/优惠/实付)的**计算完全在服务端试算接口**完成,客户端只展示返回字段。

---

## 2. 核心数据通道:`/api/v1/client/configs`

**入口(主进程 host 服务)** — `out/host/index.js`:

```
CodingPlanSubscriptionService
 ├─ getClientConfigs()      → GET {base}/api/v1/client/configs?app_version=…&platform={platform}-{arch}
 ├─ getBillingDiscount()    → unwrapClientConfigBillingDiscount(configs)
 └─ getStaticProducts()     → configs.codingPlanStaticProducts(套餐静态目录)
```

- 端点基址:生产 `https://zcode.z.ai`(BigModel 域为 `https://bigmodel.cn`,测试 `dev.bigmodel.cn`),可用 `ZCODE_BASE_URL` / `ZCODE_ENDPOINT_ORIGIN` / `BIGMODEL_API_BASE_URL` 等环境变量覆盖。
- **缓存**:主进程内存快照 `clientConfigSnapshot`,TTL `3600*1e3`(1 小时);并发请求通过 `clientConfigRequest` 单飞去重(promise 复用)。
- **解包函数**(带运行时校验,原名 `unwrapClientConfigBillingDiscount`,压缩后为 `Vpe`):

```js
function unwrapClientConfigBillingDiscount(resp) {
  // resp.code !== 0 → 抛错 "ZCode client config request failed"
  const configs = resp.data?.configs;
  if (configs && "codingPlanBillingDiscount" in configs) return configs.codingPlanBillingDiscount;
  return undefined;
}
```

**下发的配置结构**(从渲染端消费逻辑反推,按 locale 取分支):

```jsonc
{
  "zh-CN": {                     // 键为 locale
    "badgeBody": "…",            // 徽章文字,如"150% 额度加赠"类
    "cardTitle": "…", "cardBody": "…",   // 套餐卡片文案
    "infoTitle":  "…",           // 点击 ⓘ 后弹窗的标题
    "infoBody":   "…"            // 弹窗 Markdown 正文(活动规则说明)
  },
  "en-US": { … }
}
```

客户端仅做字符串 trim 校验(`isNonEmptyString` / `isValidCardCopyConfigItem`,`{text, tooltip?}` 数组或纯字符串),**没有任何数值/规则解析**——活动规则本身就是 Markdown 文本渲染。

---

## 3. 渲染端链路(RPC → Hook → UI)

### 3.1 数据获取 Hook(压缩名 `d0e`,即 `useCodingPlanBillingDiscount`)

```js
// 渲染端通过 RPC 调主进程服务:Yh()?.codingPlanSubscriptionService.getBillingDiscount()
const TTL = 3600 * 1e3; // 渲染端再缓存 1h(UO 全局单例)
async function load(service) {
  if (cache && cache.expiresAt > Date.now()) return cache.value; // 模块级跨组件共享
  const v = await service.getBillingDiscount();
  cache = { value: v, expiresAt: Date.now() + TTL };
  return v;
}
// 失败处理:J.warn("[CodingPlanBillingDiscount] 读取 Coding Plan 活动配置失败")
//          → active=false,整个活动 UI 静默隐藏
// 激活条件:f0e(config, locale, ["badgeBody"]) —— 当前 locale 有非空 badgeBody 才算 active
```

### 3.2 UI 组件(三个消费点)

| 组件                        | 位置          | 呈现                                                                                                                                                            |
| --------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KO` (BillingDiscountBadge) | 通用徽章      | 胶囊徽章:渐变底 / 白底 `surface` / `tag` 三种变体,内容为 `badgeBody`                                                                                            |
| `qO` (BillingDiscountInfo)  | 通用 ⓘ 弹窗   | `aria-label` 用 i18n `settings.modelProvider.codingPlan.billingDiscountInfo.open` = **"查看 150% 配额活动说明"**;正文渲染 `## infoTitle + infoBody` 的 Markdown |
| `p0e` (badge+info 组合)     | 徽章 + 可点 ⓘ | 渲染端唯一完整组合                                                                                                                                              |

**消费场景**:

1. **设置页套餐卡片**:升级/续费按钮 `zbn` 内嵌 `KO(variant=surface)` + `qO`,渐变按钮样式仅在活动激活时启用(`billingDiscountActive = G && L.active`,G 为 startPlan 判定);
2. **会话内额度不足横幅**(`ext` 组件):配额耗尽提示的"升级"按钮同样内嵌徽章与活动说明;
3. **用量余额面板**(`$pt`):余额标题行的"升级"小按钮附带活动徽章。

即:**额度优惠的露出点 = 所有引导用户升级/续费套餐的按钮旁**。

---

## 4. 与价格相关的优惠字段(购买链路)

个人套餐价格来自 `POST /pay/batch-preview`(z.ai)或 `/pay/preview`(试算,含 `ticket/randstr` 验证码参数、`salesChannel:"zcode"`),企业套餐来自 `/subscription/enterprise/v2/pricing`(未登录走 `/campaign/partner/enterprise/pricing`)。返回后合并进套餐列表(`Lht` 映射):

```js
{
  originalAmount, discountAmount, payAmount, renewAmount,
  monthlyOriginalAmount, monthlyRenewAmount, monthlyPayAmount,
  hasFirstTimeSubscriptionPromo,     // → 徽章文案 i18n: "首购优惠"/"First-time subscription discount"
  campaignDiscountDetails,           // 优惠活动明细
  canPurchase, soldOut, forbidden, canRepurchase, delay, …
}
```

- 展示价 `nht()`:`payAmount ?? renewAmount`,兜底 `max(0, originalAmount - discountAmount)`(保留 2 位小数);
- 优惠金额的**扣减、抵扣(余额/赠金)、原价**全部由服务端试算返回;客户端只有"订单原价 / {discount}优惠 / 实付金额"等展示逻辑,且支付预览放在内嵌 WebView:
  - URL:`https://zcode.z.ai/coding-plan?embedded=app&provider=…&lang=…&theme=…`(可选 `audience`、`teamPlanKey`)
  - 注入:`localStorage` 写入 OAuth token + `zcodejwttoken`,主题/语言注入
  - 回调校验:路径必须为 `/coding-plan/payment/callback` 且 `returnTo` 同源含 `embedded=app`

---

## 5. 配套的"额度"类活动(对比说明)

| 机制                                | 触达                    | 实现                                                                                                                                                                                                                                               | 服务端接口               |
| ----------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **额度优惠徽章**(本文主题)          | 升级/续费按钮旁         | `codingPlanBillingDiscount` 纯文案配置                                                                                                                                                                                                             | `/api/v1/client/configs` |
| **首购优惠**                        | 套餐卡片                | `hasFirstTimeSubscriptionPromo` 布尔 → i18n 文案                                                                                                                                                                                                   | `/pay/batch-preview`     |
| **可领取体验套餐**(限时领取 Tokens) | 侧栏 banner"限时可领取" | `manualClaimPlan`:GET 预览 `/api/v1/zcode-plan/billing/preview`,POST 领取 `/api/v1/zcode-plan/billing/claim`(带阿里云验证码头 `X-Aliyun-Captcha-Verify-Param`,错误码区分 `alreadyClaimed/quotaExhausted/ineligible/captcha…`),含票券动画、分享文案 | zcode-plan billing       |
| **营销弹窗活动**(marketing touch)   | 应用内活动弹窗          | `GET/POST /api/v1/marketing/touch(/action)`,下发 `kind:"campaign"` 的 dialog JSON(标题/正文/hero 图/按钮+action:`claim_plan`、`open_external`…),客户端 zod 校验 `schemaVersion:1`                                                                  | marketing/touch          |
| **闲时任务**(免费额度类)            | 专用功能页              | "不消耗套餐额度、面向订阅用户免费",走 off-peak 队列 API(`/api/v1/off-peak*`)                                                                                                                                                                       | off-peak                 |

---

## 6. 设计要点总结(可借鉴)

1. **活动配置与代码解耦**:优惠活动上线/下线/改文案不需要发版——改 `client/configs` 的 `codingPlanBillingDiscount` 即可;客户端 TTL 1h 双层缓存(主进程 + 渲染端模块级),最迟 1 小时生效。
2. **纯文案下发而非规则下发**:活动规则("150% 配额")是 Markdown 文本,数值计算全部留在服务端(试算接口),客户端不存在被篡改套利的空间。
3. **优雅降级**:任何一层失败(接口错误、字段缺失、locale 无文案)都只是"活动 UI 整体隐藏",不影响正常购买流程。
4. **多 locale 结构**:配置按 `zh-CN`/`en-US` 分支,激活判定绑定当前 locale 是否有对应文案。
5. **露出点收敛**:活动徽章只挂在"升级/续费/额度不足"三类转化点上,并有埋点(`upgradeSource` / `eventRegion` / `eventText` funnel 上下文)。

---

## 附录:关键代码索引

| 内容                                                                             | 位置                                               |
| -------------------------------------------------------------------------------- | -------------------------------------------------- |
| `getClientConfigs` / `getBillingDiscount`(主进程,含缓存)                         | `out/host/index.js` ≈ 891900                       |
| `unwrapClientConfigBillingDiscount`(配置解包校验)                                | `out/host/index.js` ≈ 905743                       |
| `batchPreview` / `preview` / `claimManualPlan`                                   | `out/host/index.js`(同文件)                        |
| 徽章/弹窗组件 `GO/KO/qO/p0e`                                                     | `out/renderer/assets/styles-CuFc3dtZ.js` ≈ 1310000 |
| Hook `d0e` / 加载器 `m0e`(渲染端 TTL 缓存)                                       | 同上 ≈ 1309600                                     |
| 升级按钮 `zbn`(内嵌活动徽章)                                                     | 同上 ≈ 5348690                                     |
| 额度不足横幅 `ext`(内嵌活动徽章)                                                 | 同上 ≈ 2358784                                     |
| 套餐价格映射 `FU/eht/Lht`(`hasFirstTimeSubscriptionPromo` 等)                    | 同上 ≈ 1950000–1961000                             |
| 购买 WebView 构建 `e3e/$4e`、凭据注入 `n3e`                                      | 同上 ≈ 1370000–1382000                             |
| i18n 文案(`billingDiscountInfo.open`、`product.firstPromo`、`manualClaimPlan.*`) | `out/renderer/assets/IntlProvider-DW5rmeLm.js`     |
| 端点基址解析(zcode.z.ai / bigmodel.cn / chat.z.ai)                               | `out/host/chunk-GVBBGMXG.js` ≈ 573300–577100       |

---

## 本目录实现说明(zai-org/ZCode @ main)

按上述调研在本仓库(开源版原本注释"开源版不享受额度活动权益")落地了同构的额度优惠逻辑:

### 实现位置

| 层       | 文件                                                                                                                                                                                                | 说明                                                                                                                                                                                                |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| shared   | `packages/shared/src/codingPlanBillingDiscount.ts`(新增)                                                                                                                                            | 活动配置类型 + 边界校验 `parseCodingPlanBillingDiscount`(非法结构 fail-closed 返回 null)+ locale 取文案 + 激活判据(非空 `badgeBody`)                                                                |
| services | `packages/services/src/coding-plan-subscription/codingPlanSubscription.ts`                                                                                                                          | `ICodingPlanSubscriptionService` 新增 `getBillingDiscount()`                                                                                                                                        |
| services | `packages/services/src/coding-plan-subscription/bigmodelCodingPlanSubscriptionProvider.ts`                                                                                                          | envelope 增加 `configs.codingPlanBillingDiscount`;`unwrapClientConfigBillingDiscount`(`code!==0` 抛错/缺失返回 null/结构非法 fail-closed);复用既有 `getClientConfigs` 1h 快照 + 并发单飞,零新增请求 |
| services | `packages/services/src/coding-plan-subscription/codingPlanSubscriptionService.ts`                                                                                                                   | 工厂接线 `getBillingDiscount`                                                                                                                                                                       |
| ui       | `packages/ui/src/hooks/codingPlanBillingDiscountCache.ts`(新增)                                                                                                                                     | UI 侧模块级 1h TTL 缓存 + 并发单飞(独立于 React,可单测;失败不写缓存,避免一次抖动隐藏活动 1h)                                                                                                        |
| ui       | `packages/ui/src/hooks/useCodingPlanBillingDiscount.ts`(新增)                                                                                                                                       | hook:`{active, config, loading}`;任何失败静默降级 `active=false`                                                                                                                                    |
| ui       | `packages/ui/src/settings/model-provider-section/CodingPlanBillingDiscountBadge.tsx`(新增)                                                                                                          | `WithCodingPlanBillingDiscount` 组合(按钮 + 徽章 + ⓘ HoverCard,说明正文用 `MessageResponse` 渲染服务端下发的 Markdown)                                                                              |
| 露出点   | `CodingPlanStatusActions.tsx`(设置页升级/续费按钮)、`StartPlanContextBalance.tsx`(余额面板升级按钮)、`ConversationQuotaBanner.tsx`(额度不足横幅)                                                    | 三类转化点,未激活时 UI 与原行为完全一致                                                                                                                                                             |
| i18n     | `packages/ui/src/i18n/locales/zh-CN.ts` / `en-US.ts`                                                                                                                                                | `billingDiscountInfo.open` = "查看 150% 配额活动说明" / "View 150% quota campaign details"                                                                                                          |
| 测试     | `packages/services/test/codingPlanBillingDiscount.test.ts`(7 例)、`packages/ui/test/codingPlanBillingDiscountCache.test.ts`(4 例)、`packages/ui/test/codingPlanBillingDiscountBadge.test.tsx`(2 例) | 覆盖:合法解析/非法 fail-closed/激活判据/code!=0 抛错/无活动 null/并发单飞 1 次请求/TTL 过期重拉/失败不写缓存/SSR 激活渲染/三种降级路径                                                              |

### 数据流

```
client/configs (configs.codingPlanBillingDiscount, 按 locale)
  → BigModelCodingPlanSubscriptionProvider.getBillingDiscount (1h 快照 + 单飞, code!=0 抛错)
  → useCodingPlanBillingDiscount (UI 1h TTL 缓存 + 单飞, 失败静默降级)
  → WithCodingPlanBillingDiscount (badgeBody 非空才激活; 徽章 + ⓘ Markdown 说明)
  → 设置页升级按钮 / 余额面板升级按钮 / 额度不足横幅
```

### 运行与验证

```bash
pnpm typecheck                                  # 通过
pnpm lint                                       # 通过(70 个存量警告, 0 错误, 无新增)
pnpm fmt:check                                  # 通过
pnpm architecture:check -- --changed            # 通过(violations: 0)
pnpm exec tsx --test packages/services/test/codingPlanBillingDiscount.test.ts   # 7 pass
cd packages/ui && ../../node_modules/.bin/tsx --test \
  test/codingPlanBillingDiscountCache.test.ts test/codingPlanBillingDiscountBadge.test.tsx  # 6 pass
```

注:开源版服务端当前未下发 `codingPlanBillingDiscount` 时,所有活动 UI 自动隐藏,行为与实现前完全一致;待服务端按上述结构下发配置即生效。
