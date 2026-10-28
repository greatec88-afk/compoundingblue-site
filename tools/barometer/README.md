# 组合晴雨表 · Portfolio Barometer — 周更 Reel 工具包 v5（气候因子版 · 配音驱动 · 本周看点 · 同步字幕）

> 风雨有数，底座常青。每周给四个抽屉各看一个「气候因子」，按它本周的变化打天气，自动生成竖版看板 + 20 秒动效视频 + 口播文案。
> **零付费数据源**：只用美国政府公共领域数据（美联储 H.15、美国劳工部），经免费的 FRED® API 获取。不涉及任何股票或基金价格，不荐股。

## 四个抽屉 × 气候因子

| 抽屉 | 气候因子 | FRED 序列 | 逻辑 |
|---|---|---|---|
| 进攻引擎 | 实际利率 | `DFII10`（美联储 H.15，Public Domain） | 成长股估值的折现率，上升 = 逆风 |
| 战略基石 | 初请失业金 4 周均值 | `IC4WSA`（劳工部，Public Domain） | 经济底盘，上升 = 逆风 |
| 长寿主题 | 通胀预期 | `DGS10 − DFII10`（自己算） | 长周期资产最怕通胀侵蚀，上升 = 逆风 |
| 收益底座 | 10 年期国债 | `DGS10`（美联储 H.15，Public Domain） | 股息最直接的竞争对手，上升 = 逆风 |

恒等式：**10 年期国债 = 实际利率 + 通胀预期**——收益底座的天气是进攻、长寿两格因子的合力，是每期「组合观察」的天然素材。

## 判定规则（一把统一刻度）

```
z = (本周变化 − 过去 52 周「周变化」均值) / 周变化标准差     （利率用 bp，初请用人数）
顺风分 s = −z（四个因子都是上升 = 逆风）
晴 s > 1   多云 0 < s ≤ 1   阴 −1 < s ≤ 0   雨 −2 < s ≤ −1
雷暴 s ≤ −2，或「逆风 + 本周日变化波动 > 2× 常态」（仅日度利率）
顺风但波动 > 2× 常态：天气照常按 s 判定，卡片标「波动大」（避免出现「利率下行、绿色数字、却是雷暴」的矛盾）
```

- 日度利率按「周五所在周」取每周最后一个观测，节假日自动跳过。
- 初请是周报，比利率晚约一周；卡片上会标出它的截至日（如「10/10」）。
- 卡片右侧显示本周变化（基点 / 万人）和强度标签（罕见 / 明显 / 小幅 + 上行 / 下行），不再显示 z 值。
- `barometer.js` 输出 `story`（钩子、最逆风、最顺风、十年期拆解）和 `watch`（本周看点）——文案模型只负责把它说成人话。
- 口播 6 段：钩子 + 四个抽屉各一段（不漏格）+ 本周看点，详见 `voiceover.md`。

## 文件

| 文件 | 作用 |
|---|---|
| `series.js` | n8n Code 节点「Series」：要拉的 3 个 FRED 序列 |
| `assemble.js` | n8n Code 节点「Assemble」：定截至日、自算通胀预期、过期 / 历史不足检查、挑出本周看点（议息日 + FRED 发布日历） |
| `barometer.js` | n8n Code 节点「Barometer」：周变化 → z → 天气，并生成卡片显示用的数字 |
| `guard.js` | n8n Code 节点「Guard」：禁用词、字数、免责声明、数字核对（%、bp、万、几个标准差）；Claude / Gemini 响应格式都认 |
| `claude-prompt.md` | 文案提示词（Gemini 与 Claude 两种请求体） |
| `barometer-card.html` | 1080×1920 看板模板。浏览器直接打开 = 用示例数据实时预览 |
| `render.py` | 渲染器：JSON → PNG + MP4（逐帧确定性渲染）；`--audio` 时画面跟着配音走并合入音频 |
| `.github/workflows/barometer-reel.yml` | GitHub Actions 渲染（n8n Dispatch 触发） |
| `voiceover.md` | 20 秒口播结构 + 示例稿 |
| `test.js` / `test-guard.js` | 测试：`node test.js && node test-guard.js`（模拟数据，非真实数据） |
| `sample-input.json` / `sample-output.json` | 示例输入 / 输出（模拟数据） |

## n8n 流程（每周二 09:00 北京时间）

为什么是周二：H.15 日度利率在**下一个工作日**才发布，周五的利率要到美东周一下午才有。周二 09:00（北京）运行时，上周五的数据一定已经发布。

工作流 **Settings → Timezone = Asia/Shanghai**；**Settings → Error Workflow** 指向「Error Trigger → 发邮件给自己」。

| # | 节点（名字要一致） | 类型 | 配置 |
|---|---|---|---|
| 1 | Schedule | Schedule Trigger | Weeks → 每 1 周 → Tuesday → 9am |
| 1b | FRED Calendar | HTTP Request | GET `https://api.stlouisfed.org/fred/releases/dates`；Query：`realtime_start={{ $now.toFormat('yyyy-MM-dd') }}`、`realtime_end={{ $now.plus({days: 7}).toFormat('yyyy-MM-dd') }}`、`include_release_dates_with_no_data=true`、`sort_order=asc`、`file_type=json`；认证同 FRED。**可选**：不接也能跑，只是本周看点只剩议息日和初请兜底 |
| 2 | Series | Code | 粘贴 `series.js` |
| 3 | FRED | HTTP Request | GET `https://api.stlouisfed.org/fred/series/observations`；Query：`series_id={{ $json.series_id }}`、`observation_start={{ $json.observation_start }}`、`file_type=json`；认证：Generic → Query Auth（name `api_key`）；Options → Batching：每批 1 个、间隔 500 ms |
| 4 | Assemble | Code | 粘贴 `assemble.js`（第 01 期日期在顶部 `FIRST_WEEK_ENDING`） |
| 5 | Barometer | Code | 粘贴 `barometer.js` |
| 6 | 文案模型 | HTTP Request | 见 `claude-prompt.md` |
| 7 | Guard | Code | 粘贴 `guard.js` |
| 8 | Dispatch | HTTP Request | 触发 GitHub Actions 渲染（见下） |

