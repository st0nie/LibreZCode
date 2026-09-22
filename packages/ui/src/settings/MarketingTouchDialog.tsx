import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import type { IMarketingTouchService, MarketingTouch } from "@zcode/services";

/**
 * marketingTouch(营销弹窗)组件,对齐闭源 3.14.1。
 * 契约: .agents/specs/marketingTouch.md
 *
 * 启动时查询服务端下发的营销弹窗(kind: campaign/feature/notice),
 * 展示 dialog(title + description + buttons),按钮触发对应 action。
 */

export interface MarketingTouchDialogProps {
  service: IMarketingTouchService;
  locale: "zh-CN" | "en-US";
  /** 执行 action */
  onAction?: (action: MarketingTouch["actions"][string]) => void;
}

export function MarketingTouchDialog({ service, locale, onAction }: MarketingTouchDialogProps) {
  const { intl } = useZCodeIntl();
  const [touch, setTouch] = useState<MarketingTouch | undefined>(undefined);
  const [scope, setScope] = useState<string | undefined>(undefined);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setState("loading");
      try {
        const result = await service.query({ locale });
        if (cancelled) return;
        setTouch(result);
        setScope(result.scope);
        setState("ready");
      } catch (err) {
        logger.warn("[marketing-touch] query failed:", err);
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [service, locale]);

  const handleButton = useCallback(
    async (button: MarketingTouch["dialog"]["buttons"][number]) => {
      if (!touch || !scope) return;
      const action = touch.actions[button.actionId];
      if (!action) return;
      // 上报 confirm/cancel
      try {
        await service.report({
          locale,
          scope,
          campaignId: touch.id,
          actionType: button.variant === "primary" ? "confirm" : "cancel",
        });
      } catch (err) {
        logger.warn("[marketing-touch] report failed:", err);
      }
      onAction?.(action);
      setTouch(undefined);
    },
    [touch, scope, service, locale, onAction],
  );

  if (state === "loading" || state === "error" || !touch) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      data-testid="marketing-touch-dialog"
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
        <h2 className="text-ui-lg font-semibold text-foreground">{touch.dialog.title}</h2>
        <div className="mt-3 text-ui-base text-foreground-subtle whitespace-pre-wrap">
          {touch.dialog.description.format === "markdown" ? (
            <MarketingTouchMarkdown text={touch.dialog.description.text} />
          ) : (
            touch.dialog.description.text
          )}
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          {touch.dialog.buttons.map((button) => (
            <Button
              key={button.id}
              variant={button.variant === "primary" ? "default" : "outline"}
              onClick={() => void handleButton(button)}
              data-testid={`marketing-touch-button-${button.id}`}
            >
              {button.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

function MarketingTouchMarkdown({ text }: { text: string }) {
  // 骨架:实际用 MessageResponse 渲染服务端下发的 Markdown
  return <div className="whitespace-pre-wrap">{text}</div>;
}
