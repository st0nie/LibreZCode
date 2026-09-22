import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { logger } from "@/logger.js";
import type { WebRemoteControlStatus } from "@zcode/shared";

const log = logger;

export function WebRemoteControlSettingSection({
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  initialTaskId,
}: {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  initialTaskId?: string;
}) {
  const { intl } = useZCodeIntl();
  const platform = usePlatform();
  const [status, setStatus] = useState<WebRemoteControlStatus | undefined>(undefined);
  const [isStarting, setIsStarting] = useState(false);

  // 查询当前状态
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await platform.getWebRemoteControlStatus?.();
        if (!cancelled) setStatus(s);
      } catch (error) {
        log.warn("[web-remote-control] get status failed:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [platform]);

  // 订阅状态变更
  useEffect(() => {
    const dispose = platform.onWebRemoteControlStatusChanged?.((s: WebRemoteControlStatus) => {
      setStatus(s);
    });
    return () => dispose?.();
  }, [platform]);

  const handleStart = useCallback(async () => {
    setIsStarting(true);
    try {
      const result = await platform.startWebRemoteControl?.({
        workspacePath,
        workspaceIdentity,
        remoteSessionId,
        initialTaskId,
      });
      if (result) setStatus(result);
    } catch (error) {
      log.error("[web-remote-control] start failed:", error);
    } finally {
      setIsStarting(false);
    }
  }, [platform, workspacePath, workspaceIdentity, remoteSessionId, initialTaskId]);

  const handleStop = useCallback(async () => {
    try {
      await platform.stopWebRemoteControl?.();
      setStatus({
        status: "idle",
        sessionId: "",
        windowControlSessionId: "",
        mobileConnected: false,
        qrUrl: "",
        connectUrl: "",
        workspacePath,
      });
    } catch (error) {
      log.error("[web-remote-control] stop failed:", error);
    }
  }, [platform, workspacePath]);

  const isActive = status?.status === "active" || status?.status === "running";
  const isError = status?.status === "error";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-ui-base font-medium text-foreground">
            {intl.formatMessage({ id: "webRemoteControl.title" })}
          </div>
          <div className="text-ui-sm text-foreground-subtle mt-1">
            {intl.formatMessage({ id: "webRemoteControl.description" })}
          </div>
        </div>
        <Button
          variant={isActive ? "outline" : "default"}
          onClick={isActive ? handleStop : handleStart}
          disabled={isStarting}
        >
          {isStarting
            ? intl.formatMessage({ id: "webRemoteControl.triggerStatus.starting" })
            : isActive
              ? intl.formatMessage({ id: "webRemoteControl.statusDetail.running" })
              : intl.formatMessage({ id: "webRemoteControl.trigger" })}
        </Button>
      </div>

      {/* 状态展示 */}
      {status && (
        <div className="rounded-lg border border-border p-4 space-y-3">
          <div className="flex items-center gap-2">
            <div
              className={`size-2 rounded-full ${
                status.status === "active"
                  ? "bg-green-500"
                  : status.status === "error"
                    ? "bg-red-500"
                    : status.status === "running"
                      ? "bg-yellow-500"
                      : "bg-gray-400"
              }`}
            />
            <span className="text-ui-sm text-foreground">
              {intl.formatMessage({ id: `webRemoteControl.status.${status.status}` })}
            </span>
            {status.mobileConnected && (
              <span className="text-ui-sm text-foreground-subtle">
                {intl.formatMessage({ id: "webRemoteControl.mobileHome.connected" })}
              </span>
            )}
          </div>

          {/* QR 码 */}
          {status.qrUrl && status.status === "running" && (
            <div className="flex flex-col items-center gap-2 pt-2">
              <div className="text-ui-sm text-foreground-subtle">
                {intl.formatMessage({ id: "webRemoteControl.mobileHome.notice" })}
              </div>
              <div className="bg-white p-4 rounded-lg">
                {/* QR 码渲染由 qrcode 库或 canvas 实现,这里用占位 */}
                <div className="text-ui-xs text-foreground-subtle break-all max-w-[200px]">
                  {status.qrUrl}
                </div>
              </div>
            </div>
          )}

          {/* 错误信息 */}
          {isError && status.error && (
            <div className="text-ui-sm text-red-500 pt-2">{status.error}</div>
          )}
        </div>
      )}
    </div>
  );
}
