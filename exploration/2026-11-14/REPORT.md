# 智联招聘实测记录（探路，2026-11-14）

> 目的：在写 PRD / 接口草案之前，用 cloakbrowser 真实走一遍智联招聘的登录与只读链路，记录页面浏览顺序、全部 document/XHR/fetch 请求、关键响应字段与数据模型，并探索「自动登录/会话续期」机制。
>
> 状态：**进行中**（匿名链路已完成；登录 + 会话续期部分待人工扫码后补全）
>
> 环境：`~/cloak-env`（cloakbrowser 0.6.5 + Chromium 146 + playwright-core 1.65.0），headful，独立 profile `~/.zhilian-client/profile`；运行脚本 `exploration/2026-11-14/controller.mjs`（`~/cloak-env/bin/cloak-run node ...`）。

---

## 1. 产物体量（截至匿名探路完成）

| 产物 | 路径 | 说明 |
| --- | --- | --- |
| 请求/响应事件 | `artifacts/network.jsonl` | 200+ 行；document/xhr/fetch 的 request/response |
| 页面导航顺序 | `artifacts/navigations.jsonl` | framenavigated / load / domcontentloaded |
| 响应体归档 | `artifacts/responses.jsonl` + `artifacts/bodies/` | 200 个左右响应体（JSON/HTML） |
| 页面快照 | `artifacts/states/*.json|.html` | URL/标题/正文/输入框/链接/`__INITIAL_STATE__` |
| 截图 | `artifacts/screenshots/` | 关键态截图 |
| cookie 摘要 | `artifacts/states/*.cookies.json` | 仅 name/domain/expires，不含 value |
| 城市注册表 | `artifacts/city-registry.json` | 34 省级 + 457 城市 + 2870 区县（从 SSR `baseData.allCity` 提取） |

> `artifacts/` 含登录态/设备指纹等敏感数据，权限 0600/0700，**不入库、不贴聊天**。

---

## 2. 登录链路

### 2.1 登录页与登录方式

- 登录页：`https://passport.zhaopin.com/login`（会 302 到 `/login`）。
- 页面由 knockout + `additional.web.<hash>.js` + 登录 widget（`/widgets/zp-passport-cust-v2` → `fecdn4.zhaopin.cn/.../zp-passport-cust-v2.web.<hash>.js`）渲染。
- 服务端配置 `GET /common/getFrontInitConfig.json?containerName=zp-passport-cust&appID=<appID>&redirectURL=<...>` 返回登录面板定义：

  | 项 | 实测值 |
  | --- | --- |
  | 默认面板 | `login-normal`（正常面板，含 tabs/第三方入口） |
  | 已加载插件 | `login-password, login-sms, register-sms, register-sms-1, wechat-qrcode` |
  | 第三方登录 | `login-zlapp, login-qq, login-weibo`（`thirdPartyLoginPluginsArray`） |
  | 扫码面板 | `qrcodePluginsArray` 默认 `wechat-qrcode, zlapp-qrcode`（微信扫码 / 智联APP扫码） |
  | 免验证 | `verificationFlag=false`；短信发送前仍可能有阿里 NC/极验 |

- 实际默认渲染：`register-sms-1` 面板（手机号 + 短信验证码 + 「登录/注册」按钮）；顶部有二维码切换按钮 `.zppp-panel-normal-bar__img`（tooltip「微信扫码快捷登录」）。

### 2.2 智联APP扫码登录（实测可用，推荐自动化）

请求序列（全部为 GET）：

```text
GET https://passport.zhaopin.com/v4/appScan/init?scene=10000060
  → {"code":100000,"data":{"path":"/v4/appScan/img/<validateId>","validateId":"<id>"},...}

GET https://passport.zhaopin.com/v4/appScan/img/<validateId>
  → 二维码图片（image/jpeg，约 300×300，实测 29KB）

轮询（2s/次，最长 300s）：
GET https://passport.zhaopin.com/v4/appScan/login?validateId=<id>&rememberMe=true
  code=102004 → 二维码未验证（待扫）
  code=102001 → 已扫码，等待手机端确认（「请在手机上点击登录」）
  code=102002/102003 → 二维码失效/失败
  code=100000 → 登录成功（data 含用户信息）
```

- 关键参数 `rememberMe=true`（widget 内固定传 true）：与「自动登录/会话续期」相关，登录后重点验证。
- 二维码有效期约 5 分钟（widget 内 `startTime` 300000ms 超时逻辑）。
- **登录成功后的 cookie/token 与续期机制：待扫码后补全（PENDING）**。

### 2.3 短信验证码登录（接口常量已确认，待实测）

