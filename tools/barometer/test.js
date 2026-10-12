// 测试：用模拟数据（非真实行情）验证判定逻辑；加载方式与 n8n Code 节点相同（包进函数）
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'barometer.js'), 'utf8');
const mod = { exports: {} };
new Function('module', '$input', src)(mod, undefined);
const { computeBarometer, classify } = mod.exports;

// --- 可复现随机数 ---
let seed = 20261016;
function rnd() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }
function gauss() { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// 生成 275 个交易日收盘价；最后 5 天用指定日收益（设计好的本周）
function series(start, dailySd, lastWeek) {
  const c = [start];
  for (let i = 0; i < 269; i++) c.push(c[c.length - 1] * (1 + 0.0003 + dailySd * gauss()));
  lastWeek.forEach(r => c.push(c[c.length - 1] * (1 + r)));
  return c.map(x => +x.toFixed(2));
}

const input = {
  week_ending: '2026-10-16', issue: 1, lookback_weeks: 52,
  pillars: {
    attack:    { name: '进攻引擎', tickers: {
      SMH:  series(250, 0.020, [-0.035, 0.028, -0.041, 0.022, -0.033]),
      QQQ:  series(480, 0.014, [-0.024, 0.019, -0.030, 0.015, -0.021]) } },
    core:      { name: '战略基石', tickers: {
      QUAL: series(170, 0.008, [0.002, 0.001, 0.003, -0.001, 0.002]),
      MOAT: series(90,  0.008, [0.001, 0.002, 0.000, 0.002, 0.001]) } },
    longevity: { name: '长寿主题', tickers: {
      XLV:  series(150, 0.010, [0.008, 0.006, 0.009, 0.005, 0.007]),
      GRID: series(120, 0.012, [0.009, 0.007, 0.008, 0.006, 0.009]) } },
    income:    { name: '收益底座', dividend_yield: 3.6, treasury_10y: 4.1, tickers: {
      SCHD: series(28,  0.007, [-0.002, -0.001, -0.003, 0.000, -0.002]),
      VYM:  series(130, 0.007, [-0.001, -0.002, -0.002, 0.001, -0.002]) } },
  },
};

const out = computeBarometer(input);
fs.writeFileSync(path.join(__dirname, 'sample-input.json'), JSON.stringify(input));
fs.writeFileSync(path.join(__dirname, 'sample-output.json'), JSON.stringify(out, null, 2));
out.pillars.forEach(p =>
  console.log(`${p.name}  ${p.label.padEnd(3)}  周收益 ${String(p.weekly_return).padStart(6)}%  z=${String(p.z).padStart(5)}  波动比=${p.vol_ratio}` +
              (p.yield_spread !== undefined ? `  利差=${p.yield_spread}pp` : '')));
console.log('summary:', out.summary);

// 边界单测：阈值
const cases = [[1.01,1,'sunny'],[1.0,1,'partly'],[0.01,1,'partly'],[0,1,'cloudy'],[-0.99,1,'cloudy'],
               [-1.0,1,'rain'],[-1.99,1,'rain'],[-2.0,1,'storm'],[0.5,2.1,'storm'],[null,1,'na']];
const bad = cases.filter(([z, v, e]) => classify(z, v) !== e);
console.log(bad.length ? 'THRESHOLD FAIL ' + JSON.stringify(bad) : 'thresholds OK (10/10)');
