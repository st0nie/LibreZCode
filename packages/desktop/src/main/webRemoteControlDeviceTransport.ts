import { createHash, createHmac, randomBytes } from "crypto";
import { WebSocket } from "ws";

/**
 * webRemoteControl 设备端 WebSocket 传输协议，对齐闭源 3.14.1。
 * 契约： .agents/specs/webRemoteControl.md
 *
 * 桌面端作为 device，手机端作为 terminal，通过 WS relay 中转配对。
 * 支持：注册/认证/配对状态/数据帧中转/心跳/断线重连。
 */

export type WebRemoteControlTransportState =
  | "idle"
  | "connecting"
  | "registering"
  | "authenticating"
  | "waiting_terminal"
  | "paired"
  | "error";

export interface WebRemoteControlDeviceAuth {
  mode: "register" | "persisted";
  deviceSid?: string;
  passHash: string;
}

export interface WebRemoteControlDeviceMeta {
  platform: NodeJS.Platform;
  version: string;
  name: string;
}

export interface WebRemoteControlRelayMessage {
  type:
    | "device_register_init"
    | "device_register_ack"
    | "auth_init"
    | "auth_challenge"
    | "auth_response"
    | "pair_status_ack"
    | "pair_status_query"
    | "data"
    | "error";
  // register
  device_mid?: string;
  pass_hash?: string;
  meta?: WebRemoteControlDeviceMeta;
  client_ts?: number;
  device_sid?: string;
  // auth
  role?: "device" | "terminal";
  nonce?: string;
  proof?: string;
  // pair status
  pair_status?: "waiting" | "matched";
  // data
  payload?: unknown;
  seq?: number;
  // error
  code?: "KICKED" | "AUTH_FAILED" | "INTERNAL" | "WRONG_PARAM";
  message?: string;
}

export interface WebRemoteControlDeviceTransportOptions {
  relayWsUrl: string;
  deviceMid: string;
  auth: WebRemoteControlDeviceAuth;
  meta: WebRemoteControlDeviceMeta;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  /** 状态变更回调 */
  onStateChange?: (state: WebRemoteControlTransportState) => void;
  /** 收到数据帧回调 */
  onPayload?: (payload: unknown) => void;
  /** 注册成功回调(首次注册后保存 deviceSid+passHash) */
  onRegisteredAuth?: (auth: { deviceSid: string; passHash: string }) => void;
  /** 认证失败回调(persisted auth 失效,需重置) */
  onInvalidPersistedAuth?: () => void;
  /** 错误回调 */
  onError?: (error: Error) => void;
  /** 心跳间隔(ms),默认 10000 */
  heartbeatIntervalMs?: number;
  /** 心跳抖动(ms),默认 2000 */
  heartbeatJitterMs?: number;
  /** 心跳超时(ms),默认 30000 */
  heartbeatAckTimeoutMs?: number;
  /** 重连延迟(ms),默认 1000 */
  reconnectDelayMs?: number;
  /** 重连抖动(ms),默认 2000 */
  reconnectJitterMs?: number;
}

export class WebRemoteControlDeviceTransport {
  private socket: WebSocket | undefined;
  private state: WebRemoteControlTransportState = "idle";
  private deviceSid: string | undefined;
  private activeAuth: WebRemoteControlDeviceAuth;
  private manuallyClosed = false;
  private terminalClose = false;
  private invalidPersistedRetryUsed = false;
  private suppressNextCloseReconnect = false;
  private wasPaired = false;
  private staleWaitingCount = 0;
  private lastPairStatusAckAt = 0;
  private heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatAckWatchdogTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private staleWaitingRecoveryTimer: ReturnType<typeof setTimeout> | undefined;
  private connectStartedAt = 0;
  private connectAttempt = 0;
  private socketGeneration = 0;
  private lastPairedSocketGeneration = 0;

  constructor(private options: WebRemoteControlDeviceTransportOptions) {
    this.activeAuth = options.auth;
    this.deviceSid = options.auth.deviceSid;
  }