| 步骤 | 端点（passport.zhaopin.com） | 说明 |
| --- | --- | --- |
| 发码初始化 | `GET/POST /v4/sms/init` | 手机号 + 场景；可能先要求人机验证 |
| 人机验证 | `/v4/geetest/init`（极验 v4）或阿里 NC（`g.alicdn.com/sd/ncpc/nc.js`） | 发码前触发 |
| 提交验证码 | `/v4/sms/login`（仅登录）或 `/v4/sms/loginAndRegister`（登录/注册合一） | 6 位短信码 |
| 重发 | `/v4/sms/resend*`、`/v4/account/resendValidateV2` | 频控 |
| 验证 | `/v4/account/validateV2`、`/passportService/verify/init` | 二次校验/实名 |

> 具体请求体字段需登录实测抓包后补全（PENDING）。

### 2.4 密码 / 第三方登录（接口常量已确认）

- 密码：`/v4/account/login(V2)`；密码经 `/java-p-encryption-server/encryptService/getPrivateKey` + `/common/getEncryptKey` RSA 加密；可能有滑块/极验。
- 微信扫码：`napi/wechat-qrcode` + `napi/wechat-qrcode-login`（`passport.zhaopin.com/napi/...`）。
- 智联APP 快捷登录插件：`login-zlapp`；QQ/微博：`/api/third/login/init` + `/api/third/login`。
- 实名校验：`/api/auth/initQR`、`/api/auth/pollDetection`、`/api/auth/initAuth`、`/api/auth/notice`、`/napi/verifylogin`。

### 2.5 登录态检测（实测）

| 端点 | 未登录响应 | 说明 |
| --- | --- | --- |
| `GET https://fe-api.zhaopin.com/c/i/checkToken?platform=13&version=0.0.0` | `{"code":200,"data":false}` | **推荐**：轻量、同源可调，`data===true` 即已登录 |
| `GET https://fe-api.zhaopin.com/c/i/user/detail?detail=true` | `{"code":500,"message":"获取用户信息失败"}` | 登录后返回用户详情 |
| `GET https://passport.zhaopin.com/napi/userinfo` | `{"code":500,...}`（`Cannot read properties of null (reading 'userID')`） | 登录后返回 userinfo |
| `GET https://passport.zhaopin.com/userinfo` | 404 | 不存在 |

---

## 3. 反爬 / 风控体系（实测）

| 层级 | 组件 | 观测 |
| --- | --- | --- |
| CDN 人机验证 | **腾讯云 EdgeOne**（`captcha.eo.gtimg.com/TEOCaptchaWidget.js`、`t.captcha.qq.com/traceguard`） | 首次访问 `/jobdetail/*.htm` 被拦截，页面标题 `Security Verification`，勾选「确认您是真人」后通过；成功后写 cookie `EO-Bot-Captcha-Token`（`.zhaopin.com`，**30 天**：实测 expires=2026-12-14） |
| JS 挑战 | EdgeOne 第一阶段 | 下发 `__tst_status`、`EO_Bot_Ssid`（session 级） |
| 设备指纹 | 数美（Sense） | `POST cgate.zhaopin.com/userpassport/report/reportShuMeiDevice`；`common-bucket.zhaopin.cn/js/sense/sense-v2.js`；cookie `FSSBBIl1UgzbN7NS`（HttpOnly/Secure，约 1 年） |
| 验证码 | 阿里 NC（`nc.js`）、极验 v4（`geetest-0.5.0.js`、`/v4/geetest/init`） | 短信发码/登录阶段可能出现 |
| 埋点 | Sensors（`statistic.zhaopin.cn`）、百度统计、Sentry | 大量后台请求，不影响功能 |
| 设备标识 | `x-zp-client-id`（.zhaopin.com，约 1 年）、`x-zp-device-sn`（1 天） | 每次请求头/参数携带 |

**EdgeOne 挑战实测通过方式**：headful 下点击 iframe（`#tcaptcha_iframe_eo`）内 `#verifyCheckbox`，约 5s 后 token 写入并重载成功。可用 Playwright `frame` 点击自动化，也可由人工/中继完成。

---

## 4. 职位搜索

### 4.1 页面与 URL

- 搜索页：`https://www.zhaopin.com/jobs/?kw=<关键词>&jl=<城市码>&p=<页码>&order=<排序>`
  - `sou.zhaopin.com` 301 → `www.zhaopin.com/sou/` → `www.zhaopin.com/jobs/`
  - `jl` = 城市码（`489`=全国、`530`=北京、`565`=石家庄、`765`=深圳…见 `artifacts/city-registry.json`）
  - `p` = 页码；`order=4` = 「最新」排序；`kw` = 关键词
  - 城市频道路径：`https://www.zhaopin.com/<pinyin>/`（如 `/shijiazhuang/`）
