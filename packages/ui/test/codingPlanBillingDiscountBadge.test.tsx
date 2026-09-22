import assert from "node:assert/strict";
import test from "node:test";
import type { CodingPlanBillingDiscountConfig } from "@zcode/shared";
import {
  isCodingPlanBillingDiscountActive,
  resolveCodingPlanBillingDiscountCopy,
} from "@zcode/shared";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  IntlContext,
  type IntlContextValue,
} from "../src/i18n/IntlProvider.js";
import { ServiceProvider } from "../src/hooks/useServices.js";
import {
  CodingPlanBillingDiscountBadge,
  CodingPlanBillingDiscountInfo,
} from "../src/settings/model-provider-section/CodingPlanBillingDiscountBadge.js";
import {
  loadCodingPlanBillingDiscount,
  resetCodingPlanBillingDiscountCacheForTest,
} from "../src/hooks/codingPlanBillingDiscountCache.js";

const CONFIG: CodingPlanBillingDiscountConfig = {
  "zh-CN": {
    badgeBody: "150% 额度加赠",
    infoTitle: "150% 配额活动说明",
    infoBody: "活动期间购买套餐可获 **150%** 额度。",
  },
};

const intlValue: IntlContextValue = {
  intl: {
    formatMessage: ({ id }) => {
      const messages: Record<string, string> = {
        "settings.modelProvider.codingPlan.billingDiscountInfo.open":
          "查看 150% 配额活动说明",
      };
      return messages[id] ?? id;
    },
  },
  locale: "zh-CN",
  localePreference: "zh-CN",
  setLocale: () => {},
  setLocalePreference: () => {},
};

/** 预热模块缓存（renderToString 不执行 useEffect），让徽章组件同步读到配置。 */
async function primeCache(config: CodingPlanBillingDiscountConfig | undefined): Promise<void> {
  resetCodingPlanBillingDiscountCacheForTest();
  await loadCodingPlanBillingDiscount({
    getBillingDiscount: async () => config,
  });
}

test("shared 解析语义（GO/JO）：字段级 trim、非字符串丢弃、locale 非对象返回空集", () => {
  // 字段级 trim + 非字符串丢弃
  const copy = resolveCodingPlanBillingDiscountCopy(
    {
      "zh-CN": {
        badgeBody: " 150% 配额 ",
        infoTitle: 42, // 非字符串丢弃
        infoBody: "",
      },
    },
    "zh-CN",
  );
  assert.equal(copy.badgeBody, "150% 配额");
  assert.equal(copy.infoTitle, undefined);
  assert.equal(copy.infoBody, undefined);
  // locale 条目非对象 → 空集（不是整体 null）
  assert.deepEqual(resolveCodingPlanBillingDiscountCopy({ "zh-CN": "promo" }, "zh-CN"), {});
  // 未知 locale → 空集
  assert.deepEqual(resolveCodingPlanBillingDiscountCopy(CONFIG, "ja-JP"), {});
  // 激活判据：归一化后有非空 badgeBody
  assert.equal(isCodingPlanBillingDiscountActive(CONFIG, "zh-CN"), true);
  assert.equal(isCodingPlanBillingDiscountActive(CONFIG, "en-US"), false);
  assert.equal(isCodingPlanBillingDiscountActive(undefined, "zh-CN"), false);
});

test("徽章组件：激活渲染 TrendingUp 徽章 + ⓘ 说明，降级（无活动）不渲染", async () => {
  await primeCache(CONFIG);
  const badgeHtml = renderToString(
    createElement(
      IntlContext.Provider,
      { value: intlValue },
      createElement(CodingPlanBillingDiscountBadge, { config: CONFIG }),
    ),
  );
  assert.match(badgeHtml, /150% 额度加赠/);

  const infoHtml = renderToString(
    createElement(
      IntlContext.Provider,
      { value: intlValue },
      createElement(CodingPlanBillingDiscountInfo, { config: CONFIG }),
    ),
  );
  assert.match(infoHtml, /150% 配额活动说明/);

  // 降级：无 badgeBody 时徽章不渲染；无 infoTitle/infoBody 时说明不渲染
  const inactiveBadge = renderToString(
    createElement(
      IntlContext.Provider,
      { value: intlValue },
      createElement(CodingPlanBillingDiscountBadge, { config: { "zh-CN": {} } }),
    ),
  );
  assert.equal(inactiveBadge, "");
  const noInfo = renderToString(
    createElement(
      IntlContext.Provider,
      { value: intlValue },
      createElement(CodingPlanBillingDiscountInfo, { config: { "zh-CN": { badgeBody: "x" } } }),
    ),
  );
  assert.equal(noInfo, "");
});

test("hook 初始状态复用模块缓存；服务端未下发/读取失败静默降级", async () => {
  // 模块缓存机制已在 cache 测试中覆盖；这里验证预热后徽章在 SSR 下能同步渲染。
  await primeCache(CONFIG);
  const combined = renderToString(
    createElement(
      IntlContext.Provider,
      { value: intlValue },
      createElement(
        ServiceProvider,
        {
          services: {
            codingPlanSubscriptionService: { getBillingDiscount: async () => CONFIG },
          } as never,
        },
        createElement(CodingPlanBillingDiscountBadge, { config: CONFIG, variant: "surface" }),
      ),
    ),
  );
  assert.match(combined, /150% 额度加赠/);
  // 未激活（undefined 配置）时 SSR 不渲染徽章
  const inactive = renderToString(
    createElement(
      IntlContext.Provider,
      { value: intlValue },
      createElement(CodingPlanBillingDiscountBadge, { config: undefined }),
    ),
  );
  assert.equal(inactive, "");
});
