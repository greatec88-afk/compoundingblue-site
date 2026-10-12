/**
 * 组合晴雨表 · n8n Code 节点「Tickers」（Run Once for All Items）
 * 输出 8 个 item，每个 = 一个 ETF；下游「Tiingo」HTTP 节点每个 item 请求一次。
 * 篮子是示例代理，改这里即可，assemble.js 会自动跟着变。
 */
const BASKETS = {
  attack:    { name: '进攻引擎', tickers: ['SMH', 'QQQ'] },
  core:      { name: '战略基石', tickers: ['QUAL', 'MOAT'] },
  longevity: { name: '长寿主题', tickers: ['XLV', 'GRID'] },
  income:    { name: '收益底座', tickers: ['SCHD', 'VYM'] },
};
const LOOKBACK_CALENDAR_DAYS = 420;     // ≈ 290 个交易日，够 52 周 + 本周 + 余量

const d = new Date(Date.now() - LOOKBACK_CALENDAR_DAYS * 864e5);
const startDate = d.toISOString().slice(0, 10);

return Object.entries(BASKETS).flatMap(([pillar, b]) =>
  b.tickers.map(ticker => ({ json: { ticker, pillar, pillar_name: b.name, startDate } })));
