#!/usr/bin/env node
/**
 * Start Plan 鉴权链路诊断工具(curl 逆向,见 .agents/specs/start-plan-auth.md)
 *
 * 解密 ~/.zcode/v2/credentials.json(本机 AES-256-GCM),取 zcodejwttoken +
 * coding-plan-api-key,实测 GLM 端点连通性。用于定位 auth_failed 根因。
 *
 * 用法: node scripts/diagnose-start-plan-auth.mjs
 * 不修改任何凭证,只读 + 发一次最小模型请求。
 */
import { createDecipheriv, createHash } from "node:crypto";
import { userInfo, platform, homedir } from "node:os";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HOME = process.env.HOME ?? homedir();
const CRED_PATH = join(HOME, ".zcode", "v2", "credentials.json");

function deriveCipherKey() {
  let username = "unknown";
  try {
    username = userInfo().username;
  } catch {}
  const secret = `zcode-credential-fallback:${platform()}:${homedir()}:${username}`;
  return createHash("sha256").update(secret).digest();
}

function decryptCredential(value) {
  if (!value.startsWith("enc:v1:")) return value;
  const parts = value.slice("enc:v1:".length).split(".");
  const [ivRaw, authTagRaw, cipherRaw] = parts;
  if (!ivRaw || !authTagRaw || !cipherRaw || parts.length !== 3) {
    throw new Error("credential 密文格式非法");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveCipherKey(),
    Buffer.from(ivRaw, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(authTagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(cipherRaw, "base64url")),
    decipher.final(),
  ]).toString("utf-8");
}

function loadJwtExpiration(jwt) {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf-8"));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

async function main() {
  const creds = JSON.parse(readFileSync(CRED_PATH, "utf8"));
  const jwt = creds["zcodejwttoken"] ? decryptCredential(creds["zcodejwttoken"]) : null;
  const cpEntry = Object.entries(creds).find(
    ([k]) => k.includes("coding-plan") && k.includes("zai") && k.endsWith("api-key"),
  );
  const codingPlanKey = cpEntry ? decryptCredential(cpEntry[1]) : null;

  console.log("=== 凭证状态 ===");
  console.log("zcodejwttoken:", jwt ? `有 (${jwt.length} chars)` : "缺失");
  if (jwt) {
    const exp = loadJwtExpiration(jwt);
    if (exp) {
      const expired = Date.now() > exp;
      console.log(
        `  过期时间: ${new Date(exp).toISOString()} (${expired ? "已过期 ❌" : "有效 ✅"})`,
      );
    }
  }
  console.log(
    "x-coding-plan-api-key:",
    codingPlanKey ? `有 (${codingPlanKey.length} chars)` : "缺失",
  );

  console.log("\n=== GLM 端点实测(POST /api/anthropic/v1/messages) ===");
  if (!jwt) {
    console.log("无 JWT,跳过实测。请先登录 ZAI 账号。");
    return;
  }
  const body = JSON.stringify({
    model: "GLM-5.3",
    max_tokens: 10,
    messages: [{ role: "user", content: "hi" }],
  });
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` };
  if (codingPlanKey) headers["X-Coding-Plan-Api-Key"] = codingPlanKey;

  try {
    const res = await fetch("https://api.z.ai/api/anthropic/v1/messages", {
      method: "POST",
      headers,
      body,
    });
    const text = (await res.text()).slice(0, 200);
    console.log(`HTTP ${res.status}`);
    console.log(text);
    if (res.status === 401 && text.includes("expired")) {
      console.log("\n→ 诊断: zcodejwttoken 已过期。请退出账号重新登录 ZAI 刷新 token。");
    } else if (res.ok) {
      console.log("\n→ 诊断: 鉴权链路正常,GLM 调用成功。");
    }
  } catch (err) {
    console.log("请求失败:", err instanceof Error ? err.message : err);
  }
}

main();
