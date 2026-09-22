import type { CodingPlanBillingDiscountConfig } from "@zcode/shared";
import { isCodingPlanBillingDiscountActive } from "@zcode/shared";
import { useCallback, useEffect, useState } from "react";
import { useOptionalServices } from "@/hooks/useServices.js";
import { logger } from "@/logger.js";
import {
  loadCodingPlanBillingDiscount,
  readCodingPlanBillingDiscountCache,
} from "@/hooks/codingPlanBillingDiscountCache.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export interface CodingPlanBillingDiscountState {
  /** 当前 locale 存在非空 badgeBody 时为 true;读取失败/无活动恒为 false。 */
  active: boolean;
  config: CodingPlanBillingDiscountConfig | undefined;
  loading: boolean;
  refresh: () => Promise<void>;
}

/**
 * 额度优惠活动配置读取(与 3.14.1 桌面端 d0e 语义一致):
 * 服务端按 locale 下发放置文案,客户端纯渲染,不解析任何优惠数值。
 *
 * - 初始 state 同步复用模块级缓存(不看新鲜度);挂载后总是 refresh,
 *   TTL 命中由 loadCodingPlanBillingDiscount 内部裁决;
 * - 任何失败(网络/远端 5xx)静默降级为 active=false,活动 UI 整体隐藏,
 *   不打断升级/续费主流程。
 */
export function useCodingPlanBillingDiscount(): CodingPlanBillingDiscountState {
  const { locale } = useZCodeIntl();
  const services = useOptionalServices();
  const service = services?.codingPlanSubscriptionService;
  const [state, setState] = useState<
    Pick<CodingPlanBillingDiscountState, "active" | "config" | "loading">
  >(() => {
    const cached = readCodingPlanBillingDiscountCache();
    return {
      active: isCodingPlanBillingDiscountActive(cached?.value, locale),
      config: cached?.value,
      loading: Boolean(service) && !cached,
    };
  });

  const refresh = useCallback(async () => {
    if (!service || typeof service.getBillingDiscount !== "function") {
      setState({ active: false, config: undefined, loading: false });
      return;
    }
    setState((current) => ({ ...current, loading: true }));
    try {
      const config = await loadCodingPlanBillingDiscount(service);
      setState({
        active: isCodingPlanBillingDiscountActive(config, locale),
        config,
        loading: false,
      });
    } catch (error) {
      // 活动配置属于增益信息:失败只隐藏活动 UI,不向上抛错。
      logger.warn("[CodingPlanBillingDiscount] 读取 Coding Plan 活动配置失败", {
        error: error instanceof Error ? error.message : String(error),
      });
      setState({ active: false, config: undefined, loading: false });
    }
  }, [service, locale]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...state, refresh };
}
