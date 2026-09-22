import type { CodingPlanBillingDiscountConfig } from "@zcode/shared";

/**
 * 额度优惠活动配置的 UI 侧缓存机制(与 3.14.1 桌面端 m0e 语义一致):
 * 模块级 1h TTL 缓存 + 并发单飞。独立于 React 以便 node:test 覆盖。
 *
 * 与闭源逐条对齐:
 * - 命中 TTL 内缓存直接返回 value(value 可能是 undefined——服务端未下发放置);
 * - 并发请求合并为同一 promise;
 * - 失败不写缓存:下次调用立即重试,避免一次网络抖动把活动隐藏满 1h;
 * - 写入缓存的 expiresAt 基于请求发起时刻。
 */

/** 与 host 侧 client/configs 快照同周期:远端活动翻转最迟 1h 生效。 */
const CODING_PLAN_BILLING_DISCOUNT_CACHE_TTL_MS = 3600 * 1000;

export interface CodingPlanBillingDiscountFetchService {
  getBillingDiscount(): Promise<CodingPlanBillingDiscountConfig | undefined>;
}

let cache: { value: CodingPlanBillingDiscountConfig | undefined; expiresAt: number } | null = null;
let pending: Promise<CodingPlanBillingDiscountConfig | undefined> | null = null;

/**
 * 返回缓存条目(不看新鲜度),供 hook 初始状态复用闭源语义:
 * loading 初值 = 有服务且无缓存对象;config 初值 = cache.value(即使已过期)。
 */
export function readCodingPlanBillingDiscountCache(): {
  value: CodingPlanBillingDiscountConfig | undefined;
  expiresAt: number;
} | null {
  return cache;
}

export async function loadCodingPlanBillingDiscount(
  service: CodingPlanBillingDiscountFetchService,
): Promise<CodingPlanBillingDiscountConfig | undefined> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return cache.value;
  }
  if (pending) {
    return pending;
  }
  const request = service.getBillingDiscount();
  pending = request;
  try {
    const value = await request;
    cache = {
      value,
      expiresAt: now + CODING_PLAN_BILLING_DISCOUNT_CACHE_TTL_MS,
    };
    return value;
  } finally {
    if (pending === request) {
      pending = null;
    }
  }
}

/** 仅供测试隔离:清空模块级缓存与单飞 promise。 */
export function resetCodingPlanBillingDiscountCacheForTest(): void {
  cache = null;
  pending = null;
}
