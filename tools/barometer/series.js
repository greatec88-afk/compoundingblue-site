/**
 * 组合晴雨表 · n8n Code 节点「Series」（Run Once for All Items）
 * 输出 3 个 item，每个 = 一个 FRED 序列；下游「FRED」HTTP 节点每个 item 请求一次。
 * 只用标注为 Public Domain 的政府序列；通胀预期在 assemble.js 里自己算（DGS10 − DFII10）。
 */
const SERIES = ['DFII10', 'DGS10', 'IC4WSA'];
const LOOKBACK_CALENDAR_DAYS = 460;   // ≈ 65 周，够 52 周历史 + 本周 + 余量

const start = new Date(Date.now() - LOOKBACK_CALENDAR_DAYS * 864e5).toISOString().slice(0, 10);
return SERIES.map(series_id => ({ json: { series_id, observation_start: start } }));
