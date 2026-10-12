# 组合晴雨表 · Portfolio Barometer — 周更 Reel 工具包

> 风雨有数，底座常青。每周五收盘后，用四个 ETF 篮子给四个抽屉各打一个「天气」，自动生成竖版看板 + 20 秒动效视频 + 口播文案。
> 篮子只是**示例代理**，可在 n8n 里替换。本栏目不荐股，所有产出都带「教育分享 · 非投资建议」。

## 文件

| 文件 | 作用 |
|---|---|
| `barometer.js` | 天气判定脚本。输入四个篮子的日收盘价 → 输出四个天气。可直接粘贴进 n8n Code 节点 |
| `tickers.js` | n8n Code 节点「Tickers」：四个篮子的 8 个 ETF（示例代理，改这里） |
| `assemble.js` | n8n Code 节点「Assemble」：Tiingo 日线 + FRED 10Y → barometer.js 的输入（复权、按日期对齐、股息率、过期检查） |
| `test-assemble.js` | 用 Tiingo 格式的模拟响应测试组装 → 判定：`node test-assemble.js` |
| `test.js` | 用模拟数据测试判定逻辑 + 阈值边界单测：`node test.js` |
| `barometer-card.html` | 1080×1920 看板模板（品牌色、自绘天气 SVG、动效）。浏览器直接打开 = 用示例数据实时预览 |
| `render.py` | 渲染器：JSON → PNG（封面/单图）+ MP4（20 秒、30fps，逐帧确定性渲染） |
| `claude-prompt.md` | 让 Claude 生成「组合观察」+ 5 段口播 + IG 文案的 system 提示词和请求体 |
| `guard.js` | 文案守门（n8n Code 节点）：禁用词、字数、免责声明、数字是否出自数据。不通过就停，不自动发布 |
| `test-guard.js` | 守门测试：`node test-guard.js` |
| `voiceover.md` | 20 秒口播结构 + 第 01 期示例稿 |
| `.github/workflows/barometer-reel.yml` | 在 GitHub Actions 上渲染 PNG + MP4（n8n Cloud 跑不了浏览器和 ffmpeg） |
| `sample-input.json` / `sample-output.json` | 示例输入 / 输出（模拟数据，非真实行情） |

## 判定规则（一把统一刻度）

```
z = (本周收益 − 过去 52 周的周收益均值) / 周收益标准差     （每个篮子用自己的波动标准化）
晴  z > 1      多云 0 < z ≤ 1      阴 −1 < z ≤ 0      雨 −2 < z ≤ −1
雷暴 z ≤ −2，或本周日波动 > 2× 常态日波动
```

- 篮子 = 等权，日收益从最新一天往回对齐。
- 每个标的至少需要约 2 个月日线，否则显示「数据不足」。建议传 **≥ 266 个交易日**（52 周 + 本周）。
- 收益底座可额外传 `dividend_yield` 和 `treasury_10y`（%），输出 `yield_spread`（百分点）。

## 数据源

- **ETF 日线：Tiingo 免费版**（每小时 50 次 / 每天 1,000 次 / 每月 500 个代码）。每周只用 8 次请求。
  取 `adjClose`（复权价）算收益，`divCash` + `close` 算收益底座股息率。
- **10 年期国债：FRED `DGS10`**（免费注册 API key）。
- ⚠️ Tiingo 免费版条款为「个人内部使用、不得向他人展示数据」。**发布真实数据前**先向 Tiingo 书面确认可以展示由其日线计算的周收益，或改用允许展示的方案。

## n8n 流程（每周六 09:00 北京时间）

工作流 **Settings → Timezone 设为 Asia/Shanghai**；**Settings → Error Workflow** 指向一个「Error Trigger → 发邮件给自己」的小工作流。

