// 守门测试：用 sample-output.json（模拟数据）检查合规 / 违规文案，以及 Claude / Gemini 两种响应格式
const fs = require('fs'), path = require('path');
const m = { exports: {} };
new Function('module', '$input', fs.readFileSync(path.join(__dirname, 'guard.js'), 'utf8'))(m, undefined);
const { guard } = m.exports;
const b = JSON.parse(fs.readFileSync(path.join(__dirname, 'sample-output.json'), 'utf8'));

const good = {
  observation: '十年期只涨了10个基点，因为通胀预期回落，替实际利率挡掉了一半。',
  voiceover: [
    { t: '1', text: '实际利率一周涨了18个基点。' },
    { t: '2', text: '进攻引擎下雨：成长股估值的压力，明显变大了。' },
    { t: '3', text: '战略基石多云：新申请失业的少了2000人，底盘还稳。' },
    { t: '4', text: '长寿主题放晴：通胀预期回落了8个基点。' },
    { t: '5', text: '收益底座转阴：十年期涨10个基点，通胀预期挡掉了一半。' },
    { t: '6', text: '本周看点：周四公布CPI，它直接影响长寿和收益两格。非投资建议。' } ],
  caption: '实际利率 +18bp，通胀预期 -8bp：同一周，四个抽屉四种天气。\n本周看点：10/22 周四 CPI\n数据：美联储 H.15、美国劳工部（经 FRED®）\n教育分享 · 非投资建议',
  hashtags: ['#组合晴雨表'],
};
const claude = o => ({ content: [{ type: 'text', text: JSON.stringify(o) }] });
const gemini = o => ({ candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(o) + '\n```' }] } }] });
let bad = 0;
const expect = (name, f, shouldPass) => {
  try { f(); console.log(shouldPass ? `PASS  ${name}` : `FAIL  ${name}（应被拦截却通过）`); if (!shouldPass) bad++; }
  catch (e) { console.log(shouldPass ? `FAIL  ${name} → ${e.message}` : `PASS  ${name} → 已拦截：${e.message}`); if (shouldPass) bad++; }
};
expect('合规文案（Claude 格式）', () => guard(b, claude(good)), true);
expect('合规文案（Gemini 格式，带 ```json）', () => guard(b, gemini(good)), true);
const v1 = JSON.parse(JSON.stringify(good)); v1.caption = '利率暴涨，美联储要加息了，30个基点！\n教育分享 · 非投资建议';
const v3 = JSON.parse(JSON.stringify(good)); v3.voiceover[0].text = '实际利率一周涨了18bp。';
const v4 = JSON.parse(JSON.stringify(good)); v4.voiceover[2].text = '就业数据还行。';
const v5 = JSON.parse(JSON.stringify(good)); v5.voiceover[5].text = '本周看点：周五非农就业报告。非投资建议。';
expect('口播写 bp', () => guard(b, claude(v3)), false);
expect('禁用词 + 编造数字', () => guard(b, claude(v1)), false);
const v2 = JSON.parse(JSON.stringify(good)); v2.voiceover[2].text = '实际利率罕见上行，z值1.55。';
expect('夸大强度 + 念术语', () => guard(b, claude(v2)), false);
expect('漏讲战略基石', () => guard(b, claude(v4)), false);
expect('看点里编造事件和日期', () => guard(b, claude(v5)), false);
process.exitCode = bad ? 1 : 0;
