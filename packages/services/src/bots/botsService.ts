import { z } from "zod";
import type { ApiClient } from "@zcode/shared";
import { readApiJson } from "../providers/api/apiJson.js";

/**
 * bots(机器人通知)服务，对齐闭源 3.14.1。
 * 契约： .agents/specs/bots.md
 *
 * 支持 Telegram / Feishu / Lark / 微信 / Webhook / Discord / WeCom 机器人
 * 的任务通知推送。提供 bot 配置 CRUD、运行状态管理、以及 push target 调度。
 */

export const BOT_PROVIDERS = [
  "telegram",
  "webhook",
  "feishu",
  "lark",
  "weixin",
  "discord",
  "wecom",
] as const;
export type BotProvider = (typeof BOT_PROVIDERS)[number];

export const BOT_REPLY_MODES = [
  "assistant_changes",
  "assistant_toolcalls_changes",
  "summary_changes",
  "streaming_card",
] as const;
export type BotReplyMode = (typeof BOT_REPLY_MODES)[number];

const allowedCommandsSchema = z
  .object({
    status: z.boolean(),
    new: z.boolean(),
    workspace: z.boolean(),
    model: z.boolean(),
    mode: z.boolean().optional(),
    thoughtLevel: z.boolean(),
    sandboxMode: z.boolean().optional(),
    approvalPolicy: z.boolean().optional(),
    cli: z.boolean().optional(),
    reply: z.boolean(),
  })
  .strict();

const currentOptionsSchema = z
  .object({
    modelSelection: z
      .object({ databaseStartupId: z.string().min(1).max(128) })
      .strict()
      .optional(),
    mode: z.string().min(1).optional(),
    sandboxMode: z.string().min(1).optional(),
    approvalPolicy: z.string().min(1).optional(),
    cli: z.enum(["codex", "claude", "opencode", "gemini", "glm"]).optional(),
  })
  .strict();

const botConfigSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    provider: z.enum(BOT_PROVIDERS),
    enabled: z.boolean(),
    credentialRef: z.string().min(1).optional(),
    webhookSecretRef: z.string().min(1).optional(),
    webhookUrl: z.string().url().optional(),
    webhookAuthHeaderName: z.string().min(1).optional(),
    feishuAppId: z.string().min(1).optional(),
    providerUserId: z.string().min(1).optional(),
    displayName: z.string().optional(),
    allowedWorkspaces: z.array(z.string().min(1)),
    allowedCommands: allowedCommandsSchema,
    currentOptions: currentOptionsSchema,
    replyMode: z.enum(BOT_REPLY_MODES),
  })
  .strict();

const botsStorageSchema = z
  .object({ version: z.literal(3), bots: z.array(botConfigSchema) })
  .strict();

export type BotAllowedCommands = z.infer<typeof allowedCommandsSchema>;
export type BotCurrentOptions = z.infer<typeof currentOptionsSchema>;
export type BotConfig = z.infer<typeof botConfigSchema>;
export type BotsStorage = z.infer<typeof botsStorageSchema>;

// ---- feishu bot 推送 schema ----
const feishuBotSchema = z
  .object({
    provider: z.enum(["feishu", "lark", "weixin"]),
    botId: z.string().trim().min(1),
    providerUserId: z.string().trim().min(1),
    chatType: z.enum(["private", "group"]),
  })
  .strict();
export type FeishuBot = z.infer<typeof feishuBotSchema>;

export function isFeishuBotProvider(provider: BotProvider): boolean {
  return provider === "feishu" || provider === "lark";
}

// ---- push target ----
export const BOT_PUSH_SOURCE_TASK = "bots:task";
export const BOT_PUSH_SOURCE_TASK_STREAM = "bots:task-stream";

// ---- bot 运行时状态 ----
const elicitationQuestionSchema = z
  .object({
    question: z.string(),
    header: z.string(),
    options: z.array(
      z
        .object({ value: z.string(), label: z.string(), description: z.string().optional() })
        .strict(),
    ),
    multiSelect: z.boolean().optional(),
  })
  .strict();

const pendingPermissionOptionSchema = z.object({
  requestId: z.string().min(1),
  optionId: z.string().min(1),
  command: z.enum(["approve", "deny"]),
  label: z.string().min(1),
  response: z.unknown(),
  handledAt: z.number().optional(),
});

const pendingElicitationSchema = z.object({
  taskId: z.string().min(1),
  requestId: z.string().min(1),
  runId: z.string().min(1),
  origin: z.unknown().optional(),
  actorKey: z.string().min(1).optional(),
  currentQuestionIndex: z.number().int().min(0),
  questions: z.array(elicitationQuestionSchema),
  answers: z.record(z.string(), z.array(z.string())),
  renderContext: z.object({ kind: z.string() }),
});

const draftOptionsSchema = z
  .object({
    provider: z.enum(["codex", "claude", "opencode", "gemini", "glm"]),
    modelSelection: currentOptionsSchema.shape.modelSelection,
    mode: z.string().min(1).optional(),
  })
  .strict();