- 页面为 **Vue SSR**：HTML 内嵌 `__INITIAL_STATE__`，包含完整职位列表数据（无需额外列表 API）。

### 4.2 `__INITIAL_STATE__` 关键结构（实测）

```text
__INITIAL_STATE__ = {
  pageMode: "search",
  queryParams: { kw, jl, p, order },
  positionList: [Position × 20],
  selectedJobId, pageIndex, pageSize, hasMore, positionCount,
  jobDetail: { detailedCompany, detailedPosition, taskId, guestJobDescClamp }, // 选中职位详情
  navigationList, baseData, statBaseData, seoPageInfo, user, ...
}
```

`Position`（每个职位）关键字段：

| 字段 | 示例 | 说明 |
| --- | --- | --- |
| `jobId` / `positionId` | `40974823208` | 数字 ID |
| `positionURL` | `https://www.zhaopin.com/jobdetail/CCL1316344860J40974823208.htm` | 职位页/详情号 |
| `positionNumber`（embed 在 jobDetailData） | `CCL1316344860J40974823208` | **positionNumber**，详情 API 用 |
| `name` | `外贸销售` | 职位名 |
| `salaryReal` / `salary60` / `salaryType` | `5001-9000` / `5000-9000元` / `1` | 薪资（匿名也存在于 state，但页面展示为 `**-**元`） |
| `cityId` / `workCity` / `cityDistrict` | `565` / `石家庄` / `裕华` | 地点 |
| `education` / `workingExp` / `workType` | `大专` / `1-3年` / `全职` | 要求 |
| `publishTime` / `firstPublishTime` | `2026-11-14 13:47:27` | 发布时间 |
| `companyNumber` / `companyName` / `companyUrl` | `CZL1316344860` / `河北汇盛工业机械有限公司` / `http://company.zhaopin.com/CZL1316344860.htm` | 公司 |
| `industryName` / `companySize` / `financingStage` | `通用设备制造` / `300-499人` / null | 公司标签 |
| `jobSummary` | 长文本 | 职位摘要 |
| `jobDetailData.position.base/date/desc/workLocation` | — | 由列表直接带出的详情（描述/地址/经纬度） |
| `jobDetailData.staff` | `{"staffName":"苏先生","avatar":...,"hrOnlineState":...}` | 招聘者（匿名有部分） |

匿名限制：**只返回 1 页 20 条**（`hasMore=false`，页面提示「登录查看更多相关职位」）；`p=2` 参数被透传进 `queryParams` 但 `pageIndex` 仍为 1。

### 4.3 数据获取方式

- 职位列表 = SSR 文档（`/jobs/?...` 的 HTML），无独立列表 XHR。
- 页面加载时另有辅助 XHR（`fe-api.zhaopin.com`）：
  - `/c/i/search/base/data`（筛选项/城市/地铁等字典，约 2MB+）
  - `/c/i/city-page/user-city`（IP 城市）
  - `/c/datanormalization/region-relation`（行政区划树，含城市码）
  - `/c/i/common/footer`、`/c/i/jobs/qrcode`、experiment、Sentry 等

---

## 5. 职位详情

### 5.1 页面

- `https://www.zhaopin.com/jobdetail/<positionNumber>.htm`
- 首次访问触发 **EdgeOne 人机验证**（见 §3）；通过后（token 30 天）可正常 SSR 渲染。
- 页面内嵌 `__INITIAL_STATE__`：`jobNumber`、`jobDetail.detailedCompany`、`jobDetail.detailedPosition`、`jobDetail.guestJobDescClamp`、`companyExtDetail.businessInformation`（工商信息）、`jobPublisher`（登录后）、`user`（登录后）等。

### 5.2 独立详情 API（重要，免 EdgeOne）

```text
GET https://fe-api.zhaopin.com/c/i/jobs/position-detailv3?number=<positionNumber>&identity=0&platform=13&version=0.0.0
→ {"code":200,"data":{"detailedCompany":{...},"detailedPosition":{...},"taskId":"..."}}
```

- `detailedPosition`：`positionNumber/positionId/positionName/salary/salaryType/education/positionWorkingExp/description(HTML)/labels/welfareTags/recruitNumber/workAddress?` 等
- `detailedCompany`：`companyNumber/companyName/companySize/companyLogo/industryNameLevel/companyDescription/financingStageName/onlinePositionNumbers/companyUrl` 等
- 该 API 由前端 SPA（公司职位页选中职位时）调用，实测匿名可访问；可作为 `jobs.detail` 主路径（必要时再回退到 `/jobdetail` 页面）。

### 5.3 职位详情页 state 里的工商信息

