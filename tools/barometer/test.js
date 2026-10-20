// 测试：FRED 格式的模拟响应（非真实数据）→ assemble → barometer；加载方式与 n8n Code 节点相同
const fs = require('fs'), path = require('path');
const load = f => { const m = { exports: {} }; new Function('module', '$input', fs.readFileSync(path.join(__dirname, f), 'utf8'))(m, undefined); return m.exports; };
const { assemble, targetFriday } = load('assemble.js');
const { computeBarometer, classify, fridayOf } = load('barometer.js');
let ok = 0, bad = 0; const t = (name, cond) => { cond ? ok++ : (bad++, console.log('FAIL', name)); };

// ---- 模拟数据 ----
let seed = 20261016;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const g = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
const days = []; for (let d = new Date('2026-10-16T00:00:00Z'); days.length < 330; d = new Date(d - 864e5)) { const w = d.getUTCDay(); if (w && w < 6) days.unshift(d.toISOString().slice(0, 10)); }
const n = days.length, last5 = n - 5;
const realD = [0.04, 0.03, 0.05, 0.02, 0.04];      // 本周实际利率 +18bp
const beD   = [-0.02, -0.01, -0.02, 0.00, -0.03];   // 本周通胀预期 −8bp
let r = 1.85, b = 2.30; const R = [], B = [];
days.forEach((d, i) => {
  if (i >= last5) { r += realD[i - last5]; b += beD[i - last5]; }
  else if (i) { r += 0.03 * (1.85 - r) + 0.05 * g(); b += 0.03 * (2.30 - b) + 0.025 * g(); }
  R.push(+r.toFixed(2)); B.push(+b.toFixed(2));
});
const holidays = new Set([days[100], days[200]]);    // FRED 节假日记为 "."
const fredDaily = vals => ({ observations: days.map((d, i) => ({ date: d, value: holidays.has(d) ? '.' : vals[i].toFixed(2) })) });
// 初请 4 周均值：周六日期
const sats = []; for (let d = new Date('2026-10-10T00:00:00Z'); sats.length < 66; d = new Date(d - 7 * 864e5)) sats.unshift(d.toISOString().slice(0, 10));
let c = 230000; const C = sats.map((d, i) => { if (i === sats.length - 1) c -= 2000; else if (i) c += 0.05 * (230000 - c) + 4000 * g(); return { date: d, value: String(Math.round(c)) }; });
const fred = { DFII10: fredDaily(R), DGS10: fredDaily(R.map((x, i) => x + B[i])), IC4WSA: { observations: C } };

// ---- 主流程（北京时间周二 09:00 运行）----
const now = new Date('2026-10-20T01:00:00Z');
// 模拟 FRED 发布日历（未来 7 天）：CPI 周四发布；无关的 H.15 应被忽略
const calendar = { release_dates: [
  { release_id: 10, release_name: 'Consumer Price Index', date: '2026-10-22' },
  { release_id: 18, release_name: 'H.15 Selected Interest Rates', date: '2026-10-21' } ] };
const input = assemble({ fred, calendar, now });
const out = computeBarometer(input);
fs.writeFileSync(path.join(__dirname, 'sample-input.json'), JSON.stringify(input));
fs.writeFileSync(path.join(__dirname, 'sample-output.json'), JSON.stringify(out, null, 2));
console.log('截至', input.week_ending, '第', input.issue, '期', JSON.stringify(input.data_check));
out.pillars.forEach(p => console.log(`  ${p.name}｜${p.factor} ${p.latest_display}  本周 ${p.change_display}  z=${p.z}  顺风分=${p.score}  → ${p.label}  (截至 ${p.as_of}, 波动比 ${p.vol_ratio})`));
console.log('  summary:', out.summary);
console.log('  本周看点:', out.watch.map(w => `${w.date} ${w.weekday} ${w.event} → ${w.drawers.join('/')}`).join('；'));

t('截至日 = 周五 10/16', input.week_ending === '2026-10-16');
t('本周看点：CPI（周四）+ 初请兜底', out.watch.length === 2 && out.watch.some(w => w.short === 'CPI' && w.weekday === '周四'));
t('无日历节点也能跑：议息日 10/28 出现在 10/27 那期', load('assemble.js').buildCalendar(null, new Date('2026-10-27T01:00:00Z')).some(w => w.short === '议息' && w.date === '2026-10-28'));
t('实际利率 +18bp', out.pillars[0].change_display === '+18bp');
t('通胀预期 −8bp', out.pillars[2].change_display === '-8bp');
t('10年期 = 实际 + 通胀 (+10bp)', out.pillars[3].change_display === '+10bp');
t('初请 −0.2万人', out.pillars[1].change_display === '-0.2万人');
t('上升=逆风：实际利率上升 → 顺风分 < 0', out.pillars[0].score < 0 && out.pillars[0].headwind);
t('下降=顺风：通胀预期下降 → 顺风分 > 0', out.pillars[2].score > 0 && !out.pillars[2].headwind);
t('初请截至 10/10（滞后一周）', out.pillars[1].as_of === '2026-10-10');
t('story：最逆风 = 进攻引擎，最顺风 = 长寿主题', out.story.most_headwind.name === '进攻引擎' && out.story.most_tailwind.name === '长寿主题');
t('story：十年期拆解 18 + (−8) = 10，两者抵消', out.story.decomposition.sentence.includes('+10bp') && out.story.decomposition.offsetting);

// ---- 截至日规则 ----
t('周六 09:00 运行 → 取上上个周五', targetFriday(new Date('2026-10-17T01:00:00Z')) === '2026-10-09');
t('周一 21:00 UTC 之后 → 取上周五', targetFriday(new Date('2026-10-19T21:00:00Z')) === '2026-10-16');
t('fridayOf 周一', fridayOf('2026-10-12') === '2026-10-16');

// ---- 守门：过期 / 错误 ----
const thr = (f) => { try { f(); return null; } catch (e) { return e.message; } };
const stale = JSON.parse(JSON.stringify(fred)); stale.DGS10.observations = stale.DGS10.observations.slice(0, -5);
const m1 = thr(() => assemble({ fred: stale, now })); t('H.15 未更新 → 报错', m1 && m1.includes('不在截至周')); console.log('  stale →', m1);
const m2 = thr(() => assemble({ fred: { ...fred, IC4WSA: { error_message: 'Bad Request. The value for variable api_key is not registered.' } }, now }));
t('API key 错误 → 报错', m2 && m2.includes('FRED 错误')); console.log('  api  →', m2);

// ---- 阈值 ----
[[1.01,1,'sunny'],[1.0,1,'partly'],[0.01,1,'partly'],[0,1,'cloudy'],[-0.99,1,'cloudy'],[-1.0,1,'rain'],[-1.99,1,'rain'],[-2.0,1,'storm'],[0.5,2.1,'storm'],[null,1,'na']]
  .forEach(([s, v, e]) => t(`classify(${s},${v})`, classify(s, v) === e));

console.log(bad ? `${bad} FAILED, ${ok} passed` : `all ${ok} checks passed`);
process.exitCode = bad ? 1 : 0;
