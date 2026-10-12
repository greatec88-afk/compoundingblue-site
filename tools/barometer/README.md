# 组合晴雨表 · Portfolio Barometer — 周更 Reel 工具包

> 风雨有数，底座常青。每周五收盘后，用四个 ETF 篮子给四个抽屉各打一个「天气」，自动生成竖版看板 + 20 秒动效视频 + 口播文案。
> 篮子只是**示例代理**，可在 n8n 里替换。本栏目不荐股，所有产出都带「教育分享 · 非投资建议」。

## 文件

| 文件 | 作用 |
|---|---|
| `barometer.js` | 天气判定脚本。输入四个篮子的日收盘价 → 输出四个天气。可直接粘贴进 n8n Code 节点 |
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

## n8n 流程（每周五美东收盘后）

```
Cron（周五 17:30 ET）
 → HTTP Request × 8：拉 8 个 ETF 的日收盘价（任一行情 API，按你选的服务调整）
 → Code「组装」：拼成 barometer.js 需要的输入 JSON（格式见 barometer.js 顶部注释）
 → Code「barometer.js」：输出四个天气
 → HTTP Request「Claude」：claude-prompt.md
 → Code「guard.js」：不通过 → Error 分支发邮件给你
 → HTTP Request「GitHub repository_dispatch」：触发渲染
 → （人工）下载 Actions 产物 → 剪映配音 → 发布
```

**触发渲染的请求**

```
POST https://api.github.com/repos/<你的账号>/<仓库>/dispatches
Authorization: Bearer {{$env.GITHUB_TOKEN}}       ← fine-grained token，只给这个仓库 Contents: read & write
Accept: application/vnd.github+json

{ "event_type": "barometer",
  "client_payload": { "barometer": <barometer.js 输出>, "observation": "<guard 通过后的 observation>" } }
```

GitHub 对 `client_payload` 的顶层键数量有上限（10 个），上面只用了 2 个，够用。

## 部署到仓库

1. 把整个文件夹放进网站仓库的 `tools/barometer/`，把 `.github/workflows/barometer-reel.yml` 放到仓库根目录的 `.github/workflows/`。
2. 在 GitHub → Actions → barometer-reel → **Run workflow**，用示例数据跑一次，下载产物确认。
3. 在 n8n 建 GitHub token 凭据（环境变量），密钥不进仓库。

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
