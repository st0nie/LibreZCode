# 闭源 3.14.1 manualClaimPlan(权益领取)契约(逆向提取)

## 端点

- GET `{base}/api/v1/zcode-plan/billing/preview?app_version=&platform=`
- POST `{base}/api/v1/zcode-plan/billing/claim`

## preview(查询可领取套餐)

请求头:可选 `Authorization: Bearer <zcodejwttoken>`
响应: `{ code, msg, data }`;`code!==0` 抛错。
data 为可领取套餐数组,每项含 `plan_id`,以及 name/description/priority/entitlements 等。
entitlements: `{ entitlement_id, show_name, meter, unit_type, capabilities, grant_units, period }`

## claim(领取)

请求头:

- `Authorization: Bearer <zcodejwttoken>`(必填)
- `Content-Type: application/json`
- `X-Aliyun-Captcha-Verify-Param: <captchaVerifyParam>`(阿里云验证码)
- 可选 `X-Aliyun-Captcha-Verify-Region`
- `X-ZCode-App-Version` / `X-Platform`

请求体: `{ plan_id }`

## i18n 键(已补齐)

- manualClaimPlan.banner.{aria,bonus,claim,close,tag}
- manualClaimPlan.banner.dismissConfirm.{claim,close,description,title}
- manualClaimPlan.banner.period.{daily,oneTime}
- manualClaimPlan.banner.subtitle.{daily,oneTime}
- manualClaimPlan.banner.unit.tokens
- manualClaimPlan.claim.{share._,startUsingUnavailable,success._,ticket.benefit\*}

## 实现

- services/coding-plan-subscription 或独立 manualClaimPlan 服务: preview/claim
- UI: 可领取横幅(banner)+ 领取确认 + 领取成功分享