- `companyExtDetail.businessInformation.businessInformationData`：
  `registeredName / epCertNo(USCC) / legalPerson / registeredCapital / epType / epStatus / createDate / registeredOrg / location / registeredAddress / industry / businessScope / businessPeriod / creditLevel`

---

## 6. 公司详情

- 页面：`https://www.zhaopin.com/companydetail/<companyNumber>.htm`
  - `companyNumber` 形态：`CZL1515276460`、`CZ240033010`、`CC575084428`、`CCL...`、以及 USCC 形态（如 `9113XGQRVDGH8TLDRV`）
- 页面内嵌 `__INITIAL_STATE__`，关键：

| 字段 | 说明 |
| --- | --- |
| `companyDetail.companyBase` | `companyName/companyShotName/companyNumber/companyLogo/companySize/industryName/cityCode/cityName/address/companyDescription/companyWebsiteUrl/coordinate/createTime` 等 |
| `companyDetail.businessInformationData.businessInformationData` | 工商信息（同 §5.3） |
| `onlinePositionsCount` / `onlinePositions` | 在招职位数（公司页仅展示少量 + 全部职位页） |
| `companyDetail.companyImages/companyProducts/companyHonors/companyExecutives/companySalary/companyInterview` | 可选公司内容模块 |

- 公司页实测匿名可访问（EdgeOne token 已存在时）；页面含「在招职位·N / 全部职位·N」链接 → `/companydetail/jobs-<companyNumber>/`。

---

## 7. 公司全部职位

- 页面：`https://www.zhaopin.com/companydetail/jobs-<companyNumber>/`
- 实测：某公司 12 个在招职位，SSR `__INITIAL_STATE__` 内 `onlinePositions: [Position × N]`、`onlinePositionsCount=12`、`serverJobNumber`/`serverJobDetail`（选中职位详情）、`companyConditions`（筛选：城市/职位类别/薪资）、`pageIndex`/`onlinePositionsPage`。
- 每条 `onlinePositions[i]` 与搜索页 `Position` 同构（jobId/positionURL/name/salaryReal/cityId/education/workingExp/companyNumber/...）。
- 分页参数与上限待大公司实测（PENDING）。

---

## 8. 城市与筛选字典

- 城市码来源（二选一/互补）：
  - SSR `baseData.allCity`（省→市→区县树，含 code/name/en_name/parentCode）→ 已提取 `artifacts/city-registry.json`（34 省 / 457 城市 / 2870 区县）
  - `GET https://fe-api.zhaopin.com/c/datanormalization/region-relation?maxLevel=district&...`（含 `amapCode/regionType`）
- 全国站点码 `489`；`LastCity`/`LastCity_id` cookie 记录当前城市。
- 筛选项字典：`GET https://fe-api.zhaopin.com/c/i/search/base/data`（companyType/subway/jobType/industry/salary/experience/education/companySize/financingStage 等；实测响应 >2MB）。
- v1 按用户结论只做「关键词 + 城市 + 分页」；筛选参数名/编码留作 v1.1（PENDING 实测）。

---

## 9. 会话与自动登录（已补测，见 §16）

~~待人工扫码后补全~~（2026-11-14 20:03 已用短信验证码真实登录，详见 §16）：

1. 登录成功写入的 cookie 清单、domain、有效期、HttpOnly/Secure（重点：token cookie、`EO-Bot-Captcha-Token`、设备指纹）
2. `localStorage` / `sessionStorage` 中 token 键值（长度/键名，不记录 value）
3. `rememberMe=true` 的语义（是否 30 天免登录 / 是否续期）
4. 关闭浏览器 + 重启进程后 profile 复用是否免登录
5. 会话有效期与续期请求（网络里出现的刷新/续期 API）
6. 掉线/失效后的状态表现（`checkToken` 返回值变化）

---

## 10. 对设计的初步结论（PRD 输入）

1. **只读**：搜索 → 职位详情 → 公司详情/公司全部职位；无投递/沟通/简历写操作。
2. **数据来源**：SSR HTML + `__INITIAL_STATE__` 解析为主；`position-detailv3` 等 fe-api 为补充；EdgeOne 只影响 `/jobdetail` 页面直访，API 不受影响。
3. **登录**：智联 APP 扫码可全自动中继（init/img/poll 三段）；短信/密码/微信扫码作为备选；`rememberMe` + profile 复用做长期在线。
4. **风控**：EdgeOne token 30 天（可人工/自动点击通过）；数美设备指纹；频率需保守（单并发、页间延迟、单页 20 条上限）。
5. **匿名可用**：搜索/公司页/职位 API 匿名可用，但只有 1 页 20 条、薪资展示屏蔽；登录后解锁分页与招聘者等字段——需在 PRD 中明确「必须登录」与「可匿名降级」两种模式。
6. **缓存**：SSR 解析结果结构化缓存（职位/公司/详情），与 boss-client 同构。

