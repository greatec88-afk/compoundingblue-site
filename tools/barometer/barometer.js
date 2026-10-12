/**
 * 组合晴雨表 · Portfolio Barometer — 天气判定脚本
 * ------------------------------------------------------------
 * 用途：输入四个抽屉的 ETF 篮子日收盘价，输出本周四个天气状态。
 * 可直接粘贴进 n8n 的 Code 节点（JavaScript，Run Once for All Items），
 * 也可在 Node 中 require 后单独测试。
 *
 * 判定规则（一把统一刻度，按各篮子自身波动标准化）：
 *   z = (本周收益 − 历史周收益均值) / 历史周收益标准差
 *   z > +1.0            → 晴
 *   0 < z ≤ +1.0        → 多云
 *   −1.0 < z ≤ 0        → 阴
 *   −2.0 < z ≤ −1.0     → 雨
 *   z ≤ −2.0，或本周日波动 > 2× 常态日波动 → 雷暴
 *
 * 输入 JSON（closes 按时间从旧到新，日收盘价）：
 * {
 *   "week_ending": "2026-10-16", "issue": 1, "lookback_weeks": 52,
 *   "pillars": {
 *     "attack":    { "name": "进攻引擎", "tickers": { "SMH": [..], "QQQ": [..] } },
 *     "core":      { "name": "战略基石", "tickers": { "QUAL": [..], "MOAT": [..] } },
 *     "longevity": { "name": "长寿主题", "tickers": { "XLV": [..], "GRID": [..] } },
 *     "income":    { "name": "收益底座", "tickers": { "SCHD": [..], "VYM": [..] },
 *                    "dividend_yield": 3.6, "treasury_10y": 4.1 }   // 可选，单位 %
 *   }
 * }
 */

const ORDER = ['attack', 'core', 'longevity', 'income'];

const STATES = {
  sunny:   { label: '晴',   icon: 'sunny'   },
  partly:  { label: '多云', icon: 'partly'  },
  cloudy:  { label: '阴',   icon: 'cloudy'  },
  rain:    { label: '雨',   icon: 'rain'    },
  storm:   { label: '雷暴', icon: 'storm'   },
  na:      { label: '数据不足', icon: 'na'  },
};

function mean(a) { return a.reduce((s, x) => s + x, 0) / a.length; }
function stdev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
function dailyReturns(closes) {
  const r = [];
  for (let i = 1; i < closes.length; i++) r.push(closes[i] / closes[i - 1] - 1);
  return r;
}
function compound(rs) { return rs.reduce((p, r) => p * (1 + r), 1) - 1; }

/** 等权篮子：各标的日收益按日对齐（从最新一天往回对齐）后取平均 */
function basketDailyReturns(tickers) {
  const series = Object.values(tickers).map(dailyReturns);
  const n = Math.min(...series.map(s => s.length));
  const out = [];
  for (let i = 0; i < n; i++) {
    const vals = series.map(s => s[s.length - n + i]);
    out.push(mean(vals));
  }
  return out;
}

function classify(z, volRatio) {
  if (z === null) return 'na';
  if (z <= -2.0 || volRatio > 2.0) return 'storm';
  if (z > 1.0) return 'sunny';
  if (z > 0) return 'partly';
  if (z > -1.0) return 'cloudy';
  return 'rain';
}

function computePillar(key, p, lookbackWeeks) {
  const r = basketDailyReturns(p.tickers);
  const DAYS = 5;
  if (r.length < DAYS * 9) {           // 至少约 2 个月历史才判定
    return { key, name: p.name, tickers: Object.keys(p.tickers), state: 'na', ...STATES.na,
             weekly_return: null, z: null, vol_ratio: null };
  }
  const cur = r.slice(-DAYS);
  const hist = r.slice(0, -DAYS);
  const weekly = compound(cur);

  // 历史：不重叠的 5 日区块（从当前周往回数），最多 lookbackWeeks 周
  const histWeeks = [];
  for (let end = hist.length; end - DAYS >= 0 && histWeeks.length < lookbackWeeks; end -= DAYS) {
    histWeeks.push(compound(hist.slice(end - DAYS, end)));
  }
  const histDaily = hist.slice(-lookbackWeeks * DAYS);

  const mu = mean(histWeeks);
  const sd = stdev(histWeeks);
  const z = sd > 0 ? (weekly - mu) / sd : null;
  const dSdHist = stdev(histDaily);
  const volRatio = dSdHist > 0 ? stdev(cur) / dSdHist : 0;

  const state = classify(z, volRatio);
  const out = {
    key, name: p.name, tickers: Object.keys(p.tickers), state, ...STATES[state],
    weekly_return: +(weekly * 100).toFixed(2),     // %
    z: z === null ? null : +z.toFixed(2),
    vol_ratio: +volRatio.toFixed(2),
  };
  if (typeof p.dividend_yield === 'number' && typeof p.treasury_10y === 'number') {
    out.yield_spread = +(p.dividend_yield - p.treasury_10y).toFixed(2);   // 百分点
  }
  return out;
}

function computeBarometer(input) {
  const lookback = input.lookback_weeks || 52;
  const pillars = ORDER.filter(k => input.pillars[k])
                       .map(k => computePillar(k, input.pillars[k], lookback));
  const count = {};
  pillars.forEach(p => { count[p.label] = (count[p.label] || 0) + 1; });
  return {
    title: '组合晴雨表',
    issue: input.issue || null,
    week_ending: input.week_ending || null,
    pillars,
    summary: Object.entries(count).map(([k, v]) => `${v}${k}`).join(' · '),
    rule: 'z = (本周收益−历史周均值)/历史周标准差；晴>1｜多云0~1｜阴−1~0｜雨−2~−1｜雷暴≤−2 或日波动>2×常态',
  };
}

/* ---------- n8n Code 节点入口 ---------- */
if (typeof $input !== 'undefined') {
  // eslint-disable-next-line no-undef
  return [{ json: computeBarometer($input.first().json) }];
}
/* ---------- Node 测试入口 ---------- */
if (typeof module !== 'undefined') module.exports = { computeBarometer, classify };
