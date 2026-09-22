# 闭源 3.14.1 webRemoteControl(手机远控)完整契约

## 概述

桌面端(Electron main)作为 device，手机端作为 terminal，通过 WebSocket relay 中转配对。
桌面生成 QR 码，手机扫码后建立连接，之后 relay 中转 RPC 帧（workspace bridge)。

## 状态机(渲染层 UI)

```
idle → starting → connecting → registering → authenticating → waiting_terminal → paired → active
                                                                    ↓
                                                                  error
```

- starting: 初始化中(准备 auth/transport)
- connecting: WebSocket 连接中
- registering: 首次注册(无 persisted deviceSid)
- authenticating: 有 persisted deviceSid,做 HMAC 认证
- waiting_terminal: 等待手机扫码/连接
- paired: 已配对(手机已连)
- active: 活跃使用中
- running: 手机断开但桌面仍在运行(断线重连窗口)
- error: 连接失败

## 状态 payload(buildRuntimeStatus)

```ts
{
  status: "idle"|"starting"|"running"|"active"|"error",
  sessionId: deviceSid,        // 设备会话 id
  windowControlSessionId: deviceSid,
  mobileConnected: boolean,    // 手机是否已连
  mobileViewState?: unknown,   // 手机端 UI 状态
  mobileDeviceInfo?: unknown,  // 手机设备信息
  qrUrl: string,               // QR 码内容(手机扫码用)
  connectUrl: string,          // 同 qrUrl
  workspacePath: string,
  workspaceIdentity?: string,
  remoteSessionId?: string,
  initialTaskId?: string,
  error?: string,
  failure?: { reason: string, message: string }
}
```

## WebSocket 协议(设备端)

连接 `relayWsUrl`(默认由 endpointOrigin 派生,可 `ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL` 覆盖)。

### 注册流程(首次)

1. 连接 WS,带 `X-Device-ID: <deviceMid>` header
2. 发送 `{"type":"device_register_init","device_mid":..., "pass_hash":..., "meta":{platform,version,name}, "client_ts":...}`
3. 收 `{"type":"device_register_ack","device_sid":...}`
4. 发送 `{"type":"auth_init","role":"device","device_sid":...,"meta":...,"client_ts":...}`
5. 收 `{"type":"auth_challenge","nonce":...}`
6. 发送 `{"type":"auth_response","device_sid":...,"proof":HMAC-SHA1(passHash, nonce+"device"+deviceSid),"client_ts":...}`
7. 收 `{"type":"pair_status_ack","pair_status":"waiting"|"matched"}`

### 持久化重连(已有 deviceSid)

1. 连接 WS,带 `X-Device-ID`
2. 直接发送 `auth_init`(用 persisted deviceSid)
3. 走 auth_challenge/auth_response 流程

### 配对后

- 收 `pair_status_ack` 状态变化
- `{"type":"data","payload":{...}}` 中转 RPC 帧
- 心跳: `{"type":"pair_status_query","device_sid":...,"client_ts":...}`(默认 10s 间隔)
- 错误: `{"type":"error","code":"KICKED"|"AUTH_FAILED"|"INTERNAL"|"WRONG_PARAM","message":...}`

## RPC 帧(配对后中转)

- `{"zcode_type":"bootstrap-request"|"workspace-list-request"|"platform-request"|"mobile-view-state-update"|"workspace-bridge-open"|"workspace-reconnect-request"|"rpc-frame"|"rpc-frame-ack"|"telemetry-report"|"mobile-diagnostic", ...}`

## IPC 通道(渲染↔主进程)

- `zcode:start-web-remote-control` → StartWebRemoteControl(params)
- `zcode:stop-web-remote-control` → StopWebRemoteControl()
- `zcode:get-web-remote-control-status` → GetWebRemoteControlStatus()
- `zcode:web-remote-control-status-changed` → 订阅状态变更
- `zcode:reset-web-remote-control-pairing` → 重置配对
- `zcode:sync-web-remote-control-tasks` → 同步任务列表
- `zcode:sync-web-remote-control-workspaces` → 同步 workspace 列表
- `zcode:web-remote-control-reconnect-workspace` → 重连 workspace

## 存储

- `webRemoteControlExternalRelayDevice`: { deviceSid, passHash } 存 credentialService
- `webRemoteControlLastEnabledContext`: { workspacePath, workspaceIdentity?, initialTaskId? } 存 settings

## QR 码内容

`{remoteUrl}?device_sid=<deviceSid>&pass_hash=<passHash>&timestamp=<ts>&device_mid=<mid>&device_name=<name>&app_version=<ver>&theme=<theme>`

## 实现分层

- `packages/desktop/src/main/webRemoteControlDeviceTransport.ts`: WS 协议(注册/认证/配对/数据帧)
- `packages/desktop/src/main/webRemoteControlManager.ts`: 状态机 + 生命周期管理
- `packages/desktop/src/main/webRemoteControlIpc.ts`: IPC handler 注册
- `packages/desktop/src/main/webRemoteControl.ts`: 服务创建入口
- `packages/desktop/src/preload/index.ts`: window.zcode 桥接
- `packages/ui/src/`: renderer UI(设置页开关 + 状态展示 + QR 码)