---

## 11. 未决问题

1. 登录后的分页上限（`p=2..N`）、`hasMore` 行为、单账号可翻多少页。
2. 公司职位页的大公司分页（`/companydetail/jobs-<id>/?p=`）与截断规则。
3. 薪资展示规则：登录后是否直接显示真实薪资（state 已有真值）。
4. `jl` 是否支持区县码/地铁码；`order` 的全部取值。
5. 会话续期：`rememberMe` 是否真正延长 token；是否有静默刷新接口。
6. 多账号/多城市默认值；默认城市（建议沿用 boss-client 的「可配置默认城市」）。

---

## 12. 会话相关 cookie（匿名态基线，供登录后对比）

| cookie | domain | 有效期特征 | 说明 |
| --- | --- | --- | --- |
| `x-zp-client-id` | `.zhaopin.com` | ~1 年（实测 2027-12-19） | 设备/客户端 ID，所有请求带 |
| `x-zp-device-sn` | `.zhaopin.com` | **1 天**（实测次日 17:51 到期） | 设备序列号（短周期，页面会续） |
| `FSSBBIl1UgzbN7NS` | `www.zhaopin.com` | ~1 年，HttpOnly+Secure | 数美设备指纹 ID |
| `smidV2` | `www.zhaopin.com` / `m.zhaopin.com` | ~1 年 | 另一设备/统计 ID |
| `EO-Bot-Captcha-Token` | `.zhaopin.com` | **30 天**（实测 2026-12-14） | EdgeOne 人机验证通过凭证 |
| `__tst_status` / `EO_Bot_Ssid` | `www.zhaopin.com` | session 级 | EdgeOne 第一阶段 JS 挑战 |
| `LastCity` / `LastCity%5Fid` | `www.zhaopin.com` | session/短期 | 当前城市（如石家庄 565） |
| `Hm_*` / `HMACCOUNT` / `sajssdk_*` / `sensorsdata*` | `.zhaopin.com` | 各类 | 百度统计 / Sensors 埋点 |
| `ZL_REPORT_GLOBAL` | `.zhaopin.com` | session | 上报标记 |

> 登录成功后新增的 token cookie（名称/有效期/HttpOnly）待补测。

## 13. 请求预算结论（供实现阶段遵循）

| 操作 | 推荐采集方式 | 请求数 |
| --- | --- | --- |
| search.jobs / jobs.list | 页面内 `fetch('/jobs/?kw=&jl=&p=&order=')` 拿 SSR HTML，解析 `__INITIAL_STATE__` | 1/页 |
| jobs.detail | 列表内嵌 `jobDetailData` → `fe-api /c/i/jobs/position-detailv3` → 页面 SSR 回退 | 0–1 |
| companies.list | 本地按 `companyNumber` 聚合，不发请求 | 0 |
| companies.detail | 页面内 `fetch('/companydetail/<cn>.htm')` 解析 SSR | 1 |
| companies.jobs | 页面内 `fetch('/companydetail/jobs-<cn>/')` 解析 SSR | 1 |
| cities.list | 内置注册表；refresh 时拉 base data / region-relation | 0–1 |
| status | `checkToken`（可关）+ 本地 cookie | 0–1 |

> 对比：人工打开一次搜索页会产生几十个请求（含埋点、字体、地图、埋点 sdk）；客户端必须走「文档 fetch + state 解析」路线。

## 14. EdgeOne 细节补充

- 挑战 HTML 特征：`<title>Security Verification</title>`、`TEOCaptchaWidget.js`、`t.captcha.qq.com/traceguard`、正文「正在验证连接安全性，请勾选下方复选框」。
- iframe：`#tcaptcha_iframe_eo`，`src=https://captcha.eo.gtimg.com/static/template/widget_ele_eo.<hash>.html`；复选框 `#verifyCheckbox`（class `checkbox checkbox-verify`）。
- 通过后：脚本写 cookie `EO-Bot-Captcha-Token=<ticket>; path=/; max-age=2592000 (30 天); domain=.zhaopin.com` 并重载页面。
- 通过方式：Playwright 在 iframe 内点击 `#verifyCheckbox`，约 5s 生效（实测）。

## 15. 待登录后补测清单

