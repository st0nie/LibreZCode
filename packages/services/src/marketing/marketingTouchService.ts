import { z } from "zod";
import type { ApiClient } from "@zcode/shared";
import { readApiJson } from "../providers/api/apiJson.js";

/**
 * ZCode marketingTouch(营销弹窗)服务,对齐闭源 3.14.1。
 * 契约: .agents/specs/marketingTouch.md
 *
 * 端点:
 * - GET  {base}/api/v1/marketing/touch?seq=<n>
 * - POST {base}/api/v1/marketing/touch/action
 */

export const MARKETING_TOUCH_LOCALES = ["zh-CN", "en-US"] as const;
export type MarketingTouchLocale = (typeof MARKETING_TOUCH_LOCALES)[number];

// ---- touch 响应 schema(HM) ----
const heroSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("image"), src: z.string(), darkSrc: z.string().optional() }),
  z.object({
    type: z.literal("video"),
    src: z.string(),
    darkSrc: z.string().optional(),
    poster: z.string(),
    autoplay: z.boolean().optional(),
    loop: z.boolean().optional(),
    muted: z.literal(true),
    fit: z.enum(["cover", "contain"]).optional(),
  }),
  z.object({
    type: z.literal("lottie"),
    src: z.string(),
    darkSrc: z.string().optional(),
    autoplay: z.boolean().optional(),
    loop: z.boolean().optional(),
  }),
]);

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("close") }),
  z.object({ type: z.literal("dismiss_content") }),
  z.object({
    type: z.literal("navigate"),
    destination: z.enum(["model_settings", "plugin_store", "settings"]),
  }),
  z.object({ type: z.literal("copy_text"), text: z.string().max(20000) }),
  z.object({ type: z.literal("open_external"), url: z.string() }),
  z.object({ type: z.literal("claim_plan"), planId: z.string() }),
]);

const touchSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  revision: z.number().int().positive(),
  kind: z.enum(["campaign", "feature", "notice"]),
  locale: z.enum(MARKETING_TOUCH_LOCALES),
  dialog: z.object({
    title: z.string().min(1).max(500),
    description: z.object({
      format: z.enum(["plain_text", "html", "markdown"]),
      text: z.string().max(20000),
    }),
    hero: heroSchema.optional(),
    buttons: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1).max(200),
          variant: z.enum(["primary", "secondary", "link"]),
          theme: z.string().nullish(),
          actionId: z.string().min(1),
        }),
      )
      .max(4),
  }),
  actions: z.record(z.string(), actionSchema),
});

export type MarketingTouch = z.infer<typeof touchSchema>;

// ---- report 请求体 schema(I3) ----
const reportSchema = z.object({
  locale: z.enum(MARKETING_TOUCH_LOCALES),
  scope: z.string().uuid(),
  campaignId: z.string().trim().min(1).max(128),
  actionType: z.enum(["confirm", "cancel"]),
});

export type MarketingTouchReportParams = z.infer<typeof reportSchema>;

// ---- 服务接口 ----
export interface IMarketingTouchService {
  /** 查询当前营销触达配置(带 scope 防串号) */
  query(params: { locale: MarketingTouchLocale }): Promise<MarketingTouch & { scope: string }>;
  /** 上报用户操作(confirm/cancel) */
  report(params: MarketingTouchReportParams): Promise<void>;
}

// ---- 实现 ----
export interface CreateMarketingTouchServiceOptions {
  baseUrl: string;
  apiClient: ApiClient;
  /** 取当前登录态 JWT(zcodejwttoken) */
  getToken: () => Promise<string | undefined>;
  /** 取设备 mid(uuid) */
  getDeviceMid: () => Promise<string | undefined> | string | undefined;
  /** 应用版本(X-ZCode-App-Version) */
  appVersion: string;
  /** 快照回调(用于本地缓存) */
  onSnapshot?: (snapshot: MarketingTouch & { scope: string }) => void;
}

export function createMarketingTouchService(
  options: CreateMarketingTouchServiceOptions,
): IMarketingTouchService {
  let currentScope: string | undefined;
  let currentToken: string | undefined;
  let seq = 0;

  async function buildContext(locale: MarketingTouchLocale): Promise<{
    scope: string;
    headers: Record<string, string>;
  }> {
    const token = (await options.getToken())?.trim() || "";
    // token 变更时重置 scope,防止串号
    if (currentToken !== token) {
      currentToken = token;
      currentScope = crypto.randomUUID();
    }
    const scope = currentScope ?? (currentScope = crypto.randomUUID());
    const deviceMid = (await options.getDeviceMid())?.trim();
    const headers: Record<string, string> = {
      "X-Device-Mid": deviceMid ? z.string().uuid().parse(deviceMid) : "",
      "X-Client-Language": locale,
      "X-ZCode-App-Version": options.appVersion,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    return { scope, headers };
  }

  return {
    async query({ locale }) {
      const ctx = await buildContext(locale);
      const url = new URL("/api/v1/marketing/touch", options.baseUrl);
      url.searchParams.set("seq", String(++seq));
      const raw = await readApiJson<unknown>(options.apiClient, url.href, {
        method: "GET",
        headers: ctx.headers,
        timeoutMs: 15000,
        redirect: "error",
      });
      // scope 校验:若 token 已变更,重新 build 后的 scope 应与请求时一致
      const verify = await buildContext(locale);
      if (verify.scope !== ctx.scope) {
        throw new Error("marketing_identity_changed");
      }
      const parsed = touchSchema.parse(raw);
      const result = { ...parsed, scope: ctx.scope };
      options.onSnapshot?.(result);
      return result;
    },

    async report(params) {
      const validated = reportSchema.parse(params);
      const ctx = await buildContext(validated.locale);
      if (ctx.scope !== validated.scope) {
        throw new Error("marketing_identity_changed");
      }
      const url = new URL("/api/v1/marketing/touch/action", options.baseUrl);
      await readApiJson<unknown>(options.apiClient, url.href, {
        method: "POST",
        headers: { ...ctx.headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_id: validated.campaignId,
          action_type: validated.actionType,
        }),
        timeoutMs: 15000,
        redirect: "error",
      });
    },
  };
}
