import { CodingPlanEntryButton } from "@/settings/CodingPlanEntryButton.js";
import type { CodingPlanBillingDiscountConfig } from "@zcode/shared";
import {
  CodingPlanBillingDiscountBadge,
  CodingPlanBillingDiscountInfo,
} from "@/settings/model-provider-section/CodingPlanBillingDiscountBadge.js";
import { ArrowLeftIcon, Loader2Icon, RocketIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { CodingPlanLoginOptions } from "./codingPlanPricingCards.js";

export function CodingPlanStatusActions({
  providerName,
  isDisconnected,
  isUnavailable,
  isPurchased,
  loginLoading,
  loginButtonId,
  loginVisible,
  canDisconnectProvider,
  disconnectLoading,
  onLogin,
  onDisconnect,
}: {
  providerName: string;
  isDisconnected: boolean;
  isUnavailable: boolean;
  isPurchased: boolean;
  loginLoading?: boolean;
  loginButtonId: string;
  loginVisible: boolean;
  canDisconnectProvider: boolean;
  disconnectLoading?: boolean;
  onLogin?: (options?: CodingPlanLoginOptions) => void;
  onDisconnect?: () => void;
}) {
  const { intl } = useZCodeIntl();

  return (
    <div className="flex shrink-0 flex-wrap justify-start gap-2">
      {loginVisible && (isDisconnected || isUnavailable) && onLogin ? (
        <Button type="button" size="lg" onClick={() => onLogin()} disabled={loginLoading}>
          {loginLoading ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
          {intl.formatMessage({ id: loginButtonId }, { provider: providerName })}
        </Button>
      ) : null}
      {canDisconnectProvider && onDisconnect && !isPurchased ? (
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={disconnectLoading}
          onClick={onDisconnect}
        >
          {disconnectLoading ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
          {intl.formatMessage({
            id: "settings.modelProvider.codingPlan.disconnect",
          })}
        </Button>
      ) : null}
    </div>
  );
}

export function CodingPlanUpgradeAction({
  loginLoading,
  upgradePlansVisible,
  actionLabelId = "settings.modelProvider.codingPlan.upgrade",
  billingDiscountActive,
  billingDiscountConfig,
  onUpgradePlansVisibleChange,
}: {
  loginLoading?: boolean;
  upgradePlansVisible: boolean;
  actionLabelId?: string;
  billingDiscountActive?: boolean;
  billingDiscountConfig?: CodingPlanBillingDiscountConfig;
  onUpgradePlansVisibleChange: (visible: boolean) => void;
}) {
  const { intl } = useZCodeIntl();

  // 与 3.14.1 桌面端一致：活动激活且升级面板未展开时，按钮变渐变、
  // 徽章内嵌按钮尾部（surface 反白），ⓘ 活动说明放在按钮外；
  // 未激活时按钮与原行为完全一致。
  const discountVisible = billingDiscountActive === true && !upgradePlansVisible;
  const button = (
    <CodingPlanEntryButton
      bypassGate={upgradePlansVisible}
      type="button"
      size="lg"
      className={cn(
        discountVisible &&
          "button-gradient dark:bg-[#484A58] text-white hover:bg-transparent hover:opacity-90 dark:hover:bg-[#484A58] pr-[5px] rounded-full",
      )}
      onClick={() => {
        // 购买/升级入口必须先打开面板，OAuth 失效恢复由面板在用户选择
        // plan/周期后处理，避免点击 Upgrade 直接跳登录导致用户看不到购买流程。
        onUpgradePlansVisibleChange(!upgradePlansVisible);
      }}
      disabled={loginLoading}
    >
      {loginLoading ? (
        // Upgrade 可能先触发 OAuth 业务 token 刷新。
        // 等待期间只有 disabled 没有 spinner，用户会误以为点击没有响应。
        <Loader2Icon className="size-3.5 animate-spin" />
      ) : upgradePlansVisible ? (
        <ArrowLeftIcon className="size-3.5" />
      ) : (
        <RocketIcon className="size-3.5" />
      )}
      {intl.formatMessage({
        id: upgradePlansVisible
          ? "settings.modelProvider.codingPlan.cancelUpgrade"
          : actionLabelId,
      })}
      {discountVisible ? (
        <CodingPlanBillingDiscountBadge
          config={billingDiscountConfig}
          iconVisible={false}
          variant="surface"
        />
      ) : null}
    </CodingPlanEntryButton>
  );
  return discountVisible ? (
    <div className="inline-flex shrink-0 items-center gap-1">
      {button}
      <CodingPlanBillingDiscountInfo config={billingDiscountConfig} />
    </div>
  ) : (
    button
  );
}