1. 登录成功写入的 token cookie 清单/有效期/HttpOnly。
2. `checkToken` 登录后的完整返回；`user/detail` 登录后的用户字段。
3. 登录后搜索 `p=2..N` 的行为与上限、`hasMore` 变化。
4. 登录后职位详情 API 的字段差异（招聘者 `staff`、`jobPublisher`、`recommender`）。
5. `rememberMe=true` 是否带来长期免登录/续期；profile 重启复用。
6. 静默刷新/续期接口（网络请求中观察）。
7. 公司全部职位页大公司分页参数与截断规则。


---

## 16. 登录后补测（2026-11-14 20:03–20:12，真实账号）

> 登录方式：短信验证码（手机号已脱敏为 `156****0075`）；`rememberMe=true` 由页面在登录请求中固定携带。
> 说明：本节所有 token 值均不落库、不写入文档；仅记录机制、端点、字段名与 TTL。

### 16.1 短信登录请求链（实测）

```text
1) POST https://passport.zhaopin.com/common/getEncryptKey?time=<ts>
   → data.encryptKey = RSA 公钥（后续 encryptMobile 用）

2) GET https://passport.zhaopin.com/passportService/verify/init?scene=10000020&countryCode=86
      &mobile=<加密后手机号>&encryptMobile=<...>&encryptRequestId=<uuid>&sessionId=&...
   → {"code":100000,"data":{"riskLevel":3,"validateId":"<id>","needVerify":true,
        "sessionId":"<sid>","geetestData":{"success":true,"challenge":"<...>","gt":"<...>"}}}
   （本次 geetestData.success=true，页面自动完成极验，无人工交互）

3) GET https://passport.zhaopin.com/v4/sms/init?scene=10101010&countryCode=86
      &encryptMobile=<...>&encryptRequestId=<uuid>
      &validateId=<verify init 的 validateId>
      &validateData={"type":20,"geetest_challenge":"<...>","geetest_validate":"<...>","geetest_seccode":"<...>|jordan"}
      &sessionId=<sid>&...&appID=<appID>&redirectURL=https://i.zhaopin.com/blank
   → {"code":100000,"data":{"validateId":"<新 id>","isNewUser":false},"message":"操作成功"}

4) 用户收到 6 位短信码后提交（页面自动 POST）：
   POST https://passport.zhaopin.com/v4/sms/loginAndRegister?validateId=<sms/init 的 id>
      &validateData=<6 位短信码>&countryCode=86&encryptMobile=<...>&encryptRequestId=<uuid>
      &rememberMe=true&agreementConsented=true&sessionId=<sid>&verifyType=1&...&redirectURL=https://i.zhaopin.com/blank
   → 302/跳转 i.zhaopin.com/blank → https://www.zhaopin.com/recommend → /jobs/?pageMode=recommend

5) 登录后页面加载：GET /c/i/user/detail、/c/i/checkToken、/c/i/global/config?at=&rt=、
   cgate.zhaopin.com/imapi/imV2/getToken 等
```

- 短信验证码字段名是 `validateData`（不是 `code`）；短信码 6 位。
- `agreementConsented=true` 必须（页面对应勾选「已阅读并同意」）。
- 整体登录耗时约 40s（含发码等待）。

### 16.2 登录态判定（实测）

| 端点 | 未登录 | 已登录 |
| --- | --- | --- |
| `GET https://fe-api.zhaopin.com/c/i/checkToken?platform=13&version=0.0.0` | `{"code":200,"data":false}` | `{"code":200,"data":true}` |
| `GET https://fe-api.zhaopin.com/c/i/user/detail?detail=true` | `{"code":500,"message":"获取用户信息失败"}` | `{"code":200,"apiCode":200,"data":{"Id":<userId>,"Name":"<已脱敏>","userId":<userId>,"currentIdentity":"1","userType":1,"Resume":{"ResumeNumber":"<long>","Id":"<resumeId>"}}}` |
| `GET https://passport.zhaopin.com/napi/userinfo`（从 www 页面发 fetch） | `{"code":500,...}` | **仍为 500**（跨子域/凭证问题），不作为判定依据 |

**结论**：登录态统一用 `checkToken.data===true` 判定；`user/detail` 取 userId/姓名/resumeNumber。

### 16.3 会话 token 机制（核心）

