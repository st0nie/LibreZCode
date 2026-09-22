import assert from "node:assert/strict";
import test from "node:test";
import type { CodingPlanBillingDiscountConfig } from "@zcode/shared";
import {
  isCodingPlanBillingDiscountActive,
  resolveCodingPlanBillingDiscountCopy,
} from "@zcode/shared";
import { BigModelCodingPlanSubscriptionProvider } from "../src/coding-plan-subscription/bigmodelCodingPlanSubscriptionProvider.js";

/** 构造最小 ApiClient:按序返回预置 JSON 响应,并记录请求次数。 */
function createFakeApiClient(responses: unknown[]): {
  requestCount: () => number;
  apiClient: {
    request: (
      input: string | URL,
      init?: { method?: string },
    ) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; url: string }>;
  };
} {
  let calls = 0;
  return {
    requestCount: () => calls,
    apiClient: {
      async request(input: string | URL, init?: { method?: string }) {
        assert.equal(init?.method ?? "GET", "GET");
        assert.ok(String(input).includes("/api/v1/client/configs"));
        const payload = responses[Math.min(calls, responses.length - 1)];
        calls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => payload,
          url: String(input),
        };
      },
    },
  };
}

const VALID_CONFIG: CodingPlanBillingDiscountConfig = {
  "zh-CN": {
    badgeBody: "150% 配额",
    infoTitle: "权益规则说明",
    infoBody: "额度消耗按 0.67 系数折算。",
  },
  "en-US": { badgeBody: "150% Quota" },
};

test("shared 解析（GO/JO）:字段级 trim、非字符串丢弃、locale 非对象返回空集", () => {
  const copy = resolveCodingPlanBillingDiscountCopy(
    { "zh-CN": { badgeBody: " 150% 配额 ", infoTitle: 7, infoBody: "  " } },
    "zh-CN",
  );
  assert.equal(copy.badgeBody, "150% 配额");
  assert.equal(copy.infoTitle, undefined);
  assert.equal(copy.infoBody, undefined);
  assert.deepEqual(resolveCodingPlanBillingDiscountCopy({ "zh-CN": "promo" }, "zh-CN"), {});
  assert.deepEqual(resolveCodingPlanBillingDiscountCopy(VALID_CONFIG, "ja-JP"), {});
  assert.equal(isCodingPlanBillingDiscountActive(VALID_CONFIG, "zh-CN"), true);
  assert.equal(isCodingPlanBillingDiscountActive(VALID_CONFIG, "en-US"), true);
  assert.equal(isCodingPlanBillingDiscountActive(VALID_CONFIG, "ja-JP"), false);
  assert.equal(isCodingPlanBillingDiscountActive(undefined, "zh-CN"), false);
});

test("getBillingDiscount: 服务端无活动字段返回 undefined(静默隐藏)", async () => {
  const { apiClient, requestCount } = createFakeApiClient([{ code: 0, data: { configs: {} } }]);
  const provider = new BigModelCodingPlanSubscriptionProvider({
    apiClient,
    credentialService: { load: async () => null },
  });
  assert.equal(await provider.getBillingDiscount(), undefined);
  assert.equal(requestCount(), 1);
});

test("getBillingDiscount: 合法配置原始透出;code!=0 抛错由 UI 静默降级", async () => {
  const { apiClient } = createFakeApiClient([
    { code: 0, data: { configs: { codingPlanBillingDiscount: VALID_CONFIG } } },
    { code: 500, msg: "boom" },
  ]);
  const provider = new BigModelCodingPlanSubscriptionProvider({
    apiClient,
    credentialService: { load: async () => null },
  });
  assert.deepEqual(await provider.getBillingDiscount(), VALID_CONFIG);
  // 快照在 TTL 内有效,同一实例不会重放错误响应;用新实例覆盖失败分支。
  const failingProvider = new BigModelCodingPlanSubscriptionProvider({
    apiClient,
    credentialService: { load: async () => null },
  });
  await assert.rejects(() => failingProvider.getBillingDiscount(), /boom/);
});

test("getBillingDiscount: 复用 1h 快照并发单飞,同周期只打一次远端", async () => {
  const { apiClient, requestCount } = createFakeApiClient([
    { code: 0, data: { configs: { codingPlanBillingDiscount: VALID_CONFIG } } },
  ]);
  const provider = new BigModelCodingPlanSubscriptionProvider({
    apiClient,
    credentialService: { load: async () => null },
  });
  const [a, b, c] = await Promise.all([
    provider.getBillingDiscount(),
    provider.getBillingDiscount(),
    provider.getBillingDiscount(),
  ]);
  assert.deepEqual(a, VALID_CONFIG);
  assert.deepEqual(b, VALID_CONFIG);
  assert.deepEqual(c, VALID_CONFIG);
  assert.equal(requestCount(), 1);
  assert.deepEqual(await provider.getBillingDiscount(), VALID_CONFIG);
  assert.equal(requestCount(), 1);
});
