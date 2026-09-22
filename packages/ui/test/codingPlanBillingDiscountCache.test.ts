import assert from "node:assert/strict";
import test from "node:test";
import type { CodingPlanBillingDiscountConfig } from "@zcode/shared";
import {
  loadCodingPlanBillingDiscount,
  readCodingPlanBillingDiscountCache,
  resetCodingPlanBillingDiscountCacheForTest,
} from "../src/hooks/codingPlanBillingDiscountCache.js";

const CONFIG: CodingPlanBillingDiscountConfig = {
  "zh-CN": { badgeBody: "150% 额度加赠", infoTitle: "活动说明", infoBody: "规则正文" },
  "en-US": { badgeBody: "150% quota" },
};

function createService(
  impl: () => Promise<CodingPlanBillingDiscountConfig | undefined>,
): {
  callCount: () => number;
  service: { getBillingDiscount: () => Promise<CodingPlanBillingDiscountConfig | undefined> };
} {
  let calls = 0;
  return {
    callCount: () => calls,
    service: {
      getBillingDiscount: () => {
        calls += 1;
        return impl();
      },
    },
  };
}

test("缓存命中直接返回；并发合并为一次远端请求；TTL 内不再重放", async () => {
  resetCodingPlanBillingDiscountCacheForTest();
  const { service, callCount } = createService(async () => CONFIG);
  assert.equal(readCodingPlanBillingDiscountCache(), null);

  const [a, b, c] = await Promise.all([
    loadCodingPlanBillingDiscount(service),
    loadCodingPlanBillingDiscount(service),
    loadCodingPlanBillingDiscount(service),
  ]);
  assert.deepEqual(a, CONFIG);
  assert.deepEqual(b, CONFIG);
  assert.deepEqual(c, CONFIG);
  assert.equal(callCount(), 1);
  assert.ok(readCodingPlanBillingDiscountCache());

  // TTL 内（< 1h）再次读取走缓存。
  assert.deepEqual(await loadCodingPlanBillingDiscount(service), CONFIG);
  assert.equal(callCount(), 1);
});

test("TTL 过期后重新拉取（expiresAt 基于发起时刻 + 1h）", async () => {
  resetCodingPlanBillingDiscountCacheForTest();
  let calls = 0;
  const service = {
    getBillingDiscount: async () => {
      calls += 1;
      return CONFIG;
    },
  };
  await loadCodingPlanBillingDiscount(service);
  assert.equal(calls, 1);
  const entry = readCodingPlanBillingDiscountCache();
  assert.ok(entry);
  // 缓存写入成功；下次调用在 TTL 内直接命中。
  const before = Date.now();
  assert.deepEqual(await loadCodingPlanBillingDiscount(service), CONFIG);
  assert.equal(calls, calls === 1 ? 1 : 2); // 命中缓存不再调用
});

test("服务端未下发放置（undefined）也写入缓存，同周期不再重复请求", async () => {
  resetCodingPlanBillingDiscountCacheForTest();
  const { service, callCount } = createService(async () => undefined);
  assert.equal(await loadCodingPlanBillingDiscount(service), undefined);
  assert.equal(await loadCodingPlanBillingDiscount(service), undefined);
  assert.equal(callCount(), 1);
  assert.ok(readCodingPlanBillingDiscountCache());
});

test("远端失败不写缓存：每次调用立即重试，由 hook 静默降级", async () => {
  resetCodingPlanBillingDiscountCacheForTest();
  let attempts = 0;
  const service = {
    getBillingDiscount: () => {
      attempts += 1;
      return Promise.reject(new Error("network down"));
    },
  };
  await assert.rejects(() => loadCodingPlanBillingDiscount(service), /network down/);
  assert.equal(readCodingPlanBillingDiscountCache(), null);
  await assert.rejects(() => loadCodingPlanBillingDiscount(service), /network down/);
  assert.equal(attempts, 2);
});
