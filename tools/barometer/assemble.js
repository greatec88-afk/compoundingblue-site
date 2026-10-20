/**
 * 组合晴雨表 · n8n Code 节点「Assemble」（Run Once for All Items）v2
 * ------------------------------------------------------------
 * 把 3 个 FRED 响应（DFII10 / DGS10 / IC4WSA）组装成 barometer.js 的输入。
 *
 *   1. 截至日 = 最近一个「已过去 3 天以上」的周五（H.15 日度利率次一工作日才发布，
 *      周二 09:00 北京时间运行时，上周五的数据一定已经发布）
 *   2. 通胀预期 = DGS10 − DFII10，按同一天配对自己算（不用 FRED 自算的 T10YIE，那是版权序列）
 *   3. 过期 / 历史不足 → 直接抛错，n8n 走 Error Workflow 通知你，不渲染不发布
 *
 * 数据均为美国政府公共领域数据：美联储 H.15、美国劳工部。
 */
const NODE_SERIES = 'Series';                 // 上游节点名，改名的话同步改这里
const NODE_CALENDAR = 'FRED Calendar';        // 可选：未来 7 天的数据发布日历
const FIRST_WEEK_ENDING = '2026-10-16';       // 第 01 期的截至日；之后每周 +1
const MIN_DAILY_OBS  = 250;
const MIN_WEEKLY_OBS = 40;
const MAX_CLAIMS_LAG_DAYS = 13;               // 初请数据比利率晚约一周发布

const PILLARS = {
  attack:    { name: '进攻引擎', factor: '实际利率',     kind: 'rate',   freq: 'daily',  direction: 'up_bad', from: 'DFII10' },
  core:      { name: '战略基石', factor: '初请4周均值',  kind: 'claims', freq: 'weekly', direction: 'up_bad', from: 'IC4WSA' },
  longevity: { name: '长寿主题', factor: '通胀预期',     kind: 'rate',   freq: 'daily',  direction: 'up_bad', from: 'DGS10-DFII10' },
  income:    { name: '收益底座', factor: '10年期国债',   kind: 'rate',   freq: 'daily',  direction: 'up_bad', from: 'DGS10' },
};

/* ---------- 本周看点：未来 7 天会影响各抽屉的重要发布 ---------- */
// 美联储议息「决议日」（会议第二天）。来源：federalreserve.gov FOMC 日历；2027 年为暂定，每年核对一次。
const FOMC_DECISIONS = ['2026-01-28','2026-03-18','2026-04-29','2026-06-17','2026-07-29','2026-09-16','2026-10-28','2026-12-09',
                        '2027-01-27','2027-03-17','2027-04-28','2027-06-09','2027-07-28','2027-09-15','2027-10-27','2027-12-08'];
// FRED 发布名称 → 中文事件、影响的抽屉、优先级（数字越小越重要）
const EVENTS = [
  { match: /^Consumer Price Index\b/i,       name: 'CPI 通胀数据', short: 'CPI',  drawers: ['长寿主题', '收益底座'], pri: 1 },
  { match: /^Employment Situation\b/i,       name: '非农就业报告', short: '非农', drawers: ['战略基石', '进攻引擎'], pri: 1 },
  { match: /^Personal Income and Outlays\b/i, name: 'PCE 通胀数据', short: 'PCE',  drawers: ['长寿主题', '收益底座'], pri: 2 },
  { match: /^Gross Domestic Product\b/i,     name: 'GDP 数据',     short: 'GDP',  drawers: ['战略基石'],             pri: 2 },
];
const WEEKDAY = '日一二三四五六';

function buildCalendar(fredCal, now) {
  const start = iso(now), end = addDays(start, 6);
  const seen = new Set(), out = [];
  const push = (date, e) => {
    const k = e.short + date;
    if (date < start || date > end || seen.has(k)) return;
    seen.add(k);
    out.push({ date, weekday: '周' + WEEKDAY[new Date(date + 'T00:00:00Z').getUTCDay()],
               event: e.name, short: e.short, drawers: e.drawers, pri: e.pri });
  };
  ((fredCal && fredCal.release_dates) || []).forEach(r => {
    const e = EVENTS.find(x => x.match.test(String(r.release_name || '').trim()));
    if (e) push(r.date, e);
  });
  FOMC_DECISIONS.forEach(d => push(d, { name: '美联储议息结果', short: '议息', drawers: ['进攻引擎', '收益底座'], pri: 0 }));
  let top = out.sort((a, b) => a.pri - b.pri || (a.date < b.date ? -1 : 1)).slice(0, 2);
  if (top.length < 2) {                         // 没有大事件时，用每周四的初请周报兜底
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i);
      if (new Date(d + 'T00:00:00Z').getUTCDay() === 4) {
        top.push({ date: d, weekday: '周四', event: '初请失业金周报', short: '初请', drawers: ['战略基石'], pri: 3 });
        break;
      }
    }
  }
  return top.sort((a, b) => a.date < b.date ? -1 : 1);
}