  start(): void {
    this.manuallyClosed = false;
    this.terminalClose = false;
    this.wasPaired = false;
    this.lastPairedSocketGeneration = 0;
    this.staleWaitingCount = 0;
    this.lastPairStatusAckAt = Date.now();
    this.connect();
  }

  dispose(): void {
    this.manuallyClosed = true;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.clearStaleWaitingRecoveryTimer();
    this.socket?.close();
    this.socket = undefined;
    this.setState("idle");
  }

  sendPayload(payload: unknown): boolean {
    return this.sendPayloadResult(payload).kind === "sent";
  }

  sendPayloadResult(payload: unknown): {
    kind: "sent" | "unavailable" | "oversize";
    bytes?: number;
  } {
    const serialized = JSON.stringify(payload);
    const bytes = Buffer.byteLength(serialized, "utf8");
    // 512KB 上限(与闭源 maxPhysicalFrameBytes 对齐)
    if (bytes > 512 * 1024) {
      return { kind: "oversize", bytes };
    }
    if (this.state !== "paired" || this.staleWaitingCount > 0) {
      return { kind: "unavailable" };
    }
    return this.sendSerialized(payload, serialized)
      ? { kind: "sent", bytes }
      : { kind: "unavailable" };
  }

  private connect(): void {
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.clearStaleWaitingRecoveryTimer();
    this.connectAttempt += 1;
    this.socketGeneration += 1;
    this.connectStartedAt = Date.now();
    this.setState("connecting");
    this.lastPairStatusAckAt = Date.now();

    this.options.logger.info("[web-remote-control] external relay device connecting");

    const url = new URL(this.options.relayWsUrl);
    url.searchParams.set("mid", this.options.deviceMid);

    const socket = new WebSocket(url.toString(), {
      perMessageDeflate: true,
      headers: { "X-Device-ID": this.options.deviceMid },
    });
    this.socket = socket;

    socket.on("open", () => {
      if (socket !== this.socket) return;
      if (this.activeAuth.mode === "register") {
        this.setState("registering");
        this.send({
          type: "device_register_init",
          device_mid: this.options.deviceMid,
          pass_hash: this.activeAuth.passHash,
          meta: this.options.meta,
          client_ts: Date.now(),
        });
        return;
      }
      this.sendAuthInit(this.activeAuth.deviceSid);
    });

    socket.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
      if (socket !== this.socket) return;
      const bytes = Array.isArray(data)
        ? data.reduce((sum, b) => sum + b.byteLength, 0)
        : data instanceof ArrayBuffer
          ? data.byteLength
          : Buffer.byteLength(data);
      if (bytes > 512 * 1024) {
        this.options.logger.warn("[web-remote-control] oversize external relay message dropped", {
          bytes,
          maxBytes: 512 * 1024,
        });
        return;
      }
      const message = this.parseMessage(data);
      if (!message) {
        this.options.logger.warn("[web-remote-control] invalid external relay message");
        return;
      }
      this.handleMessage(message);
    });

    socket.on("error", (error: Error) => {
      if (socket === this.socket) {
        this.options.logger.warn("[web-remote-control] external relay device socket error", {
          message: error.message,
        });
        this.options.onError?.(error);
      }
    });

    socket.on("close", () => {
      if (socket === this.socket) {
        this.stopHeartbeat();
        if (this.suppressNextCloseReconnect) {
          this.suppressNextCloseReconnect = false;
          return;
        }
        if (!this.manuallyClosed && !this.terminalClose) {
          this.options.logger.warn("[web-remote-control] external relay device disconnected");
          if (this.state !== "paired") {
            // 连接失败计数
          }
          this.scheduleReconnect();
        }
      }
    });
  }

  private parseMessage(data: Buffer | ArrayBuffer | Buffer[]): WebRemoteControlRelayMessage | null {
    try {
      const buffer = Array.isArray(data)
        ? Buffer.concat(data)
        : data instanceof ArrayBuffer
          ? Buffer.from(data)
          : data;
      const parsed = JSON.parse(buffer.toString("utf8"));
      return parsed && typeof parsed === "object" && "type" in parsed ? parsed : null;
    } catch {
      return null;
    }
  }

  private async handleMessage(message: WebRemoteControlRelayMessage): Promise<void> {
    switch (message.type) {
      case "device_register_ack": {
        this.deviceSid = message.device_sid;
        if (this.activeAuth.mode === "register") {
          this.options.onRegisteredAuth?.({
            deviceSid: message.device_sid,
            passHash: this.activeAuth.passHash,
          });
          this.activeAuth = {
            mode: "persisted",
            deviceSid: message.device_sid,
            passHash: this.activeAuth.passHash,
          };
        }
        this.sendAuthInit(message.device_sid);
        break;
      }
      case "auth_challenge": {
        if (!this.deviceSid) {
          this.enterError(new Error("External relay auth challenge arrived before device_sid"));
          return;
        }
        const proof = this.calculateProof(
          this.activeAuth.passHash,
          message.nonce,
          "device",
          this.deviceSid,
        );
        this.send({
          type: "auth_response",
          device_sid: this.deviceSid,
          proof,
          client_ts: Date.now(),
        });
        break;
      }
      case "auth_ack":
      case "pair_status_ack": {
        this.applyPairStatus(message.pair_status);
        break;
      }
      case "data": {
        this.handleDataPayload(message.payload);
        break;
      }
      case "error": {
        await this.handleRelayError(message.code, message.message);
        break;
      }
    }
  }

  private sendAuthInit(deviceSid: string): void {
    this.deviceSid = deviceSid;
    this.setState("authenticating");
    this.send({
      type: "auth_init",
      role: "device",
      device_sid: deviceSid,
      meta: this.options.meta,
      client_ts: Date.now(),
    });
  }

  private applyPairStatus(pairStatus: "waiting" | "matched"): void {
    this.lastPairStatusAckAt = Date.now();
    this.armHeartbeatAckWatchdog();

    if (pairStatus === "waiting") {
      if (this.wasPaired) {
        this.staleWaitingCount += 1;
        this.startHeartbeat();
        if (this.staleWaitingCount === 1) {
          this.scheduleStaleWaitingRecovery();
          return;
        }
        this.reconnectAfterStaleWaiting();
        return;
      }
      this.setState("waiting_terminal");
      this.startHeartbeat();
      return;
    }

    if (pairStatus === "matched") {
      const socketGen = this.lastPairedSocketGeneration;
      const reconnectKind =
        socketGen === 0
          ? null
          : socketGen === this.socketGeneration
            ? "same-socket"
            : "reconnected-socket";
      this.staleWaitingCount = 0;
      this.clearStaleWaitingRecoveryTimer();
      this.setState("paired");
      this.wasPaired = true;
      this.lastPairedSocketGeneration = this.socketGeneration;
      this.startHeartbeat();
      if (reconnectKind) {
        this.options.onSendReady?.({ kind: reconnectKind });
      }
    }
  }

  private async handleRelayError(code?: string, message?: string): Promise<void> {
    if (code === "KICKED") {
      this.options.logger.warn("[web-remote-control] external relay device KICKED, reconnecting", {
        message,
      });
      this.socket?.close();
      return;
    }
    if (
      code === "AUTH_FAILED" &&
      this.activeAuth.mode === "persisted" &&
      !this.invalidPersistedRetryUsed
    ) {
      this.invalidPersistedRetryUsed = true;
      await this.options.onInvalidPersistedAuth?.();
      this.activeAuth = { mode: "register", passHash: this.activeAuth.passHash };
      this.deviceSid = undefined;
      this.suppressNextCloseReconnect = true;
      this.socket?.close();
      this.scheduleReconnect(0);
      return;
    }
    if (code === "INTERNAL") {
      if (this.state === "paired" || this.state === "waiting_terminal") {
        this.enterWaitingForPairAfterRelayError(new Error(message || code));
        return;
      }
      this.enterRecoverableError(new Error(message || code));
      return;
    }
    if (code === "WRONG_PARAM" && (this.state === "paired" || this.state === "waiting_terminal")) {
      this.options.onError?.(new Error(message || code));
      return;
    }
    this.enterError(new Error(message || code || "unknown relay error"));
  }

  private handleDataPayload(payload: unknown): void {
    if (this.state !== "paired") return;
    this.options.onPayload?.(payload);
  }

  private startHeartbeat(): void {
    if (!this.heartbeatTimer) {
      this.armHeartbeatAckWatchdog();
      this.scheduleHeartbeat();
    }
  }

  private scheduleHeartbeat(): void {
    const interval = this.options.heartbeatIntervalMs ?? 10000;
    const jitter = this.options.heartbeatJitterMs ?? 2000;
    const delay = interval + Math.random() * jitter;
    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = undefined;
      if (this.deviceSid && (this.state === "paired" || this.state === "waiting_terminal")) {
        this.send({
          type: "pair_status_query",
          device_sid: this.deviceSid,
          client_ts: Date.now(),
        });
        this.scheduleHeartbeat();
      }
    }, delay);
  }

  private armHeartbeatAckWatchdog(): void {
    if (this.state !== "paired" && this.state !== "waiting_terminal") return;
    if (this.heartbeatAckWatchdogTimer) clearTimeout(this.heartbeatAckWatchdogTimer);
    const timeout = this.options.heartbeatAckTimeoutMs ?? 30000;
    this.heartbeatAckWatchdogTimer = setTimeout(() => {
      this.heartbeatAckWatchdogTimer = undefined;
      if (this.state !== "paired" && this.state !== "waiting_terminal") return;
      const staleMs = Date.now() - this.lastPairStatusAckAt;
      this.options.logger.warn(
        "[web-remote-control] external relay heartbeat ack timeout, reconnecting",
        { state: this.state, staleMs },
      );
      this.reconnectAfterStaleWaiting(this.getReconnectJitterMs());
    }, timeout);
  }

  private getReconnectJitterMs(): number {
    const base = this.options.reconnectJitterMs ?? 2000;
    return base + Math.random() * base;
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    if (this.heartbeatAckWatchdogTimer) {
      clearTimeout(this.heartbeatAckWatchdogTimer);
      this.heartbeatAckWatchdogTimer = undefined;
    }
  }

  private scheduleReconnect(delay = this.options.reconnectDelayMs ?? 1000): void {
    if (this.manuallyClosed || this.terminalClose) return;
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private scheduleStaleWaitingRecovery(): void {
    if (this.staleWaitingRecoveryTimer) return;
    this.staleWaitingRecoveryTimer = setTimeout(() => {
      this.staleWaitingRecoveryTimer = undefined;
      if (this.state === "paired" && this.staleWaitingCount > 0) {
        this.reconnectAfterStaleWaiting();
      }
    }, 15000);
  }

  private clearStaleWaitingRecoveryTimer(): void {
    if (this.staleWaitingRecoveryTimer) {
      clearTimeout(this.staleWaitingRecoveryTimer);
      this.staleWaitingRecoveryTimer = undefined;
    }
  }

  private reconnectAfterStaleWaiting(delay = 0): void {
    this.clearStaleWaitingRecoveryTimer();
    this.stopHeartbeat();
    this.clearReconnectTimer();
    this.staleWaitingCount = 0;
    this.wasPaired = false;
    const socket = this.socket;
    this.socket = undefined;
    if (delay > 0) {
      this.setState("connecting");
      socket?.close();
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = undefined;
        if (!this.manuallyClosed && !this.terminalClose) this.connect();
      }, delay);
      return;
    }
    socket?.close();
    this.connect();
  }

  private enterError(error: Error): void {
    this.terminalClose = true;
    this.stopHeartbeat();
    this.clearStaleWaitingRecoveryTimer();
    this.setState("error");
    this.options.onError?.(error);
    this.socket?.close();
  }

  private enterRecoverableError(error: Error): void {
    this.stopHeartbeat();
    this.clearStaleWaitingRecoveryTimer();
    this.setState("error");
    this.options.onError?.(error);
    this.socket?.close();
  }

  private enterWaitingForPairAfterRelayError(error: Error): void {
    this.options.onError?.(error);
    this.clearStaleWaitingRecoveryTimer();
    this.staleWaitingCount = 0;
    this.wasPaired = false;
    this.startHeartbeat();
    this.setState("waiting_terminal");
  }

  private setState(state: WebRemoteControlTransportState): void {
    if (this.state === state) return;
    this.state = state;
    this.options.onStateChange?.(state);
  }

  private send(message: WebRemoteControlRelayMessage): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    const serialized = JSON.stringify(message);
    return this.sendSerialized(message, serialized);
  }

  private sendSerialized(message: WebRemoteControlRelayMessage, serialized: string): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(serialized);
    return true;
  }

  private calculateProof(passHash: string, nonce: string, role: string, deviceSid: string): string {
    // 对齐闭源 3.14.1: HMAC-SHA256(passHash, `${nonce}|${role}|${deviceSid}`)，竖线分隔
    return createHmac("sha256", passHash)
      .update(`${nonce}|${role}|${deviceSid}`)
      .digest("base64url");
  }
}

