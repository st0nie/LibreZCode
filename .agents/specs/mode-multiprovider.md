# 闭源 3.14.1 mode 多 agent provider 契约(逆向提取)

## ZCodeProvider 值域
闭源 `z.enum(["codex","claude","opencode","gemini","glm"])`。开源现为 `["glm"]`。

## mode 选项 label 映射(tft=ZCODE_MODE_OPTION_LABEL_IDS)
```
claude: { auto, default, acceptEdits, plan, dontAsk, bypassPermissions }
codex:  { "read-only", auto, agent, "full-access", "agent-full-access" }
gemini: { default, autoEdit, yolo, plan }
opencode:{ build, plan }
glm:    { default, build, edit, plan, yolo }
```
i18n key 模式: `mode.label.<provider>.<value>`(codex 的 read-only→readOnly, full-access→fullAccess, agent-full-access→agentFullAccess)

## mode 选项 description 映射(nft=ZCODE_MODE_OPTION_DESCRIPTION_IDS)
同结构,key 模式 `mode.description.<provider>.<value>`。各 value 的文案见 locales 已补齐的键。

## sessionConfigStateSchema.provider
闭源是 `z.enum(5族)`;开源是 `z.string()`。扩展 providers.ts 的 ZCODE_PROVIDERS。

## 消费链路(开源落点)
- `packages/shared/src/providers.ts`: ZCODE_PROVIDERS=["glm"]→加 4 族
- `packages/ui/src/chat-input-toolbar/display-help.ts`: ZCODE_MODE_OPTION_LABEL_IDS / _DESCRIPTION_IDS 只填了 glm→补全 5 族
- `packages/ui/src/chat-input-toolbar/display.tsx`: `ZCODE_MODE_OPTION_LABEL_IDS[provider]?.[entry.value]` 逻辑不变,provider 实参来自 `V4ComposerModeControls` 的 `displayProvider = provider ?? ZCODE_AGENT_PROVIDER`
- 模式选择器组件:`V4ComposerModeControls.tsx` 用 `getModeOptionDisplayLabel(intl, displayProvider, {value,name})`

## 注意
- mode option 的 value(claude 的 auto/default/... )由 agent 后端下发,UI 只负责按 provider+value 查 i18n。
- 扩展 ZCODE_PROVIDERS 后,凡 switch/穷尽判断 provider 处需确认仍编译通过(大部分用 `provider === "glm"` 或 type-only)。
