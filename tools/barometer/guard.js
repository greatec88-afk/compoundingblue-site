/**
 * 组合晴雨表 · 文案守门 v2（n8n Code 节点，放在文案模型节点之后）
 * 检查：JSON 可解析、长度上限、禁用词、免责声明、数字是否都出自本周数据。
 * 不通过 → 抛错，n8n 走 Error Workflow（通知你人工处理），绝不自动发布。
 *
 * 输入：$input = 文案模型 HTTP 节点的响应（Claude / Gemini 格式均可）；$('Barometer') = 本周天气数据
 */
const BANNED = ['买入','卖出','加仓','减仓','抄底','逃顶','止损','目标价','建议','推荐','必涨','必跌','机会来了','上车',
                '暴跌','血洗','崩盘','起飞','暴涨','恐慌','降息','加息',   // 不预测央行动作
                '顺风分','逆风分','z值','z 值','标准差','常态范围内'];      // 不念术语，说人话
const DISCLAIMER = '非投资建议';

/** 从不同模型的响应里取出文本 */
function extractText(resp) {
  if (typeof resp === 'string') return resp;
  if (Array.isArray(resp.content)) return resp.content.map(c => c.text || '').join('');            // Anthropic
  if (Array.isArray(resp.candidates))                                                            // Gemini
    return resp.candidates[0].content.parts.map(p => p.text || '').join('');
  if (Array.isArray(resp.choices)) return resp.choices[0].message.content;                       // OpenAI 兼容
  if (typeof resp.text === 'string') return resp.text;
  throw new Error('无法识别文案模型的响应格式');
}

