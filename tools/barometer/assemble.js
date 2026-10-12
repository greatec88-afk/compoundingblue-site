/**
 * 组合晴雨表 · n8n Code 节点「Assemble」（Run Once for All Items）
 * ------------------------------------------------------------
 * 把 8 个 Tiingo 日线响应 + FRED DGS10 组装成 barometer.js 的输入 JSON。
 *
 *   1. 用 adjClose（复权价）——避免 SCHD/VYM 除息日出现约 1% 的假下跌
 *   2. 按日期取 8 个标的的交集再对齐——任一标的缺一天也不会错位
 *   3. 收益底座股息率 = 最近 4 次 divCash 之和 ÷ 最新原始收盘价（两只等权平均）
 *   4. 10 年期国债 = 最新交易日当天或之前最近一个有效 DGS10
 *   5. 过期 / 历史不足 → 直接抛错，n8n 走 Error 分支通知你，不渲染不发布
 *
 * 上游节点名（改名的话同步改这里）：
 */
const NODE_TICKERS = 'Tickers';
const NODE_FRED    = 'FRED DGS10';
const FIRST_WEEK_ENDING = '2026-10-16';   // 第 01 期的截至日；之后每周 +1
const MIN_COMMON_DAYS   = 266;            // 52 周 × 5 + 本周 5 + 1
const MAX_STALE_DAYS    = 4;              // 最新 K 线距运行时刻超过 4 天 = 数据没更新
const DIVS_PER_YEAR     = 4;              // SCHD / VYM 均为季度分红

function assemble({ tiingo, tickers, fred, now = new Date() }) {
  // ---- 1. 每个标的：date → {adj, close, div} ----
  const series = {};
  tiingo.forEach((bars, i) => {
    const t = tickers[i];
    if (bars && bars.detail) throw new Error(`Tiingo 错误（${t.ticker}）：${bars.detail}`);
    if (!Array.isArray(bars) || !bars.length) throw new Error(`Tiingo 返回空数据：${t.ticker}`);
    const m = new Map();
    bars.forEach(b => m.set(String(b.date).slice(0, 10),
      { adj: +b.adjClose, close: +b.close, div: +(b.divCash || 0) }));
    series[t.ticker] = { meta: t, map: m };
  });

  // ---- 2. 日期交集 ----
  const all = Object.values(series);
  let common = [...all[0].map.keys()];
  all.slice(1).forEach(s => { common = common.filter(d => s.map.has(d)); });
  common.sort();
  const missing = all.map(s => ({ t: s.meta.ticker, n: s.map.size - common.length })).filter(x => x.n > 0);
  if (common.length < MIN_COMMON_DAYS)
    throw new Error(`共同交易日只有 ${common.length} 天，少于 ${MIN_COMMON_DAYS}`);

  // ---- 3. 过期检查 ----
  const last = common[common.length - 1];
  const ageDays = (now - new Date(last + 'T21:00:00Z')) / 864e5;
  if (ageDays > MAX_STALE_DAYS)
    throw new Error(`最新共同交易日是 ${last}，距今 ${ageDays.toFixed(1)} 天——数据可能没更新`);

  // 本周（周一到最新日）交易日数，短周（节假日）只做标记
  const lastD = new Date(last + 'T00:00:00Z');
  const monday = new Date(lastD - ((lastD.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
  const daysThisWeek = common.filter(d => d >= monday).length;

  // ---- 4. 组装 pillars ----
  const pillars = {};
  all.forEach(({ meta, map }) => {
    const p = pillars[meta.pillar] ||= { name: meta.pillar_name, tickers: {} };
    p.tickers[meta.ticker] = common.map(d => +map.get(d).adj.toFixed(4));
  });

  // 收益底座：近 4 次分红 / 最新原始收盘价
  if (pillars.income) {
    const ys = Object.keys(pillars.income.tickers).map(tk => {
      const { map } = series[tk];
      const dates = [...map.keys()].sort();
      const divs = dates.filter(d => map.get(d).div > 0).slice(-DIVS_PER_YEAR).map(d => map.get(d).div);
      const px = map.get(last).close;
      return divs.length === DIVS_PER_YEAR && px > 0 ? divs.reduce((a, b) => a + b, 0) / px * 100 : null;
    }).filter(y => y !== null);
    if (ys.length) pillars.income.dividend_yield = +(ys.reduce((a, b) => a + b, 0) / ys.length).toFixed(2);

    const obs = (fred && fred.observations) || [];
    const t10 = obs.filter(o => o.value !== '.' && o.date <= last).sort((a, b) => a.date < b.date ? 1 : -1)[0];
    if (t10) { pillars.income.treasury_10y = +(+t10.value).toFixed(2); pillars.income.treasury_date = t10.date; }
  }

  const issue = Math.round((new Date(last) - new Date(FIRST_WEEK_ENDING)) / (7 * 864e5)) + 1;
  return {
    week_ending: last,
    issue: Math.max(1, issue),
    lookback_weeks: 52,
    pillars,
    data_check: { common_days: common.length, first_day: common[0], days_this_week: daysThisWeek,
                  short_week: daysThisWeek < 5, dropped_days: missing, source: 'Tiingo EOD adjClose · FRED DGS10' },
  };
}

/* ---------- n8n 入口 ---------- */
if (typeof $input !== 'undefined') {
  const tickers = $(NODE_TICKERS).all().map(i => i.json);
  const raw = $input.all();
  // HTTP 节点设成「Response Format: Text，Put Output in Field: data」→ 每个标的正好一个 item，顺序与 Tickers 一致
  if (raw.length !== tickers.length)
    throw new Error(`收到 ${raw.length} 个 Tiingo 响应，应为 ${tickers.length} 个——检查 HTTP 节点的响应格式设置`);
  const tiingo = raw.map(it => {
    const d = it.json.data;
    if (typeof d === 'string') { try { return JSON.parse(d); } catch (e) { return { detail: d.slice(0, 120) }; } }
    return d;
  });
  return [{ json: assemble({ tiingo, tickers, fred: $(NODE_FRED).first().json }) }];
}
if (typeof module !== 'undefined') module.exports = { assemble };
