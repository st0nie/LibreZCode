import { ipcMain, BrowserWindow } from "electron";
import { PlatformChannels } from "@zcode/shared";
import type { WebRemoteControlManager } from "./webRemoteControlManager.js";

/**
 * webRemoteControl IPC handler 注册，对齐闭源 3.14.1。
 * 契约： .agents/specs/webRemoteControl.md
 */

export function registerWebRemoteControlIpcHandlers(options: {
  manager: ReturnType<typeof createWebRemoteControlManager>;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}) {
  const { manager, logger } = options;

  ipcMain.handle(PlatformChannels.StartWebRemoteControl, async (event, rawPayload: unknown) => {
    const payload = rawPayload as {
      workspacePath?: string;
      workspaceIdentity?: string;
      remoteSessionId?: string;
      initialTaskId?: string;
    };
    if (!payload.workspacePath) {
      return { status: "error" as const, error: "workspacePath is required" };
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return { status: "error" as const, error: "window not found" };
    }
    try {
      const auth = manager.authorizeStart(win.id, {
        workspacePath: payload.workspacePath,
        workspaceIdentity: payload.workspaceIdentity,
        remoteSessionId: payload.remoteSessionId,
        initialTaskId: payload.initialTaskId,
      });
      return await manager.start(
        win.id,
        {
          workspacePath: payload.workspacePath,
          workspaceIdentity: payload.workspaceIdentity,
          remoteSessionId: payload.remoteSessionId,
          initialTaskId: payload.initialTaskId,
        },
        auth.token,
      );
    } catch (error) {
      logger.error("[web-remote-control] start failed:", error);
      return {
        status: "error" as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle(PlatformChannels.StopWebRemoteControl, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    await manager.stop(win.id);
  });

  ipcMain.handle(PlatformChannels.GetWebRemoteControlStatus, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return undefined;
    return manager.getStatus(win.id);
  });

  ipcMain.handle(PlatformChannels.ResetWebRemoteControlPairing, async () => {
    await manager.resetPairing();
  });

  ipcMain.handle(
    PlatformChannels.WebRemoteControlReconnectWorkspace,
    async (_event, rawPayload: unknown) => {
      const payload = rawPayload as {
        workspacePath?: string;
        workspaceIdentity?: string;
        remoteSessionId?: string;
      };
      if (!payload.workspacePath) return;
      // 重连逻辑由上层处理
      logger.info("[web-remote-control] reconnect workspace requested", {
        workspacePath: payload.workspacePath,
      });
    },
  );

  // 状态变更推送由 manager 的 onStatusChanged 回调驱动
}

// 避免循环依赖：webRemoteControlManager.ts 在底部导出 createWebRemoteControlManager
import { createWebRemoteControlManager } from "./webRemoteControlManager.js";
