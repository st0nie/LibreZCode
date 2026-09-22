# 闭源 3.14.1 bots(机器人通知)契约(逆向提取)

## provider 列表

`["telegram","webhook","feishu","lark","weixin","discord","wecom"]`

## bot 配置 schema(version:3)

```ts
{
  version: 3,
  bots: [{
    id: string.min(1),
    name: string,
    provider: ["telegram","webhook","feishu","lark","weixin","discord","wecom"],
    enabled: boolean,
    credentialRef: string.min(1).optional(),
    webhookSecretRef: string.min(1).optional(),
    webhookUrl: string.url().optional(),
    webhookAuthHeaderName: string.min(1).optional(),
    feishuAppId: string.min(1).optional(),
    providerUserId: string.min(1).optional(),
    displayName: string.optional(),
    allowedWorkspaces: string.min(1)[],
    allowedCommands: {
      status: boolean,
      new: boolean,
      workspace: boolean,
      model: boolean,
      mode?: boolean,
      thoughtLevel: boolean,
      sandboxMode?: boolean,
      approvalPolicy?: boolean,
      cli?: boolean,
      reply: boolean,
    },
    currentOptions: {
      modelSelection?: { databaseStartupId: string.min(1).max(128) },
      mode?: string,
      sandboxMode?: string,
      approvalPolicy?: string,
      cli?: ["codex","claude","opencode","gemini","glm"],
    },
    replyMode: ["assistant_changes","assistant_toolcalls_changes","summary_changes","streaming_card"],
  }],
}
```

## bot 运行时状态(bots:runtime, version:3)

```ts
{
  version: 3,
  bots: Record<string, {
    botId: string.min(1),
    workspacePath: string.min(1),
    workspaceIdentity?: string.min(1),
    workspaceId?: string.min(1),
    mode: ["draft","task"],
    activeTaskId: string.min(1) | null,
    draftOptions?: { provider: ["codex","claude","opencode","gemini","glm"], modelSelection?, mode? },
    pendingPermissionOptions?: [{
      requestId, optionId, command: ["approve","deny"], label, response, handledAt?,
    }],
    pendingElicitation?: {
      taskId, requestId, runId, origin?, actorKey?, currentQuestionIndex,
      questions: [{question, header, options: [{value,label,description?}], multiSelect?}],
      answers: Record<string, string[]>,
      renderContext: {...},
    },
    telegramOffset?: number,
    weixinGetUpdatesBuf?: string,
    weixinActivatedAt?: number,
    updatedAt: number,
  }>,
}
```

## feishu bot 推送 schema

```ts
{
  provider: ["feishu","lark","weixin"],
  botId: string.min(1),
  providerUserId: string.min(1),
  chatType: ["private","group"],
}
```

## 推送订阅类型

`["assistant_changes","assistant_toolcalls_changes","summary_changes","streaming_card"]`

## 推送目标标识

- `bots:task`
- `bots:task-stream`

## 实现分层

- `packages/services/src/bots/botsService.ts`: bot 配置 CRUD + 状态管理 + 推送调度
- `packages/services/src/bots/feishuBot.ts`: 飞书 bot 推送(长连接)
- `packages/services/src/bots/telegramBot.ts`: Telegram bot 推送
- `packages/services/src/bots/webhookBot.ts`: Webhook 通用推送
- `packages/ui/src/settings/BotsSettingSection.tsx`: 设置页组件

## i18n 键(已补齐)

- bots.title/addBot/connected/errorMessage/feishu/token/cancelSave/saveChanges
- bots.webhook.error.invalidUrl
- bots.token.label/token.placeholder/token.hint
- bots.webhook.webhookUrl
- bots.workspaces.commandConfig/workspace.showAllWorkspace
- bots.confirmDeleteBot/deleteBot
- bots.connectToBot/connecting/pairingWaiting/failedTitle/errorCode/errorMessage
- bots.titleBadge/titleConnectedToBots/description