const iso = d => d.toISOString().slice(0, 10);
const addDays = (ds, n) => iso(new Date(+new Date(ds + 'T00:00:00Z') + n * 864e5));

function targetFriday(now) {
  // 周五 21:00 UTC ≈ 美东收盘后；再过 3 天确保 H.15 已发布周五数据
  let d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (let i = 0; i < 14; i++, d = new Date(+d - 864e5)) {
    if (d.getUTCDay() === 5 && +d + (21 + 72) * 3600e3 <= +now) return iso(d);
  }
  throw new Error('无法确定截至日');
}

function parseFred(resp, id) {
  if (resp && resp.error_message) throw new Error(`FRED 错误（${id}）：${resp.error_message}`);
  const obs = (resp && resp.observations) || [];
  const out = obs.filter(o => o.value !== '.' && o.value !== '' && !isNaN(+o.value))
                 .map(o => [o.date, +o.value]).sort((a, b) => a[0] < b[0] ? -1 : 1);
  if (!out.length) throw new Error(`FRED 返回空数据：${id}`);
  return out;
}

function assemble({ fred, calendar = null, now = new Date() }) {
  const we = targetFriday(now);
  const monday = addDays(we, -4);
  const s = {};
  ['DFII10', 'DGS10', 'IC4WSA'].forEach(id => { s[id] = parseFred(fred[id], id).filter(o => o[0] <= we); });

  // 通胀预期：同日配对
  const real = new Map(s.DFII10);
  s['DGS10-DFII10'] = s.DGS10.filter(([d]) => real.has(d)).map(([d, v]) => [d, +(v - real.get(d)).toFixed(4)]);

  const check = {};
  for (const [id, obs] of Object.entries(s)) {
    const last = obs[obs.length - 1][0];
    const weekly = id === 'IC4WSA';
    check[id] = { last, n: obs.length };
    if (obs.length < (weekly ? MIN_WEEKLY_OBS : MIN_DAILY_OBS))
      throw new Error(`${id} 只有 ${obs.length} 个观测，历史不足`);
    if (!weekly && last < monday)
      throw new Error(`${id} 最新数据 ${last} 不在截至周（${monday}~${we}）内——H.15 可能未更新`);
    if (weekly && last < addDays(we, -MAX_CLAIMS_LAG_DAYS))
      throw new Error(`IC4WSA 最新数据 ${last} 距截至日超过 ${MAX_CLAIMS_LAG_DAYS} 天`);
  }

  const pillars = {};
  for (const [k, p] of Object.entries(PILLARS)) {
    const { from, ...meta } = p;
    pillars[k] = { ...meta, series: from, obs: s[from] };
  }
  const daysThisWeek = s.DGS10.filter(o => o[0] >= monday).length;
  const issue = Math.round((new Date(we) - new Date(FIRST_WEEK_ENDING)) / (7 * 864e5)) + 1;

  return {
    week_ending: we,
    issue: Math.max(1, issue),
    lookback_weeks: 52,
    pillars,
    calendar: buildCalendar(calendar, now),
    data_check: { ...check, days_this_week: daysThisWeek, short_week: daysThisWeek < 5,
                  source: '美联储 H.15（DFII10, DGS10）· 美国劳工部（IC4WSA）· 经 FRED® API' },
  };
}

/* ---------- n8n 入口 ---------- */
if (typeof $input !== 'undefined') {
  const ids = $(NODE_SERIES).all().map(i => i.json.series_id);
  const raw = $input.all();
  if (raw.length !== ids.length) throw new Error(`收到 ${raw.length} 个 FRED 响应，应为 ${ids.length} 个`);
  const fred = {};
  raw.forEach((it, i) => {
    let j = it.json;
    if (typeof j.data === 'string') { try { j = JSON.parse(j.data); } catch (e) { j = { error_message: j.data.slice(0, 120) }; } }
    fred[ids[i]] = j;
  });
  let calendar = null;
  try { calendar = $(NODE_CALENDAR).first().json; } catch (e) { /* 没接日历节点也能跑：只用议息日 + 初请兜底 */ }
  return [{ json: assemble({ fred, calendar }) }];
}
if (typeof module !== 'undefined') module.exports = { assemble, targetFriday, buildCalendar };
