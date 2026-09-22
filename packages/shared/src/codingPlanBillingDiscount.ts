/**
 * Coding Plan 额度优惠活动配置(client/configs `configs.codingPlanBillingDiscount`)。
 *
 * 与 3.14.1 桌面端语义完全一致：
 * - 服务端按 locale 下发放置文案,host 层只做存在性透传,不做结构校验；
 * - 字段级归一化(非字符串丢弃、trim、空串丢弃)全部在读取侧逐字段完成(GO/JO 语义);
 * - 激活判据 = 当前 locale 归一化后存在非空 badgeBody(f0e(["badgeBody"]))。
 */

/** 单个 locale 归一化后的活动文案；缺字段即未投放该部分。 */
export interface CodingPlanBillingDiscountLocaleCopy {
  /** 徽章文字(如「150% 配额」);当前 locale 非空即视为活动激活。 */
  badgeBody?: string;
  /** 套餐卡片标题文案。 */
  cardTitle?: string;
  /** 套餐卡片正文文案。 */
  cardBody?: string;
  /** 活动说明弹窗标题。 */
  infoTitle?: string;
  /** 活动说明弹窗 Markdown 正文(活动规则说明)。 */
  infoBody?: string;
}

/**
 * 原始下发配置:按 locale 索引,字段无运行时类型保障。
 * 读取必须经 resolveCodingPlanBillingDiscountCopy 归一化,不直接消费字段。
 */
export type CodingPlanBillingDiscountConfig = Record<string, unknown>;

/** 闭源 JO 语义:非字符串丢弃;trim 后为空丢弃。 */
function trimNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** 闭源 GO 语义:取当前 locale 文案并逐字段归一化;locale 条目非对象时返回空集。 */
export function resolveCodingPlanBillingDiscountCopy(
  config: CodingPlanBillingDiscountConfig | null | undefined,
  locale: string,
): CodingPlanBillingDiscountLocaleCopy {
  const raw = config?.[locale];
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const entry = raw as Record<string, unknown>;
  return {
    badgeBody: trimNonEmptyString(entry.badgeBody),
    cardTitle: trimNonEmptyString(entry.cardTitle),
    cardBody: trimNonEmptyString(entry.cardBody),
    infoTitle: trimNonEmptyString(entry.infoTitle),
    infoBody: trimNonEmptyString(entry.infoBody),
  };
}

/** 闭源 f0e(config, locale, ["badgeBody"]) 语义:当前 locale 有非空 badgeBody 才激活。 */
export function isCodingPlanBillingDiscountActive(
  config: CodingPlanBillingDiscountConfig | null | undefined,
  locale: string,
): boolean {
  return Boolean(resolveCodingPlanBillingDiscountCopy(config, locale).badgeBody);
}
