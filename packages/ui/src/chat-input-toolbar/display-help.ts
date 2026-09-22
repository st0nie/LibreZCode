import type { ZCodeProvider } from "@zcode/shared";

/**
 * mode 权限模式选项的 i18n label 映射,按 agent provider 分族。
 * 与闭源 3.14.1 一致:claude/codex/gemini/opencode/glm 五族。
 * 顶层键放宽为 string(provider 实参来自 agent 后端下发,UI 只负责按 provider+value 查 i18n),
 * 避免扩展 ZCodeProvider 值域引发大面积类型变更。
 */
export const ZCODE_MODE_OPTION_LABEL_IDS: Record<string, Record<string, string>> = {
  claude: {
    auto: "mode.label.claude.auto",
    default: "mode.label.claude.default",
    acceptEdits: "mode.label.claude.acceptEdits",
    plan: "mode.label.claude.plan",
    dontAsk: "mode.label.claude.dontAsk",
    bypassPermissions: "mode.label.claude.bypassPermissions",
  },
  codex: {
    "read-only": "mode.label.codex.readOnly",
    auto: "mode.label.codex.auto",
    agent: "mode.label.codex.agent",
    "full-access": "mode.label.codex.fullAccess",
    "agent-full-access": "mode.label.codex.agentFullAccess",
  },
  gemini: {
    default: "mode.label.gemini.default",
    autoEdit: "mode.label.gemini.autoEdit",
    yolo: "mode.label.gemini.yolo",
    plan: "mode.label.gemini.plan",
  },
  opencode: {
    build: "mode.label.opencode.build",
    plan: "mode.label.opencode.plan",
  },
  glm: {
    default: "mode.label.glm.default",
    build: "mode.label.glm.build",
    edit: "mode.label.glm.edit",
    plan: "mode.label.glm.plan",
    yolo: "mode.label.glm.yolo",
  },
};

export const ZCODE_MODE_OPTION_DESCRIPTION_IDS: Record<string, Record<string, string>> = {
  claude: {
    auto: "mode.description.claude.auto",
    default: "mode.description.claude.default",
    acceptEdits: "mode.description.claude.acceptEdits",
    plan: "mode.description.claude.plan",
    dontAsk: "mode.description.claude.dontAsk",
    bypassPermissions: "mode.description.claude.bypassPermissions",
  },
  codex: {
    "read-only": "mode.description.codex.readOnly",
    auto: "mode.description.codex.auto",
    agent: "mode.description.codex.agent",
    "full-access": "mode.description.codex.fullAccess",
    "agent-full-access": "mode.description.codex.agentFullAccess",
  },
  gemini: {
    default: "mode.description.gemini.default",
    autoEdit: "mode.description.gemini.autoEdit",
    yolo: "mode.description.gemini.yolo",
    plan: "mode.description.gemini.plan",
  },
  opencode: {
    build: "mode.description.opencode.build",
    plan: "mode.description.opencode.plan",
  },
  glm: {
    default: "mode.description.glm.default",
    build: "mode.description.glm.build",
    edit: "mode.description.glm.edit",
    plan: "mode.description.glm.plan",
    yolo: "mode.description.glm.yolo",
  },
};