function guard(barometer, resp) {
  const text = extractText(resp);
  let out;
  try { out = JSON.parse(text.trim().replace(/^```(json)?\s*|\s*```$/g, '')); }
  catch (e) { throw new Error('文案模型输出不是合法 JSON'); }

  const errs = [];
  const len = s => [...(s || '')].length;
  if (!out.observation || len(out.observation) > 36) errs.push('observation 缺失或超过 36 字');
  const VO = Array.isArray(out.voiceover) ? out.voiceover.map(v => String(v.text || '')) : [];
  if (VO.length !== 6) errs.push('voiceover 必须是 6 段（钩子 + 四个抽屉各一段 + 本周看点）');
  const vo = VO.join('');
  const speak = s => len(s.replace(/[\s，。、：；！？「」—…,.:;!?%+\-−·]/g, ''));   // 只数要念出来的字
  const spoken = speak(vo);
  if (spoken > 130) errs.push(`口播共 ${spoken} 字，超过 130（配音会太长）`);
  if (/bp/i.test(vo)) errs.push('口播里请说「基点」，不要写 bp（TTS 会念成字母）');
  if (!VO[5] || !VO[5].includes(DISCLAIMER)) errs.push('第 ⑥ 段要以「非投资建议」收尾');
  if (!(out.caption || '').includes(DISCLAIMER)) errs.push('caption 缺少免责声明');

  // 天气词只用在抽屉上，不用在因子上（「实际利率放晴」说不通）
  if (/(利率|预期|人数|国债|初请)[^，。：；]{0,4}(放晴|转晴|多云|转阴|下雨|雷暴)/.test(vo)) errs.push('天气词要用在抽屉上，不要用在因子上（如「实际利率放晴」）');
  if (vo.includes('常态')) errs.push('口播不要出现「常态」：常态幅度就不提强度');
  if (/\d+(\.\d+)?万人/.test(vo) && /0\.\d万人/.test(vo)) errs.push('不足 1 万人请说成「1000人」这类整数，别说「0.1万人」');

  // 四个抽屉每段都要讲到：名字 + 本周天气
  const SHORT = { attack: '进攻', core: '基石', longevity: '长寿', income: '收益' };
  ['attack', 'core', 'longevity', 'income'].forEach((k, i) => {
    const p = barometer.pillars.find(x => x.key === k);
    const seg = VO[i + 1] || '';
    if (!p) return;
    if (!seg.includes(SHORT[k])) errs.push(`第 ${i + 2} 段没有讲到「${p.name}」`);
    else if (p.state !== 'na' && !seg.includes(p.label)) errs.push(`第 ${i + 2} 段没有说出${p.name}本周的天气「${p.label}」`);
    if (speak(seg) > 26) errs.push(`第 ${i + 2} 段 ${speak(seg)} 字，超过 26`);
  });

  // 本周看点：提到的事件、星期都必须在 watch 列表里
  const W = barometer.watch || [];
  const EV = { 'CPI': 'CPI', 'PCE': 'PCE', '非农': '非农', 'GDP': 'GDP', '议息': '议息', '美联储': '议息', '初请': '初请' };
  const look = (VO[5] || '') + (out.observation || '');
  Object.entries(EV).forEach(([kw, sh]) => {
    if (look.includes(kw) && !W.some(w => w.short === sh)) errs.push(`提到「${kw}」，但本周看点里没有这项`);
  });
  ((VO[5] || '').match(/周[一二三四五六日]/g) || []).forEach(d => {
    if (!W.some(w => w.weekday === d || (w.bj_time || '').includes(d))) errs.push(`「${d}」与本周看点的日期不符`);
  });

  const all = [out.observation, vo, out.caption].join('\n');
  const clean = all.split('非投资建议').join('');          // 免责声明本身不算违禁
  BANNED.forEach(w => { if (clean.includes(w)) errs.push(`出现禁用词「${w}」`); });

  // 数字核对：带单位的数字必须能在本周数据里找到
  const P = barometer.pillars.filter(p => p.latest !== null && p.latest !== undefined);
  const rates  = P.filter(p => p.kind === 'rate');
  const claims = P.filter(p => p.kind === 'claims');
  const num = m => Math.abs(parseFloat(m.replace(/[−]/g, '-').replace(/[^\d.\-]/g, '')));
  const fail = m => errs.push(`数字「${m.trim()}」在本周数据中找不到`);

  (all.match(/[+\-−]?\d+(\.\d+)?\s*%/g) || []).forEach(m => {                       // 利率水平
    if (!rates.some(p => Math.abs(p.latest - num(m)) < 0.06)) fail(m);
  });
  (all.match(/[+\-−]?\d+\s*(bp|BP|个基点|基点)/g) || []).forEach(m => {             // 利率变化
    if (!rates.some(p => Math.abs(Math.abs(p.change_value) - num(m)) <= 1)) fail(m);
  });
  (all.match(/[+\-−]?\d+(\.\d+)?\s*万/g) || []).forEach(m => {                      // 初请（水平或变化）
    const v = num(m);
    if (!claims.some(p => Math.abs(p.latest / 1e4 - v) < 0.15 || Math.abs(Math.abs(p.change_value) - v) < 0.15)) fail(m);
  });
  (all.match(/\d+(\.\d+)?\s*(?=人)/g) || []).forEach((m, i, arr) => {             // 「2000人」这类人数
    const v = num(m);
    if (/万\s*$/.test(m)) return;
    if (!claims.some(p => Math.abs(Math.abs(p.change_value) * 1e4 - v) <= 1000 || Math.abs(p.latest - v) <= 1000)) fail(m + '人');
  });
  if (all.includes('罕见') && !P.some(p => p.intensity === '罕见'))                  // 「罕见」必须与数据相符
    errs.push('「罕见」与本周数据不符');

  if (errs.length) throw new Error('文案未通过守门：' + errs.join('；'));
  return out;
}

if (typeof $input !== 'undefined') {
  // 本周数据从「Barometer」节点取（改了节点名就同步改这里）
  const barometer = $('Barometer').first().json;
  return [{ json: { ...guard(barometer, $input.first().json), barometer } }];
}
if (typeof module !== 'undefined') module.exports = { guard, extractText };