| # | 节点（名字要一致） | 类型 | 配置 |
|---|---|---|---|
| 1 | Schedule | Schedule Trigger | Cron：`0 9 * * 6`（美东周五 20:00/21:00 之后，Tiingo 收盘修正已结束） |
| 2 | FRED DGS10 | HTTP Request | GET `https://api.stlouisfed.org/fred/series/observations`；Query：`series_id=DGS10`、`file_type=json`、`sort_order=desc`、`limit=10`；认证：Generic → Query Auth（name `api_key`） |
| 3 | Tickers | Code | 粘贴 `tickers.js` |
| 4 | Tiingo | HTTP Request | GET `https://api.tiingo.com/tiingo/daily/{{ $json.ticker }}/prices`；Query：`startDate={{ $json.startDate }}`；认证：Generic → Header Auth（Name `Authorization`，Value `Token 你的key`）；**Options → Response → Response Format: Text，Put Output in Field: `data`**（保证每个 ETF 一个 item）；Options → Batching：每批 1 个、间隔 1500 ms |
| 5 | Assemble | Code | 粘贴 `assemble.js`（第 01 期日期在顶部 `FIRST_WEEK_ENDING`） |
| 6 | Barometer | Code | 粘贴 `barometer.js` |
| 7 | Claude | HTTP Request | 见 `claude-prompt.md` |
| 8 | Guard | Code | 粘贴 `guard.js` |
| 9 | Dispatch | HTTP Request | 触发 GitHub Actions 渲染（见下） |

**会自动停下并通知你的情况**（Assemble / Guard 抛错 → Error Workflow）：Tiingo 返回错误或空数据；8 个 ETF 的共同交易日少于 266 天；最新数据距运行时刻超过 4 天；文案未通过守门。
节假日短周（如 Good Friday）不会停：仍按「最近 5 个交易日」计算，`data_check.short_week = true`，可在文案里注明。

**第一次接通时**：先只跑到第 6 步，看 Assemble 输出的 `data_check`（`common_days` 应 ≈ 290，`dropped_days` 应很少）和 Barometer 的四个天气是否合理，再接后面三步。

**触发渲染的请求（第 9 步）**

```
POST https://api.github.com/repos/<你的账号>/<仓库>/dispatches
Authorization: Bearer <GitHub token，放 n8n 凭据>      ← fine-grained token，只给这个仓库 Contents: read & write
Accept: application/vnd.github+json

{ "event_type": "barometer",
  "client_payload": { "barometer": {{ JSON.stringify($json.barometer) }}, "observation": {{ JSON.stringify($json.observation) }} } }
```

GitHub 对 `client_payload` 的顶层键数量有上限（10 个），这里只用 2 个。

## 部署到仓库

1. 把整个文件夹放进网站仓库的 `tools/barometer/`，把 `.github/workflows/barometer-reel.yml` 放到仓库根目录的 `.github/workflows/`。
2. 在 GitHub → Actions → barometer-reel → **Run workflow**，用示例数据跑一次，下载产物确认。
3. 在 n8n 的 Credentials 里建 Tiingo、FRED、Anthropic、GitHub 四个凭据——密钥全部只放 n8n，不进仓库、不写进 Code 节点。

## 本地渲染（Mac mini 也可以）

```bash
pip install playwright && python -m playwright install chromium   # 另需 ffmpeg：brew install ffmpeg
python3 render.py --data sample-output.json \
  --obs "进攻抽屉遇雷暴，长寿抽屉却放晴——这正是把四个抽屉分开放的意义：风雨只打湿其中一格。" \
  --disc "教育分享 · 非投资建议 · 示例数据" --out out
# 只要 PNG：加 --no-video
```

一次渲染约 1 分钟（600 帧逐帧截图）。视频是**确定性**的：每一帧都是 `renderAt(t)` 算出来的，第 9.0 秒一定高亮最差一格，口播可以放心按秒对齐。

## 动效时间线（口播按这个对）

| 时间 | 画面 |
|---|---|
| 0 – 1.5s | 品牌 / 标题 / 期号 |
| 1.6 / 2.7 / 3.8 / 4.9s | 四张卡片依次入场（图标弹出 + 数字滚动） |
| 6.4s | 组合观察出现 |
| 9.0s | 高亮 z 最低的一格 |
| 12.5s | 高亮 z 最高的一格 |
| 16.0s | 全部恢复，停留到 20s |

## 红线

- 只用数据说话：文案中的百分比必须出自本周 JSON（guard.js 自动核对）。
- 不预测、不建议、不点名个股；禁用词清单在 claude-prompt.md 和 guard.js 里，两边同步改。
- 示例数据必须标「示例数据」；正式期数用真实行情后去掉。
- 不公开个人持仓：篮子是公开 ETF 代理，不是你的仓位。
