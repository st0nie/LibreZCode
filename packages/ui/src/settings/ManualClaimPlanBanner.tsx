import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import type { ManualClaimPlan } from "@zcode/services";

/**
 * manualClaimPlan(权益领取)横幅,对齐闭源 3.14.1。
 * 契约: .agents/specs/manualClaimPlan.md
 *
 * 展示可领取的体验套餐(banner.tag 限时可领取),点击领取(需阿里云验证码)。
 * 本组件为 UI 骨架:captcha 由上层阿里云验证码 SDK 注入 captchaVerifyParam。
 */

export interface ManualClaimPlanBannerProps {
  /** 查询可领取套餐 */
  loadPreview: () => Promise<ManualClaimPlan[]>;
  /** 领取(上层完成 captcha 后调用) */
  onClaim: (params: { planId: string; captchaVerifyParam: string }) => Promise<void>;
  /** 请求阿里云验证码参数(上层注入 SDK) */
  requestCaptcha: () => Promise<{ captchaVerifyParam: string; captchaRegion?: string }>;
  onDismiss?: () => void;
}

export function ManualClaimPlanBanner({
  loadPreview,
  onClaim,
  requestCaptcha,
  onDismiss,
}: ManualClaimPlanBannerProps) {
  const { intl } = useZCodeIntl();
  const [plans, setPlans] = useState<ManualClaimPlan[]>([]);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await loadPreview();
        if (!cancelled) setPlans(list);
      } catch (err) {
        logger.warn("[manual-claim-plan] preview failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPreview]);

  const handleClaim = useCallback(
    async (plan: ManualClaimPlan) => {
      setClaiming(true);
      setError(undefined);
      try {
        const captcha = await requestCaptcha();
        await onClaim({ planId: plan.plan_id, captchaVerifyParam: captcha.captchaVerifyParam });
        setPlans((prev) => prev.filter((p) => p.plan_id !== plan.plan_id));
      } catch (err) {
        logger.error("[manual-claim-plan] claim failed:", err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setClaiming(false);
      }
    },
    [onClaim, requestCaptcha],
  );

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    onDismiss?.();
  }, [onDismiss]);

  if (dismissed || plans.length === 0) return null;

  const plan = plans[0];
  if (!plan) return null;
  const entitlement = plan.entitlements[0];
  const isDaily = entitlement?.period === "daily";
  const subtitle = entitlement
    ? intl.formatMessage(
        {
          id: isDaily
            ? "manualClaimPlan.banner.subtitle.daily"
            : "manualClaimPlan.banner.subtitle.oneTime",
        },
        {
          model: entitlement.show_name || plan.name || entitlement.entitlement_id,
        },
      )
    : plan.name || plan.plan_id;

  return (
    <div
      role="region"
      aria-label={intl.formatMessage({ id: "manualClaimPlan.banner.aria" })}
      className="flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 px-4 py-3"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="rounded bg-primary px-1.5 py-0.5 text-ui-xs font-medium text-primary-foreground">
            {intl.formatMessage({ id: "manualClaimPlan.banner.tag" })}
          </span>
          <span className="truncate text-ui-base font-medium text-foreground">{subtitle}</span>
        </div>
        {entitlement && (
          <p className="mt-0.5 text-ui-sm text-foreground-subtle">
            {intl.formatMessage(
              { id: "manualClaimPlan.claim.ticket.benefit" },
              {
                model: entitlement.show_name || "",
                amount: entitlement.grant_units,
                unit: intl.formatMessage({ id: "manualClaimPlan.banner.unit.tokens" }),
              },
            )}
          </p>
        )}
      </div>
      {error ? <span className="text-ui-xs text-red-500">{error}</span> : null}
      <Button
        size="sm"
        onClick={() => void handleClaim(plan)}
        disabled={claiming || loading}
        data-testid="manual-claim-plan-claim"
      >
        {claiming
          ? intl.formatMessage({ id: "manualClaimPlan.banner.claim" })
          : intl.formatMessage({ id: "manualClaimPlan.banner.claim" })}
      </Button>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label={intl.formatMessage({ id: "manualClaimPlan.banner.close" })}
        className="text-foreground-subtle hover:text-foreground"
        data-testid="manual-claim-plan-dismiss"
      >
        ✕
      </button>
    </div>
  );
}
