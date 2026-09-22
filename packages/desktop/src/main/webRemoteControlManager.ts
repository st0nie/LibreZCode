import type { WebRemoteControlDeviceTransport } from "./webRemoteControlDeviceTransport.js";
import type { WebRemoteControlRelayAuthProvider } from "./webRemoteControlDeviceTransport.js";
import type { WebRemoteControlRelayAuthStorageProvider } from "./webRemoteControlDeviceTransport.js";
import { createNodeWebRemoteControlRelayAuthProvider } from "./webRemoteControlDeviceTransport.js";
import { WebRemoteControlDeviceTransport } from "./webRemoteControlDeviceTransport.js";

/**
 * webRemoteControl 状态机管理器，对齐闭源 3.14.1。
 * 契约： .agents/specs/webRemoteControl.md
 *
 * 管理 device transport 生命周期、状态映射、QR 码生成、workspace bridge。
 */

export type WebRemoteControlStatus = "idle" | "starting" | "running" | "active" | "error";

export interface WebRemoteControlRuntimeStatus {
  status: WebRemoteControlStatus;
  sessionId: string;
  windowControlSessionId: string;
  mobileConnected: boolean;
  mobileViewState?: unknown;
  mobileDeviceInfo?: unknown;
  qrUrl: string;
  connectUrl: string;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  initialTaskId?: string;
  error?: string;
  failure?: { reason: string; message: string };
}

export interface WebRemoteControlWorkspaceTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  initialTaskId?: string;
}

/** bootstrap/workspaces 里 workspace 摘要 */
export interface WorkspaceSummary {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  label?: string;
}

/** 手机端视图状态 */
export interface MobileViewState {
  activeWorkspaceKey?: string;
  [key: string]: unknown;
}

