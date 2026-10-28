/**
 * 组合晴雨表 · Portfolio Barometer — 天气判定脚本 v2（气候因子版）
 * ------------------------------------------------------------
 * 每个抽屉看一个「气候因子」（美国政府公共领域数据），按它本周的变化给天气：
 *   进攻引擎 ← 实际利率 DFII10        上升 = 逆风
 *   战略基石 ← 初请失业金 4 周均值 IC4WSA  上升 = 逆风
 *   长寿主题 ← 通胀预期 = DGS10 − DFII10   上升 = 逆风
 *   收益底座 ← 10 年期国债 DGS10        上升 = 逆风
 *
 * 判定（一把统一刻度）：
 *   z = (本周变化 − 过去 52 周周变化均值) / 周变化标准差
 *   顺风分 s = 「上升=逆风」时取 −z
 *   s > 1 晴 ｜ 0 < s ≤ 1 多云 ｜ −1 < s ≤ 0 阴 ｜ −2 < s ≤ −1 雨
 *   s ≤ −2，或「逆风 + 本周日变化波动 > 2× 常态」（仅日度因子）→ 雷暴
 *   顺风但波动 > 2× 常态：天气按 s 判定，另标 volatile=true（卡片显示「波动大」）
 *
 * 输入（由 assemble.js 生成）：
 * { week_ending:'2026-10-16', issue:1, lookback_weeks:52,
 *   pillars:{ attack:{ name, factor, kind:'rate'|'claims', freq:'daily'|'weekly',
 *                      direction:'up_bad', obs:[['2026-10-16',1.85], ...] }, ... } }
 *
 * 可直接粘贴进 n8n Code 节点（Run Once for All Items），也可在 Node 中测试。
 */

const ORDER = ['attack', 'core', 'longevity', 'income'];
const STATES = {
  sunny:  { label: '晴',   icon: 'sunny'  },
  partly: { label: '多云', icon: 'partly' },
  cloudy: { label: '阴',   icon: 'cloudy' },
  rain:   { label: '雨',   icon: 'rain'   },
  storm:  { label: '雷暴', icon: 'storm'  },
  na:     { label: '数据不足', icon: 'na' },
};
const MIN_HIST_WEEKS = 26;

function mean(a) { return a.reduce((s, x) => s + x, 0) / a.length; }
function stdev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
/** 工作日所属那一周的周五（YYYY-MM-DD） */
function fridayOf(ds) {
  const d = new Date(ds + 'T00:00:00Z');
  const add = (5 - d.getUTCDay() + 7) % 7;
  return new Date(+d + add * 864e5).toISOString().slice(0, 10);
}

function classify(s, volRatio) {
  if (s === null) return 'na';
  if (s <= -2.0 || (volRatio > 2.0 && s < 0)) return 'storm';   // 雷暴只给逆风；顺风的大波动另行标注
  if (s > 1.0) return 'sunny';
  if (s > 0) return 'partly';
  if (s > -1.0) return 'cloudy';
  return 'rain';
}

function fmtSigned(v, dec) { const s = v.toFixed(dec); return (v > 0 ? '+' : '') + (s === '-0' || s === '-0.0' ? s.slice(1) : s); }

function display(kind, latest, change) {
  if (kind === 'claims') {
    const cv = +(change / 1e4).toFixed(1);
    return { latest_display: (latest / 1e4).toFixed(1) + '万人', change_value: cv, change_unit: '万',
             change_decimals: 1, change_display: fmtSigned(cv, 1) + '万人' };
  }
  const bp = Math.round(change * 100);
  return { latest_display: latest.toFixed(2) + '%', change_value: bp, change_unit: 'bp',
           change_decimals: 0, change_display: fmtSigned(bp, 0) + 'bp' };
}