> 连线顺序：Schedule → FRED Calendar → Series → FRED → Assemble → Barometer → 文案模型 → Guard → Dispatch。
> 第一次接上 FRED Calendar 后，看一眼 Assemble 输出的 `calendar` 是否列出了本周的 CPI / 非农等发布；FRED 发布名称若有变化，改 `assemble.js` 顶部的 `EVENTS`。

**会自动停下并通知你的情况**：FRED 返回错误或空数据；任一利率最新数据不在截至周内（H.15 没更新）；初请数据滞后超过 13 天；历史不足；文案未通过守门。
节假日短周（如 Good Friday）不会停：周变化仍按「本周最后一个观测 − 上周最后一个观测」计算，`data_check.short_week = true`。

**触发渲染（第 8 步）**

```
POST https://api.github.com/repos/<你的账号>/<仓库>/dispatches
Authorization: Bearer <GitHub token，放 n8n 凭据>      ← fine-grained token，只给这个仓库 Contents: read & write
Accept: application/vnd.github+json

{ "event_type": "barometer",
  "client_payload": { "barometer": {{ JSON.stringify($json.barometer) }},
                      "observation": {{ JSON.stringify($json.observation) }},
                      "voiceover": {{ JSON.stringify($json.voiceover) }},          ← 同步字幕
                      "audio_url": "<配音文件下载地址，可选>" } }
```

## 数据授权与署名（必须做）

- `DFII10`、`DGS10`（美联储理事会 H.15）、`IC4WSA`（美国劳工部）在 FRED 上标注为 **Public Domain: Citation Requested**：可以公开使用，需注明出处。
- 卡片底部已写「数据：美联储 H.15 · 美国劳工部（经 FRED®）」；IG 文案倒数第二行同样写出处（提示词已要求）。
- **FRED API 条款要求**在使用它的产品中醒目放置以下声明——放进网站页脚和 YouTube 视频说明：
  `This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.`
- **不要**换用 FRED 上标「Copyrighted」的序列（如 `T10YIE`、`STLFSI4`）或第三方指数（标普、纳指、VIX、ICE 利差）。需要衍生指标时，用公共领域序列自己算。
- 不得暗示美联储背书；不在域名里用「FRED」「Federal Reserve」。

## 本地渲染

```bash
pip install playwright && python -m playwright install chromium   # 另需 ffmpeg
python3 render.py --data sample-output.json \
  --obs "实际利率升、通胀预期降，叠加成十年期 +10bp——收益底座的天气，是另外两格的合力。" \
  --disc "教育分享 · 非投资建议 · 示例数据" --out out          # 只要 PNG：加 --no-video
```

## 动效时间线：画面跟着配音走

配音分 6 段，段间留 0.5–0.8 秒停顿（TTS 分段合成后拼接即可）。`render.py --audio voice.wav` 会自动测出 6 段起点：

| 配音 | 画面 |
|---|---|
| ① 钩子（0s） | 标题、期号，四张卡片依次入场，随后出现组合观察 |
| ② 进攻引擎 | 高亮进攻引擎 |
| ③ 战略基石 | 高亮战略基石 |
| ④ 长寿主题 | 高亮长寿主题 |
| ⑤ 收益底座 | 高亮收益底座 |
| ⑥ 本周看点 | 全部恢复；底部从「组合观察」切换到「本周看点」，停留到配音结束后 1.2 秒 |

- 自动检测不准时可手动指定：`--cues 0,3,7,11,15,19.5`。
- GitHub Actions：在 Dispatch 的 `client_payload` 里加 `"audio_url": "<配音文件下载地址>"`，出带声音、已对齐的成片；不传则出 25 秒无声版（默认节奏 0 / 3 / 7 / 11 / 15 / 19.5 秒），可在剪映里按这个节奏配音。
- 静态 PNG（封面 / 单图）显示组合观察，并在下方加一行「本周看点」。

## 字幕与音频

- **同步字幕**：`client_payload` 带上 `voiceover` 后，底部框在 ①~⑤ 段逐句显示口播（标签随抽屉变色），⑥ 段切到本周看点——静音刷 Reels 的观众也能看懂。没有 `voiceover` 时底部框显示组合观察。
- **段间停顿 0.5–0.8 秒**：停顿过长（比如 1.5 秒）会让 6 段累计出现 7 秒以上的空白，成片拖沓。
- **响度**：渲染时自动对人声轻压缩并标准化到约 −14 LUFS（社媒常用目标），不用再手动调音量。
- **背景音乐（可选）**：仓库 `tools/barometer/` 下放一首 `bgm.mp3`（自己有授权的音乐），Actions 会自动垫在人声下方约 −20 dB，结尾淡出。
- **开场**：标题和期号第 0 帧就完整显示，第一帧即可作封面，不再从黑屏淡入。

## 红线

- 只用数据说话：文案里的 %、基点、万人、「罕见」都必须与本周 JSON 相符（guard.js 自动核对）；口播不写 bp、z、标准差。
- 只描述环境：不预测、不建议、不预测央行动作、不点名任何股票或基金。
- 示例数据必须标「示例数据」；正式期数去掉。