// ---- 认证 provider ----

export interface WebRemoteControlRelayAuthProvider {
  createPassword(): string;
  createPassHash(password: string): string;
  calculateProof(passHash: string, nonce: string, role: string, deviceSid: string): string;
}

export function createNodeWebRemoteControlRelayAuthProvider(): WebRemoteControlRelayAuthProvider {
  return {
    createPassword: () => randomBytes(24).toString("base64url"),
    createPassHash: (password: string) => createHash("sha256").update(password).digest("base64url"),
    calculateProof: (passHash: string, nonce: string, role: string, deviceSid: string) =>
      createHmac("sha256", passHash).update(`${nonce}|${role}|${deviceSid}`).digest("base64url"),
  };
}

// ---- 存储 provider ----

export interface WebRemoteControlRelayAuthStorage {
  deviceSid: string;
  passHash: string;
}

export interface WebRemoteControlRelayAuthStorageProvider {
  load(): Promise<WebRemoteControlRelayAuthStorage | undefined>;
  save(auth: WebRemoteControlRelayAuthStorage): Promise<void>;
  clear(): Promise<void>;
  rotate(auth: WebRemoteControlRelayAuthStorage): Promise<void>;
}

export function createWebRemoteControlRelayAuthStorageProvider(options: {
  credentialService: {
    load(key: string): Promise<string | undefined>;
    save(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
  };
  loadSettings: () => Promise<{ webRemoteControlExternalRelayDevice?: { deviceSid?: string } }>;
  patchSettings: (patch: Record<string, unknown>) => Promise<void>;
  logger?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
}): WebRemoteControlRelayAuthStorageProvider {
  const CREDENTIAL_KEY = "web-remote-control:external-relay:pass_hash";

  async function clear(): Promise<void> {
    await options.patchSettings({ webRemoteControlExternalRelayDevice: undefined });
    await options.credentialService.delete(CREDENTIAL_KEY);
    options.logger?.info("[web-remote-control] external relay auth cleared");
  }

  return {
    async load() {
      const settings = await options.loadSettings();
      const deviceSid = settings.webRemoteControlExternalRelayDevice?.deviceSid?.trim();
      const passHash = (await options.credentialService.load(CREDENTIAL_KEY))?.trim();
      if (!deviceSid && !passHash) return undefined;
      if (!deviceSid || !passHash) {
        options.logger?.warn("[web-remote-control] external relay auth partial state cleared", {
          hasDeviceSid: !!deviceSid,
          hasPassHash: !!passHash,
        });
        await clear();
        return undefined;
      }
      options.logger?.info("[web-remote-control] external relay auth loaded", {
        deviceSidSuffix: deviceSid.slice(-6),
      });
      return { deviceSid, passHash };
    },

    async save(auth) {
      await options.patchSettings({
        webRemoteControlExternalRelayDevice: { deviceSid: auth.deviceSid },
      });
      await options.credentialService.save(CREDENTIAL_KEY, auth.passHash);
      options.logger?.info("[web-remote-control] external relay auth saved", {
        deviceSidSuffix: auth.deviceSid.slice(-6),
      });
    },

    clear,

    async rotate(auth) {
      await clear();
      await this.save(auth);
      options.logger?.info("[web-remote-control] external relay auth rotated");
    },
  };
}
