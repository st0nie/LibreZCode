import { z } from "zod";
import type { ApiClient } from "@zcode/shared";
import { readApiJson } from "../providers/api/apiJson.js";

/**
 * manualClaimPlan(权益领取)服务，对齐闭源 3.14.1。
 * 契约： .agents/specs/manualClaimPlan.md
 *
 * 查询可领取的体验套餐(preview),领取(claim,带阿里云验证码)。
 */

const entitlementSchema = z.object({
  entitlement_id: z.string().trim().min(1),
  show_name: z.string().trim().default(""),
  meter: z.string().trim().default(""),
  unit_type: z.string().trim().default(""),
  capabilities: z.array(z.string()).default([]),
  grant_units: z.number().default(0),
  period: z.string().trim().default(""),
});

const previewPlanSchema = z.object({
  plan_id: z.string().trim().min(1),
  name: z.string().trim().optional(),
  description: z.string().trim().optional(),
  priority: z.number().optional(),
  entitlements: z.array(entitlementSchema).default([]),
});

export type ManualClaimEntitlement = z.infer<typeof entitlementSchema>;
export type ManualClaimPlan = z.infer<typeof previewPlanSchema>;

export interface IManualClaimPlanService {
  /** 查询当前可领取的体验套餐列表(无 token 也返回,游客态降级) */
  preview(): Promise<ManualClaimPlan[]>;
  /** 领取套餐(需登录 + 阿里云验证码) */
  claim(params: {
    planId: string;
    captchaVerifyParam: string;
    captchaRegion?: string;
  }): Promise<void>;
}

export interface CreateManualClaimPlanServiceOptions {
  apiClient: ApiClient;
  baseUrl: string;
  /** 应用版本(X-ZCode-App-Version / app_version 参数) */
  appVersion: string;
  /** 平台(X-Platform / platform 参数) */
  platform: string;
  /** 取 zcodejwttoken */
  getToken: () => Promise<string | undefined>;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

export function createManualClaimPlanService(
  options: CreateManualClaimPlanServiceOptions,
): IManualClaimPlanService {
  function buildUrl(path: string): string {
    const url = new URL(path, options.baseUrl);
    url.searchParams.set("app_version", options.appVersion);
    url.searchParams.set("platform", options.platform);
    return url.toString();
  }

  return {
    async preview() {
      const token = (await options.getToken())?.trim();
      const raw = (await readApiJson<{ code?: number; msg?: string; data?: unknown }>(
        options.apiClient,
        buildUrl("/api/v1/zcode-plan/billing/preview"),
        {
          method: "GET",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          timeoutMs: 15000,
        },
      )) as { code?: number; msg?: string; data?: unknown };
      if (raw.code !== undefined && raw.code !== 0) {
        throw new Error(raw.msg?.trim() || "manual_claim_preview_failed");
      }
      if (!raw.data) return [];
      const parsed = z.array(previewPlanSchema).parse(raw.data);
      return parsed;
    },

    async claim({ planId, captchaVerifyParam, captchaRegion }) {
      const token = (await options.getToken())?.trim();
      if (!token) throw new Error("manual_claim_requires_login");
      const raw = (await readApiJson<{ code?: number; msg?: string }>(
        options.apiClient,
        buildUrl("/api/v1/zcode-plan/billing/claim"),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "X-Aliyun-Captcha-Verify-Param": captchaVerifyParam,
            ...(captchaRegion ? { "X-Aliyun-Captcha-Verify-Region": captchaRegion } : {}),
            "X-ZCode-App-Version": options.appVersion,
            "X-Platform": options.platform,
          },
          body: JSON.stringify({ plan_id: planId }),
          timeoutMs: 15000,
        },
      )) as { code?: number; msg?: string };
      if (raw.code !== undefined && raw.code !== 0) {
        throw new Error(raw.msg?.trim() || "manual_claim_failed");
      }
      options.logger.info("[manual-claim-plan] claimed", { planId });
    },
  };
}