| 项 | 实测 |
| --- | --- |
| `at` cookie | `.zhaopin.com`，path=/，HttpOnly=false，SameSite=Lax；**有效期约 7 天**（实测在校准后的第 7 天 23:59:59 到期，如 `2026-11-21 23:59:59`） |
| `rt` cookie | `.zhaopin.com`，path=/，HttpOnly=false，SameSite=Lax；**有效期约 30 天**（如 `2026-12-14 23:59:59`） |
| 传递方式 | 前端把 `at`/`rt` 作为 **query 参数**（`?at=&rt=`）或 **请求头**（`x-zp-at`、`x-zp-rt`）传给 fe-api；`zp-gated-token` 另有 gated 头 |
| 刷新接口 | `POST https://fe-api.zhaopin.com/c/i/refresh-token`，body `{"rt":"<rt>"}` |
| 刷新响应 | `{"code":200,"message":"刷新token成功","data":{"appID":"<appID>","at":"<at>","atExpire":<秒≈7d>,"rt":"<rt>","rtExpire":<秒≈30d>,"userInfo":{"userId":...,"userStatus":1}}}` |
| 刷新行为 | 在 at 仍有效时调用，返回**同一个 at/rt**（不轮换）并给出剩余有效期；**未观察到 Set-Cookie 自动更新**；推测 at 临近/过期时会签发新 at（需长期观察） |
| 退出接口 | `GET https://fe-api.zhaopin.com/c/i/user/logout?at=&rt=`（前端 logoutCapi） |
| 其他 cookie | `c_user_id`（session）、`x_passport_sid`（passport 域，session）、`zp_passport_deepknow_sessionId`（深察会话，session） |

**续期设计结论**：客户端以 `rt`（30 天）为长期凭证；`status` 定期调 `refresh-token`（或读 at cookie 到期时间），在 at 剩余 < 阈值（如 1h）时刷新并用返回值重写 `at`/`rt` cookie；rt 过期（30 天）→ 置 `needs_human` 要求重新登录。

### 16.4 profile 复用 / 自动登录（实测）

- 关闭浏览器进程 → 重新用同一 profile 启动 → `checkToken` 仍为 `true`，首页显示登录态（消息数、用户名）。
- `at`/`rt` 等持久 cookie 在 profile 中；`x_passport_sid`/`zp_passport_deepknow_sessionId` 等 session 级 cookie 关浏览器后丢失也不影响登录态。
- 结论：**profile 复用即自动登录**；无需重扫。rt 30 天为最长免登录窗口。

### 16.5 登录后能力差异（实测）

| 项 | 匿名 | 登录后 |
| --- | --- | --- |
| 搜索首屏 | 20 条，`hasMore=false`，页面无「更多」 | 20 条，`hasMore=true`，可加载更多 |
| 搜索翻页 | `p=2` 被服务端压回（同第 1 页） | **第 2 页起走 `POST /c/i/search/positions`**（见 16.6） |
| 搜索默认排序 | `queryParams.order=4` | 未显式传 order 时服务端默认 `order=11`（个性化）；显式 `order=4` → 请求体 `order:0` + `sortType:"JOB_PUBLISH_TIME"` |
| 职位详情薪资 | 页面显示 `**-**元`（state 有真值） | 页面正常显示（如 `5000-9000元`） |
| 招聘者 | `staff` 部分字段 | `staff` 更全（`hrOnlineState`、`hrJob`、`activityLevel`、头像等） |
| EdgeOne | 首次访问 `/jobdetail` 触发 | 登录后再次访问 `/jobdetail` **仍可能触发**（实测触发一次），说明 token 之外还有登录态变化/风险重评估；再次点击 `#verifyCheckbox` 通过，token 续期 30 天 |

### 16.6 搜索分页真实机制（重要修正）

- **第 1 页**：SSR 文档 `/jobs/?kw=&jl=&order=&p=1`，解析 `__INITIAL_STATE__.positionList`（20 条）。
- **第 2 页起**：`POST https://fe-api.zhaopin.com/c/i/search/positions?platform=13&version=0.0.0`  
  body 示例（脱敏）：
  ```json
  {
    "S_SOU_FULL_INDEX": "外贸",
    "S_SOU_WORK_CITY": "565",
    "order": 0,
    "actionid": "<uuid，页面生成>",
    "pageSize": 20,
    "pageIndex": 2,
    "cvNumber": "<resumeNumber>",
    "at": "<at>",
    "rt": "<rt>",
    "eventScenario": "pcSearchedSouSearch",
    "anonymous": 0,
    "resumeNumber": "<resumeNumber>",
    "clickFilterBlackCompany": false,
    "platform": 13,
    "version": "0.0.0",
    "sortType": "JOB_PUBLISH_TIME"
  }
  ```
  响应关键字段：`code=200`、`data.list`（20 条 Position）、`data.isEndPage`（0/1）、`data.count`（实测 1000，疑为结果上限）、`data.sortTypes`（`DEFAULT 智能排序` / `HR_ACTIVE_TIME` / `JOB_PUBLISH_TIME`）。
- 触发方式：滚动到列表底部（infinite scroll），不是 URL 参数。
- 匿名模式：SSR `hasMore=false`；匿名下 POST 翻页未验证（预期受限）。

### 16.7 公司全部职位分页（实测）

