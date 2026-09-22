# LibreZCode

[English](#english) | 中文

> ZCode 的开源复刻版。基于 [zai-org/ZCode](https://github.com/zai-org/ZCode)(开源版,3.14.0),通过逆向闭源 ZCode Desktop 3.14.1,补齐了开源版缺失的闭源功能,目标是**与闭源版行为一致**。

[![Release](https://github.com/st0nie/LibreZCode/actions/workflows/release.yml/badge.svg)](https://github.com/st0nie/LibreZCode/releases)

---

## 这是什么

ZAI 官方把 ZCode 以 **Apache-2.0** 协议开源(`zai-org/ZCode`),但**桌面端的若干功能只在闭源 AppImage 里提供**,开源仓库里没有:

- 额度优惠(150% 配额活动)
- 手机远控(桌面 ↔ 手机扫码互控)
- 机器人通知(Telegram / 飞书 / 微信 / Webhook …)
- 营销弹窗、权益领取、server 远程连接 等

**LibreZCode 把这些闭源功能逆向并补了回来**,让你能用上开源、可自托管、可审计的完整版 ZCode。

> 本仓库是 `zai-org/ZCode` 的 fork,保留上游同步能力。

---

## 相比原开源版的修改

> 详细实现见 [billing-discount-research.md](.agents/specs/billing-discount-research.md) 与 [`.agents/specs/`](./.agents/specs/) 下的契约文档。

### ✅ 已补齐的闭源功能

| 功能                           | 说明                                                                                                                                          | 主要位置                                   |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **额度优惠(billingDiscount)**  | 服务端按 locale 下发纯文案/Markdown 配置,客户端只校验+缓存 1h+渲染徽章/ⓘ弹窗;3 个露出点(升级按钮/余额面板/额度不足横幅)。完全对齐闭源 3.14.1  | `shared` / `services` / `ui`               |
| **更新通道 → GitHub Releases** | 运行时 autoUpdater 从官方 endpoint 切到 GitHub Releases provider,支持自动更新                                                                 | `desktop/main/autoUpdater.ts`              |
| **release.yml CI**             | GitHub Actions:校验版本→建 tag/release→构建 CLI + 桌面(mac-arm64/mac-x64/win-x64/linux-x64)→上传 assets                                       | `.github/workflows/release.yml`            |
| **mode 五族模式映射**          | claude / codex / gemini / opencode / glm 的权限模式标签                                                                                       | `services/model-provider/display-help.ts`  |
| **webRemoteControl(手机远控)** | WebSocket relay 配对协议(注册/认证/配对/心跳/重连) + 状态机 + RPC 帧路由(bootstrap/workspace-list/platform/workspace-bridge 等) + 设置页 UI   | `desktop/main/webRemoteControl*.ts`        |
| **server RemoteTarget**        | 新增 `kind:"server"`(连接已运行的 ZCode server),含类型/schema/snapshot/连接表单(url/name/token/workspacePath)                                 | `shared` / `server/remote` / `ui`          |
| **bots 机器人通知**            | Telegram / 飞书 / 微信 / Webhook / Discord / WeCom 的配置 CRUD + 推送;含运行时状态(权限/询问)schema                                           | `services/bots/botsService.ts` + 设置页 UI |
| **marketingTouch(营销弹窗)**   | GET/POST `/api/v1/marketing/touch(/action)`,schemaVersion:1 的 campaign/feature/notice 弹窗 + action 上报                                     | `services/marketing` + UI 弹窗             |
| **manualClaimPlan(权益领取)**  | 查询可领取体验套餐(`preview`)+ 领取(`claim`,阿里云验证码)                                                                                     | `services` + 横幅 UI                       |
| **内置 10 插件**               | documents / pdf / spreadsheets / presentations / slides / skill-creator / plugin-creator / image-search / restore-legacy-sessions / zcode-cua | `apps/zcode-cli/packages/`                 |
| **i18n 524 缺口键**            | bots / webRemoteControl / manualClaimPlan / mode / settings / marketingTouch / rewards 等的 zh-CN + en-US 文案                                | `ui/src/i18n/locales/`                     |

### 🔧 工程修复

- `package.json`:把 `overrides`/`patchedDependencies` 从顶层移到 `pnpm.*`(pnpm v9+ 只认后者,否则 CI `--frozen-lockfile` 报 lockfile 配置不匹配)。
- `release.yml`:Linux job 补 `libarchive-tools`(提供 `bsdtar`),否则 electron-builder 打 pacman 包报 `exit code 127`。
- 桌面入口:`webRemoteControl` 的 `deviceName` 误用未导入的 `os.hostname()` → `hostname()`(曾导致启动即 `ReferenceError`)。

---

## 构建与发布

发布走 GitHub Actions(无需本地编译):

1. **Actions → Release → Run workflow**
2. 输入:`version`(如 `3.14.0-libre.5`)、`prerelease`、`build_artifacts=true`
3. 自动:校验版本 → 创建 tag + Release → 构建 CLI 发行包 + 4 平台桌面包 → 上传 assets

产物:`ZCode-*.{AppImage,dmg,exe,pkg.tar.zst}` + `zcode-*.tar.gz` + `install.sh` + 自动更新元数据。

### 本地开发

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm dev:desktop
```

### 老 AMD 显卡启动

部分老 AMD 显卡(如 Oland / Radeon HD 8570 / R5 430)会因 GPU 进程崩溃导致白屏/起不来(Electron 已知问题,**官方闭源版同样起不来**)。强制软件渲染即可:

```bash
./ZCode-*-linux-x86_64.AppImage --no-sandbox --disable-gpu
```

> 与闭源版行为一致;`--disable-gpu` 只是绕过 GPU 加速,功能不受影响。

---

## 相比闭源版的不足(后续逐步优化)

> 当前是**"核心数据流/业务逻辑已对齐,工程完成度还差最后一截"**。以下按优先级列出,欢迎认领。

### 高优先级 —— 影响"真能用"

- **server / webRemote 的远端 RPC 真实接线**:`ServerBackend` 与 webRemote 的 `rpc-frame` 路由目前是**骨架**,真实"远端读写文件/执行命令/手机操控桌面"还需把 server RPC 协议完整接起来,否则远端功能是空转。
- **闭源运行时尚有未逆向细节**:部分边角(如某些 campaign 的精确交互流、off-peak 完整调度)只补了契约与服务层,真实后端联动待验证。

### 中优先级 —— 影响"好用"

- **UI 像素级差异**:marketingTouch / bots / manualClaimPlan 等弹窗是**功能骨架**,样式/间距/动效与闭源还有差距,未到像素级。
- **i18n 文案为逆向填充**:524 个缺口键中部分文案是按语义补的,与闭源逐字一致度待核对。

### 低优先级 —— 锦上添花

- **遥测 / 官方平台深度集成**:按你的要求未对齐闭源的 ARMS 数仓上报(也不建议对齐)。
- **部分功能仅服务层**:rewards、off-peak、campaign 完整交互流等,UI 可后续补。

> 详见 [billing-discount-research.md](.agents/specs/billing-discount-research.md) 的实现汇总与 `.agents/specs/` 契约。

---

## 免责声明

本项目基于 ZCode(**Apache-2.0**)二次开发,沿用其开源协议;新增改动同样以 Apache-2.0 发布(见 [`LICENSE`](./LICENSE))。ZCode 及相关商标归其所有者。逆向所得契约用于实现兼容,不包含闭源二进制本身。

> 注:ZCode 是 **Apache-2.0** 而非 MIT 开源。

---

<a name="english"></a>

# LibreZCode (English)

> An open-source rebuild of ZCode Desktop. Based on the open-sourced [zai-org/ZCode](https://github.com/zai-org/ZCode) (v3.14.0), it reverse-engineers the closed-source ZCode Desktop 3.14.1 to restore the features the open-source repo is missing — with the goal of **behavioral parity** with the closed build.

## Why

ZAI open-sourced ZCode under **Apache-2.0**, but several desktop features exist **only in the closed AppImage**: the 150% quota discount, phone↔desktop remote control, bot notifications (Telegram/Feishu/WeChat/Webhook), marketing dialogs, claimable plans, and server remote connections. **LibreZCode brings those back** so you can run a fully-featured, self-hostable, auditable ZCode from source.

## What we changed vs. the open-source version

- **Restored closed features** (see the table above): billing discount, GitHub-Release update channel, release CI, 5-agent mode mapping, webRemoteControl (full WS-relay protocol + RPC frame routing), `server` RemoteTarget + connection form, bots service + settings UI, marketingTouch dialogs, manualClaimPlan claim flow, 10 built-in plugins, and 524 missing i18n keys.
- **Engineering fixes**: pnpm v9 `overrides`/`patchedDependencies` placement, Linux CI `libarchive-tools` (bsdtar) for pacman packaging, and a startup `os.hostname()` crash fix.

## Build & Release

Releases are built by GitHub Actions — no local compile needed. Run the **Release** workflow with a `version`, `prerelease`, and `build_artifacts=true`; it validates, tags, builds CLI + desktop (mac-arm64/mac-x64/win-x64/linux-x64), and uploads assets.

Local dev: `pnpm install && pnpm typecheck && pnpm dev:desktop`.

**Old AMD GPUs** (e.g. Oland / Radeon HD 8570 / R5 430) may crash on the GPU process and show a blank window — a known Electron issue that also affects the official closed build. Launch with `--disable-gpu` to force software rendering.

## Remaining gaps vs. closed (to be polished)

- Server / webRemote remote RPC is currently a **skeleton** — real remote file/exec / phone-control needs the server RPC protocol fully wired.
- UI for marketingTouch / bots / manualClaimPlan is **functional but not pixel-perfect** vs. closed.
- Some i18n copy is reverse-filled, not yet verbatim-identical.
- Telemetry / official-platform deep integration intentionally not replicated.

See [billing-discount-research.md](.agents/specs/billing-discount-research.md) and `.agents/specs/` for implementation details and contracts.

## Disclaimer

This project is a derivative work of ZCode (**Apache-2.0**) and inherits that license; new changes are likewise released under Apache-2.0 (see [`LICENSE`](./LICENSE)). ZCode and related trademarks belong to their owners. Reverse-engineered contracts are used for compatibility; no closed-source binaries are included.