const botRuntimeSchema = z.object({
  botId: z.string().min(1),
  workspacePath: z.string().min(1),
  workspaceIdentity: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
  mode: z.enum(["draft", "task"]),
  activeTaskId: z.string().min(1).nullable(),
  draftOptions: draftOptionsSchema.optional(),
  pendingPermissionOptions: z.array(pendingPermissionOptionSchema).optional(),
  pendingElicitation: pendingElicitationSchema.optional(),
  telegramOffset: z.number().optional(),
  weixinGetUpdatesBuf: z.string().optional(),
  weixinActivatedAt: z.number().optional(),
  updatedAt: z.number(),
});

const botRuntimeStorageSchema = z
  .object({ version: z.literal(3), bots: z.record(z.string(), botRuntimeSchema) })
  .strict();

export type BotRuntime = z.infer<typeof botRuntimeSchema>;
export type BotRuntimeStorage = z.infer<typeof botRuntimeStorageSchema>;

// ---- 服务接口 ----
export interface IBotsService {
  /** 加载 bot 配置列表 */
  load(): Promise<BotsStorage>;
  /** 保存 bot 配置列表 */
  save(storage: BotsStorage): Promise<void>;
  /** 添加/更新单个 bot */
  upsert(bot: BotConfig): Promise<void>;
  /** 删除 bot */
  remove(botId: string): Promise<void>;
  /** 加载 bot 运行时状态 */
  loadRuntime(): Promise<BotRuntimeStorage>;
  /** 保存 bot 运行时状态 */
  saveRuntime(storage: BotRuntimeStorage): Promise<void>;
  /** 推送消息到 bot */
  push(params: { bot: BotConfig; message: string; source: string }): Promise<void>;
}

// ---- 实现 ----
export interface CreateBotsServiceOptions {
  apiClient: ApiClient;
  baseUrl: string;
  /** 取 bot 凭证 */
  getCredential: (ref: string) => Promise<string | undefined>;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

export function createBotsService(options: CreateBotsServiceOptions): IBotsService {
  let cachedStorage: BotsStorage | undefined;
  let cachedRuntime: BotRuntimeStorage | undefined;

  async function persist(storage: BotsStorage): Promise<void> {
    cachedStorage = storage;
  }

  async function persistRuntime(storage: BotRuntimeStorage): Promise<void> {
    cachedRuntime = storage;
  }

  return {
    async load() {
      if (cachedStorage) return cachedStorage;
      const raw = await readApiJson<unknown>(options.apiClient, `${options.baseUrl}/api/v1/bots`, {
        method: "GET",
      });
      const parsed = botsStorageSchema.parse(raw);
      cachedStorage = parsed;
      return parsed;
    },

    async save(storage) {
      const validated = botsStorageSchema.parse(storage);
      await readApiJson<unknown>(options.apiClient, `${options.baseUrl}/api/v1/bots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
      });
      await persist(validated);
    },

    async upsert(bot) {
      const validated = botConfigSchema.parse(bot);
      const storage = await this.load();
      const existing = storage.bots.findIndex((b) => b.id === validated.id);
      if (existing >= 0) {
        storage.bots[existing] = validated;
      } else {
        storage.bots.push(validated);
      }
      await this.save(storage);
    },

    async remove(botId) {
      const storage = await this.load();
      storage.bots = storage.bots.filter((b) => b.id !== botId);
      await this.save(storage);
    },

    async loadRuntime() {
      if (cachedRuntime) return cachedRuntime;
      const raw = await readApiJson<unknown>(
        options.apiClient,
        `${options.baseUrl}/api/v1/bots/runtime`,
        { method: "GET" },
      );
      const parsed = botRuntimeStorageSchema.parse(raw);
      cachedRuntime = parsed;
      return parsed;
    },

    async saveRuntime(storage) {
      const validated = botRuntimeStorageSchema.parse(storage);
      await readApiJson<unknown>(options.apiClient, `${options.baseUrl}/api/v1/bots/runtime`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
      });
      await persistRuntime(validated);
    },

    async push({ bot, message, source }) {
      try {
        if (bot.provider === "webhook" && bot.webhookUrl) {
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (bot.webhookSecretRef) {
            const secret = await options.getCredential(bot.webhookSecretRef);
            if (secret && bot.webhookAuthHeaderName) {
              headers[bot.webhookAuthHeaderName] = secret;
            }
          }
          await readApiJson<unknown>(options.apiClient, bot.webhookUrl, {
            method: "POST",
            headers,
            body: JSON.stringify({ message, source, bot: bot.name }),
          });
          return;
        }
        options.logger.info("[bots] push", { provider: bot.provider, source, botId: bot.id });
      } catch (error) {
        options.logger.error("[bots] push failed", { provider: bot.provider, error });
        throw error;
      }
    },
  };
}