- 公司职位页 `/companydetail/jobs-<companyNumber>/` 首屏 SSR 只返回 **20 条**（实测某公司 `onlinePositionsCount=21`、`onlinePositions` 20 条）。
- 页面底部有 SEO 分页链接 `?p=2`，但实测 `?p=2`（带/不带尾斜杠）SSR 仍返回第 1 页内容，`onlinePositionsPage` 恒为 1；未观察到加载更多 XHR。
- 结论：公司职位页 **v1 只取首屏 20 条**，超过 20 条时 `truncated=true`；完整分页机制待后续（可能需要 SPA 内交互/其他接口）。

### 16.8 其他登录后实测

- `status` 可用 `checkToken` + `user/detail` 组合，1~2 次轻量请求。
- 搜索页 `__INITIAL_STATE__.user` 携带完整用户对象（姓名、resumeNumber 等）——缓存/日志需脱敏。
- `positionList[i].jobDetailData.staff` 含招聘者姓名/头像/在线态（登录后更全）。
- 公司详情页登录后仍为 SSR，工商信息不变。
- 会话安全：`at`/`rt` 均为非 HttpOnly cookie（前端可读），因此客户端可在页面内读取并用于 API 请求头/参数；写入文档/日志时必须脱敏。


---

## 17. 实现与联调（2026-11-14 20:30–20:55）

> 代码：`src/` 全量实现（对标 boss-client 骨架，智联适配层重写）；build/test/gen 均通过；systemd user 服务已常驻 `127.0.0.1:8791`。

### 17.1 联调结果（真实账号 + 真实上游）

| 操作 | 结果 |
| --- | --- |
| `/v1/health` | 200；轻量快照（不请求上游），~6ms |
| `/v1/status` | 200；`loggedIn=true / mode=logged_in / health=ok`；at≈7d、rt≈30d |
| `POST /v1/search/jobs`（外贸/565/pages=1） | 200；20 jobs / 20 companies / queryId；缓存命中可复现 |
| `POST /v1/search/jobs`（pages=2） | 200；40 jobs / 37 companies；load-more API 生效，`count=1000` |
| `GET /v1/jobs?...&page=2` | 200；20 jobs；`pagesFetched=2` |
| `GET /v1/jobs/<positionNumber>` | 200；`position-detailv3` 直取，描述/薪资/招聘者/公司齐全 |
| `GET /v1/companies/<companyNumber>` | 首次触发 EdgeOne → `verification` 中继（headless 自动点击）→ 重试 200；含工商信息（USCC/法人/注册资本/经营范围） |
| `GET /v1/companies/<companyNumber>/jobs` | 200；`jobCount=21`、20 条、`truncated=true` |
| `GET /v1/cities` | 200；461 个城市（含直辖市 530 北京；565 石家庄默认） |
| `GET /v1/cache/stats` | 200；queries/jobs/companies 等 entries 正常 |
| `/openapi.json` / `/docs` / `/mcp-tools.json` | 16 paths / 73 schemas；HTML 161KB；17 tools |
| MCP stdio | `initialize` / `tools/list`(17) / `tools/call`(`zhilian_status`) 均通过 |

### 17.2 实现期发现的额外事实

1. **EdgeOne 也保护公司页**：`/companydetail/*`、`/companydetail/jobs-*` 的文档 `fetch` 会先返回 JS 挑战脚本（写 `EO_Bot_Ssid` / `__tst_status` 后重载），风控升级时会变成勾选框挑战；客户端策略：真实页面导航执行挑战 → 需要时 `verification` 中继 → 重试。
2. **headless 可过 EdgeOne**：headless 下 `verification.solve {kind:"edgeone",auto:true}` 点击 iframe 内 `#verifyCheckbox` 实测通过，token 续期 30 天。
3. **load-more 请求依赖登录态**：body 需要 `at`/`rt`/`resumeNumber`，登录后翻页正常；匿名模式仍只 1 页 20 条。
4. **公司职位页仍只返回首屏 20 条**：`onlinePositionsCount=21` 而 `onlinePositions=20`；v1 以 `truncated=true` 表达。
5. **搜索 `count=1000`**：load-more 响应中的 `data.count` 为上游结果上限，`pagesAvailable` 由客户端按 count/pageSize 推导（50）。
6. **`/v1/health` 必须轻量**：最初实现里 health 调用了 `status`（两次上游请求）导致 CLI 自动探测超时并误启动本地 App（`ALREADY_RUNNING`）；改为纯本地快照后修复。
7. **CLI 终端二维码**：上游二维码是 JPEG，pngjs 无法解码；CLI 改为保存文件 + 打印路径，REST 仍返回 Base64。