export interface WebRemoteControlManagerOptions {
  /** 取当前 endpoint 的 relay WS URL */
  getRelayWsUrl: () => Promise<string>;
  /** 取手机端 remote URL(QR 码 base) */
  getRemoteUrl: () => Promise<string>;
  /** 设备 mid(uuid) */
  deviceMid: string;
  /** 设备名称 */
  deviceName: string;
  /** 应用版本 */
  appVersion: string;
  /** 认证 provider */
  authProvider?: WebRemoteControlRelayAuthProvider;
  /** 认证存储 provider */
  authStorageProvider?: WebRemoteControlRelayAuthStorageProvider;
  /** 状态变更回调 */
  onStatusChanged?: (windowId: number, status: WebRemoteControlRuntimeStatus) => void;
  /** 远程使用事件上报 */
  reportRemoteUsageEvent?: (elementName: string, payload: unknown) => void;
  /** platform-request 处理器(method → handler) */
  platformHandlers?: Record<string, (args: unknown) => Promise<unknown> | unknown>;
  /** 可用 workspace 列表 */
  getAvailableWorkspaces?: (windowId: number) => WorkspaceSummary[];
  /** 当前任务快照 */
  getTasks?: (windowId: number) => unknown[];
  /** 渲染 telemetry */
  reportRendererTelemetryEvent?: (event: unknown) => void;
  /** workspace bridge 创建 */
  createWorkspaceBridge?: (
    windowId: number,
    target: WebRemoteControlWorkspaceTarget,
  ) => Promise<unknown>;
  /** logger */
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

interface WebRemoteControlWindowState {
  windowId: number;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  initialTaskId?: string;
  status: WebRemoteControlStatus;
  deviceSid: string;
  passHash: string;
  mobileConnected: boolean;
  hasEverPaired: boolean;
  transport?: WebRemoteControlDeviceTransport;
  error?: string;
  failure?: { reason: string; message: string };
  pendingOutboundPayloads: unknown[];
  pendingOutboundPayloadTimer?: ReturnType<typeof setTimeout>;
  mobileDisconnectGraceTimer?: ReturnType<typeof setTimeout>;
  mobileViewState?: MobileViewState;
  mobileDeviceInfo?: unknown;
}

export function createWebRemoteControlManager(options: WebRemoteControlManagerOptions) {
  const authProvider = options.authProvider ?? createNodeWebRemoteControlRelayAuthProvider();
  const windows = new Map<number, WebRemoteControlWindowState>();
  const startAuthorizations = new Map<
    string,
    { token: string; expiresAt: number; windowId: number; workspaceKey: string }
  >();
  const START_AUTH_TTL_MS = 30000;
  const MOBILE_DISCONNECT_GRACE_MS = 3000;
  const PENDING_PAYLOAD_TIMEOUT_MS = 5000;
  const MAX_PENDING_PAYLOADS = 50;

  function buildRuntimeStatus(state: WebRemoteControlWindowState): WebRemoteControlRuntimeStatus {
    return {
      status: state.status,
      sessionId: state.deviceSid,
      windowControlSessionId: state.deviceSid,
      mobileConnected: state.mobileConnected,
      qrUrl: "",
      connectUrl: "",
      workspacePath: state.workspacePath,
      workspaceIdentity: state.workspaceIdentity,
      remoteSessionId: state.remoteSessionId,
      initialTaskId: state.initialTaskId,
      error: state.error,
      failure: state.failure,
    };
  }

  function emitStatus(state: WebRemoteControlWindowState): void {
    options.onStatusChanged?.(state.windowId, buildRuntimeStatus(state));
  }

  function clearStartAuthorizationsForWindow(windowId: number): void {
    for (const [token, auth] of startAuthorizations) {
      if (auth.windowId === windowId) startAuthorizations.delete(token);
    }
  }

  function authorizeStart(
    windowId: number,
    target: WebRemoteControlWorkspaceTarget,
  ): { token: string; expiresAt: number; windowId: number; workspaceKey: string } {
    clearStartAuthorizationsForWindow(windowId);
    const now = Date.now();
    for (const [token, auth] of startAuthorizations) {
      if (auth.expiresAt <= now) startAuthorizations.delete(token);
    }
    const auth = {
      token: crypto.randomUUID(),
      expiresAt: now + START_AUTH_TTL_MS,
      windowId,
      workspaceKey: `${target.workspacePath}|${target.workspaceIdentity ?? ""}|${target.remoteSessionId ?? ""}`,
    };
    startAuthorizations.set(auth.token, auth);
    return auth;
  }

  function consumeStartAuthorization(
    windowId: number,
    target: WebRemoteControlWorkspaceTarget,
    token: string,
  ): void {
    const auth = startAuthorizations.get(token);
    startAuthorizations.delete(token);
    if (!auth) throw new Error("Web remote control authorization is invalid or already used");
    if (auth.expiresAt <= Date.now()) throw new Error("Web remote control authorization expired");
    const workspaceKey = `${target.workspacePath}|${target.workspaceIdentity ?? ""}|${target.remoteSessionId ?? ""}`;
    if (auth.windowId !== windowId || auth.workspaceKey !== workspaceKey) {
      throw new Error("Web remote control authorization target mismatch");
    }
  }

  function createQrUrl(
    deviceSid: string,
    passHash: string,
    remoteUrl: string,
    theme?: string,
  ): string {
    const url = new URL(remoteUrl);
    url.searchParams.set("device_sid", deviceSid);
    url.searchParams.set("pass_hash", passHash);
    url.searchParams.set("timestamp", String(Date.now()));
    url.searchParams.set("device_mid", options.deviceMid);
    url.searchParams.set("device_name", options.deviceName);
    url.searchParams.set("app_version", options.appVersion);
    if (theme) url.searchParams.set("theme", theme);
    return url.toString();
  }

  function scheduleMobileDisconnectGrace(state: WebRemoteControlWindowState): void {
    if (state.mobileDisconnectGraceTimer) return;
    state.mobileDisconnectGraceTimer = setTimeout(() => {
      state.mobileDisconnectGraceTimer = undefined;
      if (windows.get(state.windowId) !== state || state.status === "error") return;
      state.status = "running";
      state.mobileConnected = false;
      emitStatus(state);
    }, MOBILE_DISCONNECT_GRACE_MS);
  }

  function clearMobileDisconnectGrace(state: WebRemoteControlWindowState): void {
    if (state.mobileDisconnectGraceTimer) {
      clearTimeout(state.mobileDisconnectGraceTimer);
      state.mobileDisconnectGraceTimer = undefined;
    }
  }

  function schedulePendingOutboundPayloadTimeout(state: WebRemoteControlWindowState): void {
    if (state.pendingOutboundPayloadTimer || state.pendingOutboundPayloads.length === 0) return;
    state.pendingOutboundPayloadTimer = setTimeout(() => {
      state.pendingOutboundPayloadTimer = undefined;
      const dropped = state.pendingOutboundPayloads.splice(0).length;
      options.logger.warn("[web-remote-control] dropped buffered outbound payloads", {
        windowId: state.windowId,
        droppedCount: dropped,
      });
    }, PENDING_PAYLOAD_TIMEOUT_MS);
  }

  function bufferOutboundPayload(state: WebRemoteControlWindowState, payload: unknown): void {
    if (state.pendingOutboundPayloads.length >= MAX_PENDING_PAYLOADS) {
      const dropped = state.pendingOutboundPayloads.length + 1;
      state.pendingOutboundPayloads.length = 0;
      if (state.pendingOutboundPayloadTimer) {
        clearTimeout(state.pendingOutboundPayloadTimer);
        state.pendingOutboundPayloadTimer = undefined;
      }
      options.logger.warn("[web-remote-control] dropped overflowing outbound payloads", {
        windowId: state.windowId,
        droppedCount: dropped,
      });
      return;
    }
    state.pendingOutboundPayloads.push(payload);
    schedulePendingOutboundPayloadTimeout(state);
  }

  function flushPendingOutboundPayloads(state: WebRemoteControlWindowState): void {
    while (state.pendingOutboundPayloads.length > 0) {
      const payload = state.pendingOutboundPayloads[0];
      if (!payload) break;
      const result = state.transport?.sendPayloadResult(payload);
      if (result?.kind === "unavailable") {
        schedulePendingOutboundPayloadTimeout(state);
        return;
      }
      if (result?.kind === "oversize") {
        options.logger.warn("[web-remote-control] dropped oversize app payload", {
          windowId: state.windowId,
          bytes: result.bytes,
        });
      }
      state.pendingOutboundPayloads.shift();
    }
    if (state.pendingOutboundPayloadTimer) {
      clearTimeout(state.pendingOutboundPayloadTimer);
      state.pendingOutboundPayloadTimer = undefined;
    }
  }

  function sendAppPayload(state: WebRemoteControlWindowState, payload: unknown): void {
    if (state.pendingOutboundPayloads.length > 0) {
      bufferOutboundPayload(state, payload);
      flushPendingOutboundPayloads(state);
      return;
    }
    const result = state.transport?.sendPayloadResult(payload);
    if (result?.kind !== "sent") {
      if (result?.kind === "oversize") {
        options.logger.warn("[web-remote-control] rejected oversize app payload", {
          windowId: state.windowId,
          bytes: result.bytes,
        });
        return;
      }
      bufferOutboundPayload(state, payload);
    }
  }

  // ---- RPC 帧路由(对齐闭源 routePayload) ----

  function respond(state: WebRemoteControlWindowState, frame: Record<string, unknown>): void {
    sendAppPayload(state, frame);
  }

  function buildBootstrapResult(state: WebRemoteControlWindowState) {
    return {
      windowControlSessionId: state.deviceSid,
      desktopAppVersion: options.appVersion,
      workspaces: getAvailableWorkspaces(state.windowId),
      tasks: options.getTasks?.(state.windowId) ?? [],
      initialViewState: state.mobileViewState,
      mobileViewState: state.mobileViewState,
    };
  }

  function getAvailableWorkspaces(windowId: number): WorkspaceSummary[] {
    const fromOptions = options.getAvailableWorkspaces?.(windowId) ?? [];
    return fromOptions;
  }

  async function handlePlatformRequest(
    state: WebRemoteControlWindowState,
    frame: { requestId?: unknown; method?: unknown; args?: unknown },
  ): Promise<void> {
    const method = typeof frame.method === "string" ? frame.method : "";
    const handler = options.platformHandlers?.[method];
    if (!handler) {
      respond(state, {
        zcode_type: "platform-response",
        requestId: frame.requestId,
        method,
        success: false,
        error: `unknown_platform_method:${method}`,
      });
      return;
    }
    try {
      const result = await handler(frame.args);
      respond(state, {
        zcode_type: "platform-response",
        requestId: frame.requestId,
        method,
        success: true,
        result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.logger.warn(`[web-remote-control] platform-request failed`, { method, message });
      respond(state, {
        zcode_type: "platform-response",
        requestId: frame.requestId,
        method,
        success: false,
        error: message,
      });
    }
  }

  function routeRpcFrame(
    state: WebRemoteControlWindowState,
    rawPayload: unknown,
    opts: WebRemoteControlManagerOptions,
  ): void {
    if (!rawPayload || typeof rawPayload !== "object") return;
    const frame = rawPayload as Record<string, unknown>;
    const zcodeType = frame["zcode_type"];
    if (typeof zcodeType !== "string") return;

    switch (zcodeType) {
      case "bootstrap-request":
        respond(state, {
          zcode_type: "bootstrap-response",
          requestId: frame["requestId"],
          success: true,
          result: buildBootstrapResult(state),
        });
        break;
      case "workspace-list-request":
        respond(state, {
          zcode_type: "workspace-list-response",
          requestId: frame["requestId"],
          success: true,
          result: {
            workspaces: getAvailableWorkspaces(state.windowId),
            tasks: opts.getTasks?.(state.windowId) ?? [],
            activeWorkspaceKey: state.mobileViewState?.activeWorkspaceKey,
          },
        });
        break;
      case "platform-request":
        void handlePlatformRequest(
          state,
          frame as { requestId?: unknown; method?: unknown; args?: unknown },
        );
        break;
      case "mobile-view-state-update":
        state.mobileViewState =
          (frame["viewState"] as MobileViewState | undefined) ?? state.mobileViewState;
        state.mobileDeviceInfo = frame["deviceInfo"] ?? state.mobileDeviceInfo;
        break;
      case "workspace-bridge-open":
        respond(state, {
          zcode_type: "workspace-bridge-ready",
          requestId: frame["requestId"],
          bridgeSessionId: frame["bridgeSessionId"],
        });
        break;
      case "workspace-reconnect-request":
        respond(state, {
          zcode_type: "workspace-reconnect-response",
          requestId: frame["requestId"],
          success: true,
        });
        break;
      case "rpc-frame":
      case "rpc-frame-ack":
        // 中转 RPC 帧到 workspace bridge(由上层处理)
        break;
      case "telemetry-report":
        opts.reportRendererTelemetryEvent?.(frame["event"]);
        break;
      default:
        break;
    }
  }

  async function start(
    windowId: number,
    target: WebRemoteControlWorkspaceTarget,
    token: string,
  ): Promise<WebRemoteControlRuntimeStatus> {
    consumeStartAuthorization(windowId, target, token);
    clearStartAuthorizationsForWindow(windowId);

    // 已有窗口则先停止
    await stop(windowId);

    const auth = await options.authStorageProvider?.load();
    const deviceAuth = auth
      ? { mode: "persisted" as const, deviceSid: auth.deviceSid, passHash: auth.passHash }
      : {
          mode: "register" as const,
          passHash: authProvider.createPassHash(authProvider.createPassword()),
        };

    const relayWsUrl = await options.getRelayWsUrl();
    const remoteUrl = await options.getRemoteUrl();

    const state: WebRemoteControlWindowState = {
      windowId,
      workspacePath: target.workspacePath,
      workspaceIdentity: target.workspaceIdentity,
      remoteSessionId: target.remoteSessionId,
      initialTaskId: target.initialTaskId,
      status: "starting",
      deviceSid: deviceAuth.deviceSid ?? "pending",
      passHash: deviceAuth.passHash,
      mobileConnected: false,
      hasEverPaired: false,
      pendingOutboundPayloads: [],
    };
    windows.set(windowId, state);
    emitStatus(state);

    const transport = new WebRemoteControlDeviceTransport({
      relayWsUrl,
      deviceMid: options.deviceMid,
      auth: deviceAuth,
      meta: { platform: process.platform, version: options.appVersion, name: options.deviceName },
      logger: options.logger,
      onStateChange: (transportState) => {
        if (windows.get(windowId) !== state) return;
        switch (transportState) {
          case "waiting_terminal":
            state.status = "running";
            emitStatus(state);
            break;
          case "paired":
            state.status = "active";
            state.mobileConnected = true;
            state.hasEverPaired = true;
            emitStatus(state);
            break;
          case "error":
            state.status = "error";
            emitStatus(state);
            break;
          case "idle":
            state.status = "idle";
            emitStatus(state);
            break;
        }
      },
      onPayload: (payload) => {
        if (windows.get(windowId) !== state) return;
        routeRpcFrame(state, payload, options);
      },
      onRegisteredAuth: (auth) => {
        state.deviceSid = auth.deviceSid;
        state.passHash = auth.passHash;
        options.authStorageProvider?.save(auth);
      },
      onInvalidPersistedAuth: async () => {
        await options.authStorageProvider?.clear();
      },
      onError: (error) => {
        if (windows.get(windowId) !== state) return;
        state.error = error.message;
        state.failure = { reason: "transport_error", message: error.message };
        emitStatus(state);
      },
    });

    state.transport = transport;
    transport.start();

    // 等待 QR-ready(paired 或 waiting_terminal)
    const QR_READY_TIMEOUT_MS = 30000;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(new Error("External relay device did not reach QR-ready state before timeout.")),
        QR_READY_TIMEOUT_MS,
      );
      const check = () => {
        if (state.status === "active" || state.status === "running") {
          clearTimeout(timer);
          resolve();
        } else if (state.status === "error") {
          clearTimeout(timer);
          reject(new Error(state.error || "transport error"));
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });

    const qrUrl = createQrUrl(state.deviceSid, state.passHash, remoteUrl);
    state.status = state.status === "active" ? "active" : "running";
    emitStatus(state);

    return {
      ...buildRuntimeStatus(state),
      qrUrl,
      connectUrl: qrUrl,
    };
  }

  async function stop(windowId: number): Promise<void> {
    const state = windows.get(windowId);
    if (!state) return;
    clearMobileDisconnectGrace(state);
    if (state.pendingOutboundPayloadTimer) {
      clearTimeout(state.pendingOutboundPayloadTimer);
    }
    state.pendingOutboundPayloads.length = 0;
    state.transport?.dispose();
    windows.delete(windowId);
    emitStatus({ ...state, status: "idle" });
  }

  async function getStatus(windowId: number): Promise<WebRemoteControlRuntimeStatus | undefined> {
    const state = windows.get(windowId);
    return state ? buildRuntimeStatus(state) : undefined;
  }

  async function resetPairing(): Promise<void> {
    await options.authStorageProvider?.clear();
  }

  return {
    authorizeStart,
    start,
    stop,
    getStatus,
    resetPairing,
    sendAppPayload,
    buildRuntimeStatus,
  };
}