function computePillar(key, p, weekEnding, lookback) {
  const obs = (p.obs || []).filter(o => o[0] <= weekEnding).sort((a, b) => a[0] < b[0] ? -1 : 1);
  const base = { key, name: p.name, factor: p.factor, kind: p.kind };
  const na = { ...base, state: 'na', ...STATES.na, latest: null, change_value: null, z: null, score: null, vol_ratio: null };
  if (obs.length < 3) return na;

  let levels, curDaily = [], histDaily = [];
  if (p.freq === 'daily') {
    const wk = new Map();
    obs.forEach(([d, v]) => wk.set(fridayOf(d), v));                 // 每周最后一个观测
    const keys = [...wk.keys()].sort();
    if (keys[keys.length - 1] !== weekEnding) return na;              // 本周没有数据
    levels = keys.map(k => wk.get(k));
    for (let i = 1; i < obs.length; i++) {
      const diff = obs[i][1] - obs[i - 1][1];
      (fridayOf(obs[i][0]) === weekEnding ? curDaily : histDaily).push(diff);
    }
    histDaily = histDaily.slice(-lookback * 5);
  } else {
    levels = obs.map(o => o[1]);
  }

  const changes = levels.slice(1).map((v, i) => v - levels[i]);
  const cur = changes[changes.length - 1];
  const hist = changes.slice(0, -1).slice(-lookback);
  if (hist.length < MIN_HIST_WEEKS) return na;

  const sd = stdev(hist);
  const z = sd > 0 ? (cur - mean(hist)) / sd : 0;
  const s = p.direction === 'up_bad' ? -z : z;
  const hsd = stdev(histDaily);
  const volRatio = curDaily.length >= 2 && hsd > 0 ? stdev(curDaily) / hsd : 0;
  const state = classify(s, volRatio);
  const latest = obs[obs.length - 1][1];

  return {
    ...base, state, ...STATES[state],
    latest: +latest.toFixed(p.kind === 'claims' ? 0 : 2),
    change: +cur.toFixed(p.kind === 'claims' ? 0 : 4),
    ...display(p.kind, latest, cur),
    as_of: obs[obs.length - 1][0],
    z: +z.toFixed(2),            // 本周变化的标准化幅度（原始方向）
    score: +s.toFixed(2),        // 顺风分：>0 顺风，<0 逆风
    headwind: s < 0,
    intensity: Math.abs(z) >= 2 ? '罕见' : Math.abs(z) >= 1 ? '明显' : '常态',
    direction: Math.abs(cur) < (p.kind === 'claims' ? 500 : 0.005) ? '持平' : cur > 0 ? '上行' : '下行',
    vol_ratio: +volRatio.toFixed(2),
    volatile: volRatio > 2.0,
  };
}

/** 给文案模型的「事实清单」：已经算好的结构性结论，模型只负责用人话讲出来 */
function buildStory(pillars) {
  const ok = pillars.filter(p => p.score !== null);
  if (!ok.length) return null;
  const by = k => pillars.find(p => p.key === k);
  const pick = p => p && { name: p.name, factor: p.factor, change_display: p.change_display,
                           latest_display: p.latest_display, label: p.label, intensity: p.intensity, direction: p.direction };
  const most = ok.reduce((a, b) => Math.abs(b.score) > Math.abs(a.score) ? b : a);
  const worst = ok.reduce((a, b) => b.score < a.score ? b : a);
  const best = ok.reduce((a, b) => b.score > a.score ? b : a);
  const real = by('attack'), be = by('longevity'), ten = by('income');
  let decomposition = null;
  if (real && be && ten && real.score !== null && be.score !== null && ten.score !== null) {
    const r = real.change_value, e = be.change_value, t = ten.change_value;
    decomposition = {
      ten_year_bp: t, real_bp: r, inflation_bp: e,
      driver: Math.abs(r) >= Math.abs(e) ? '实际利率' : '通胀预期',
      offsetting: r * e < 0,            // 两个分量反向：一个在抵消另一个
      sentence: `十年期 ${t > 0 ? '+' : ''}${t}bp = 实际利率 ${r > 0 ? '+' : ''}${r}bp + 通胀预期 ${e > 0 ? '+' : ''}${e}bp`,
    };
  }
  return {
    hook: pick(most),                    // 本周最极端的一格
    most_headwind: pick(worst),          // 第 9 秒高亮
    most_tailwind: pick(best),           // 第 12.5 秒高亮
    headwinds: ok.filter(p => p.headwind).map(p => p.name),
    tailwinds: ok.filter(p => !p.headwind).map(p => p.name),
    decomposition,
  };
}

function computeBarometer(input) {
  const lookback = input.lookback_weeks || 52;
  const pillars = ORDER.filter(k => input.pillars[k])
                       .map(k => computePillar(k, input.pillars[k], input.week_ending, lookback));
  const story = buildStory(pillars);
  const count = {};
  pillars.forEach(p => { count[p.label] = (count[p.label] || 0) + 1; });
  return {
    title: '组合晴雨表',
    issue: input.issue || null,
    week_ending: input.week_ending || null,
    pillars,
    summary: Object.entries(count).map(([k, v]) => `${v}${k}`).join(' · '),
    identity: '10年期国债 = 实际利率 + 通胀预期',
    story,
    watch: input.calendar || [],     // 本周看点（已按重要性挑出最多 2 项）
    source: '美联储 H.15 · 美国劳工部（经 FRED®）',
    rule: '本周变化的 z 值，上升=逆风；晴>1｜多云0~1｜阴−1~0｜雨−2~−1｜雷暴≤−2 或（逆风且日波动>2×常态）',
  };
}

/* ---------- n8n Code 节点入口 ---------- */
if (typeof $input !== 'undefined') {
  return [{ json: computeBarometer($input.first().json) }];
}
/* ---------- Node 测试入口 ---------- */
if (typeof module !== 'undefined') module.exports = { computeBarometer, classify, fridayOf };
