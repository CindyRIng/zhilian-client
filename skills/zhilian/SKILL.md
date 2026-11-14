# zhilian-client SKILL

## 描述

使用本机 `zhilian-client` 对智联招聘做**只读**职位/公司检索：搜职位关键词 → 找到在招公司 → 看公司详情（含工商信息）/职位详情 → 汇总线索。适合外贸/销售/招聘研究等场景。

## 何时使用

- 需要按「外贸 / 国际贸易 / 海外销售 / 单证 / 跟单」等关键词找正在招聘的公司。
- 需要公司工商信息（USCC/法人/注册资本/经营范围）和公司在招职位。
- 需要结构化 JSON 给下游 CRM/表格/agent 继续处理。

## MCP 代理

MCP 客户端请配置 `ZHILIAN_CLIENT_URL=http://127.0.0.1:8791` 和 `ZHILIAN_API_TOKEN`；`zhilian mcp` 会代理到常驻服务，不自己开浏览器。不要用 `--local` 与常驻服务抢 profile。

## 前置

- 本机已安装并构建 `zhilian-client`，`zhilian` 命令可用（或使用 MCP 工具）。
- 已登录（`zhilian status` 显示 `loggedIn=true`）；未登录时先 `zhilian login`（智联招聘 APP 扫码）。
- 只读：不要调用投递/沟通/简历接口；本客户端不提供这些接口。
- 如果遇到 EdgeOne 人机验证（返回 `HUMAN_VERIFICATION_REQUIRED`）：先 `zhilian verify status` 查看挑战，再 `zhilian verify solve --kind edgeone --auto`（或人工/REST 中继提交坐标）。

## 推荐流程

```bash
# 1) 体检
zhilian status

# 2) 搜职位（城市码可用 zhilian cities list 查；565=石家庄，489=全国）
zhilian search jobs --keyword 外贸 --city 565 --pages 1
# 输出 data.query.queryId、data.jobs、data.companies

# 3) （可选）翻页后重新聚合公司
zhilian jobs list --query-id <queryId> --page 2
zhilian companies list --query-id <queryId> --fetch-pages 1

# 4) 看公司（含工商）
zhilian companies detail --number '<companyNumber>'

# 5) 看公司全部在招职位
zhilian companies jobs --number '<companyNumber>'

# 6) 看职位详情
zhilian jobs detail --number '<positionNumber>'
```

## MCP 工具

`zhilian_health`、`zhilian_status`、`zhilian_login_start/status/sms_verify/cancel`、`zhilian_verification_get/solve`、`zhilian_search_jobs`、`zhilian_list_jobs`、`zhilian_job_detail`、`zhilian_list_companies`、`zhilian_company_detail`、`zhilian_company_jobs`、`zhilian_cities`、`zhilian_cache_stats`、`zhilian_cache_clear`。

参数与 CLI 同名；返回值是统一 envelope（`ok/data/meta/error`）。

## 输出组织建议

对每家公司汇总：

```json
{
  "companyNumber": "...",
  "name": "...",
  "industry": "...",
  "size": "...",
  "financingStage": "...",
  "city": "...",
  "jobCount": 2,
  "matchedJobs": [{"title": "...", "salaryText": "...", "url": "..."}],
  "business": {"uscc": "...", "legalPerson": "...", "registeredCapital": "..."}
}
```

## 约束

- 单次搜索 ≤5 页；不要并发；页间已由服务端延迟。
- 同一条件 2h 缓存；需要最新数据用 `--refresh` / `refresh=true`。
- 匿名模式只能搜 1 页 20 条（`meta.mode=anonymous`，`warnings` 含 `anonymous_limited`）；需要翻页请先登录。
- 遇 `UPSTREAM_BLOCKED` 停止并等 `status.risk.cooldownUntil`；不要重试轰炸。
- 遇 `AUTH_REQUIRED` / `SESSION_EXPIRED`：提示用户 `zhilian login`，不要尝试自动破解验证码。
- 遇 `HUMAN_VERIFICATION_REQUIRED`：走 `zhilian verify` 中继（EdgeOne/极验）。
- 只在本人/授权账号上使用；遵守智联招聘服务条款。

## 错误处理

| 错误 | 建议 |
| --- | --- |
| `AUTH_REQUIRED` / `SESSION_EXPIRED` | 人工重新登录 |
| `LOGIN_REQUIRED` / `ANONYMOUS_LIMITED` | 登录后重试（匿名模式无法翻页/超过 20 条） |
| `HUMAN_VERIFICATION_REQUIRED` | `zhilian verify status` → `zhilian verify solve`（EdgeOne/极验） |
| `SMS_CODE_INVALID` | 重新输入短信码 |
| `UPSTREAM_BLOCKED` | 冷却后重试；降低频率 |
| `RATE_LIMITED` | 按 `retryAfterMs` 退避 |
| `QUERY_EXPIRED` | 重新 `search jobs` |
| `NOT_FOUND` | 公司/职位可能下架，重新搜索 |
