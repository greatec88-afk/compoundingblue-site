/**
 * 组合晴雨表 · 文案守门（n8n Code 节点，放在 Claude 节点之后）
 * 检查：JSON 可解析、长度上限、禁用词、免责声明、数字不出现在数据之外。
 * 不通过 → 抛错，n8n 走 Error 分支（通知你人工处理），绝不自动发布。
 *
 * 输入：$input.first().json = { barometer: {...}, claude: <Anthropic 响应> }
 */
const BANNED = ['买入','卖出','加仓','减仓','抄底','逃顶','止损','目标价','建议','推荐','必涨','必跌','机会来了','上车',
                '暴跌','血洗','崩盘','起飞','暴涨','恐慌'];
const DISCLAIMER = '非投资建议';

function guard(barometer, claudeResp) {
  const text = typeof claudeResp === 'string' ? claudeResp
             : (claudeResp.content || []).map(c => c.text || '').join('');
  let out;
  try { out = JSON.parse(text.trim().replace(/^```(json)?|```$/g, '')); }
  catch (e) { throw new Error('Claude 输出不是合法 JSON'); }

  const errs = [];
  const len = s => [...(s || '')].length;
  if (!out.observation || len(out.observation) > 45) errs.push('observation 缺失或超过 45 字');
  if (!Array.isArray(out.voiceover) || out.voiceover.length !== 5) errs.push('voiceover 必须是 5 段');
  const vo = (out.voiceover || []).map(v => v.text).join('');
  const spoken = len(vo.replace(/[\s，。、：；！？「」—…,.:;!?%+\-−]/g, ''));   // 只数要念出来的字
  if (spoken > 100) errs.push(`口播共 ${spoken} 字，超过 100（20 秒约 5 字/秒）`);
  if (!vo.includes(DISCLAIMER)) errs.push('口播缺少免责声明');
  if (!(out.caption || '').includes(DISCLAIMER)) errs.push('caption 缺少免责声明');

  const all = [out.observation, vo, out.caption].join('\n');
  const clean = all.split('非投资建议').join('');          // 免责声明本身不算违禁
  BANNED.forEach(w => { if (clean.includes(w)) errs.push(`出现禁用词「${w}」`); });

  // 数字核对：文案里带 % 的数字必须能在数据里找到（允许取整）
  const known = barometer.pillars.flatMap(p => [p.weekly_return, p.yield_spread]).filter(x => typeof x === 'number');
  (all.match(/[+\-−]?\d+(\.\d+)?\s*%/g) || []).forEach(m => {
    const v = Math.abs(parseFloat(m.replace('−', '-')));
    if (!known.some(k => Math.abs(Math.abs(k) - v) < 0.6)) errs.push(`数字「${m}」在数据中找不到`);
  });

  if (errs.length) throw new Error('文案未通过守门：' + errs.join('；'));
  return out;
}

if (typeof $input !== 'undefined') {
  const j = $input.first().json;
  return [{ json: { ...guard(j.barometer, j.claude), barometer: j.barometer } }];
}
if (typeof module !== 'undefined') module.exports = { guard };
