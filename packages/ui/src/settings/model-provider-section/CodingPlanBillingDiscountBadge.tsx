import type {
  CodingPlanBillingDiscountConfig,
  CodingPlanBillingDiscountLocaleCopy,
} from "@zcode/shared";
import { resolveCodingPlanBillingDiscountCopy } from "@zcode/shared";
import { InfoIcon, TrendingUpIcon } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message.js";
import { cn } from "@/components/lib/utils.js";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { DEFAULT_CODE_PREVIEW_SETTINGS } from "@/lib/codePreviewSettings.js";
import { useZCodeStoreWithDefault } from "@/store/StoreProvider.js";

type BadgeSize = "default" | "compact";
type BadgeVariant = "gradient" | "surface" | "tag";

export interface CodingPlanBillingDiscountBadgeProps {
  config: CodingPlanBillingDiscountConfig | undefined;
  iconVisible?: boolean;
  size?: BadgeSize;
  variant?: BadgeVariant;
}

/**
 * 额度优惠活动徽章(与 3.14.1 桌面端 KO 一致):
 * 文案 badgeBody 完全来自服务端 client/configs 下发,客户端纯渲染。
 * 当前 locale 无有效 badgeBody 时返回 null。
 *
 * variant 语义与闭源一致:
 * - `gradient`(默认):渐变底白字徽章;
 * - `surface`:渐变按钮上的反白徽章(白底深字);
 * - `tag`:普通卡片上的标记徽章。
 */
export function CodingPlanBillingDiscountBadge({
  config,
  iconVisible = true,
  size = "default",
  variant = "gradient",
}: CodingPlanBillingDiscountBadgeProps) {
  const { locale } = useZCodeIntl();
  const copy = resolveCodingPlanBillingDiscountCopy(config, locale);
  if (!copy.badgeBody) {
    return null;
  }
  return (
    <div
      className={cn(
        "inline-flex items-center py-0.5 whitespace-nowrap",
        size === "compact" ? "gap-0.5 px-1.5 text-ui-xs leading-none" : "gap-1 px-2 text-ui-xs",
        variant === "surface"
          ? "rounded-full bg-white text-[#191A1D]"
          : variant === "tag"
            ? "rounded-full bg-tag text-foreground"
            : "rounded-full text-white button-gradient dark:bg-[#484A58]",
      )}
    >
      {iconVisible ? (
        <TrendingUpIcon className={size === "compact" ? "size-2.5" : "size-3"} />
      ) : null}
      {copy.badgeBody}
    </div>
  );
}

/**
 * 徽章旁的 ⓘ 活动说明入口(与 3.14.1 桌面端 qO 一致):
 * 点击弹出服务端下发的 Markdown 规则说明(infoTitle + infoBody)。
 * 无说明文案时整体不渲染。
 */
export function CodingPlanBillingDiscountInfo({
  config,
  tone = "default",
}: {
  config: CodingPlanBillingDiscountConfig | undefined;
  tone?: "default" | "onGradient";
}) {
  const { intl, locale } = useZCodeIntl();
  const theme = useZCodeStoreWithDefault((state) => state.theme, "system");
  const codePreviewSettings = useZCodeStoreWithDefault(
    (state) => state.codePreviewSettings,
    DEFAULT_CODE_PREVIEW_SETTINGS,
  );
  const copy = resolveCodingPlanBillingDiscountCopy(config, locale);
  const label = intl.formatMessage({
    id: "settings.modelProvider.codingPlan.billingDiscountInfo.open",
  });
  if (!copy.infoTitle || !copy.infoBody) {
    return null;
  }
  const markdown = `## ${copy.infoTitle}\n\n${copy.infoBody}`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <InfoIcon
          role="button"
          tabIndex={0}
          aria-label={label}
          className={cn(
            "size-3.5 shrink-0 cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            tone === "onGradient"
              ? "text-white/90 hover:text-white"
              : "text-foreground-subtle hover:text-foreground",
          )}
        />
      </PopoverTrigger>
      <PopoverContent
        className={cn(
          "max-h-[min(82vh,640px)] max-w-lg grid-rows-[auto_minmax(0,1fr)] overflow-hidden",
          "block",
        )}
      >
        <div className="p-3 !space-y-3">
          <MessageResponse
            className="min-h-0 overflow-y-auto pr-1 text-foreground"
            theme={theme}
            codePreviewSettings={codePreviewSettings}
          >
            {markdown}
          </MessageResponse>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * 徽章 + ⓘ 说明组合(与 3.14.1 桌面端 p0e 一致):
 * 当前 locale 无 badgeBody 时整体不渲染;info 色调跟随 variant
 * (surface 说明徽章在渐变按钮上,ⓘ 用 onGradient)。
 */
export function CodingPlanBillingDiscountBadgeWithInfo(props: CodingPlanBillingDiscountBadgeProps) {
  const { locale } = useZCodeIntl();
  const copy: CodingPlanBillingDiscountLocaleCopy = resolveCodingPlanBillingDiscountCopy(
    props.config,
    locale,
  );
  if (!copy.badgeBody) {
    return null;
  }
  return (
    <>
      <CodingPlanBillingDiscountBadge {...props} />
      <CodingPlanBillingDiscountInfo
        config={props.config}
        tone={props.variant === "surface" ? "onGradient" : "default"}
      />
    </>
  );
}
