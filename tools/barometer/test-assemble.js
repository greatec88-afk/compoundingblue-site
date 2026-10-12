// 用「Tiingo 格式」的模拟响应测试组装 → 判定（非真实行情）
const fs=require('fs'),path=require('path');
const load=f=>{const m={exports:{}};const r=new Function('module','$input',fs.readFileSync(path.join(__dirname,f),'utf8'))(m,undefined);return {mod:m.exports,ret:r};};
const {assemble}=load('assemble.js').mod;
const {computeBarometer}=load('barometer.js').mod;
// tickers.js 是纯 n8n 节点：包一层取返回值
const tickers=new Function(fs.readFileSync(path.join(__dirname,'tickers.js'),'utf8'))().map(i=>i.json);

let seed=7; const rnd=()=>{seed=(seed*1664525+1013904223)%4294967296;return seed/4294967296;};
const g=()=>Math.sqrt(-2*Math.log(rnd()||1e-9))*Math.cos(2*Math.PI*rnd());
// 工作日日期：截至 2026-10-16（周五），往前 300 个工作日
const days=[];for(let d=new Date('2026-10-16T00:00:00Z');days.length<300;d=new Date(d-864e5)){const w=d.getUTCDay();if(w&&w<6)days.unshift(d.toISOString().slice(0,10));}
function bars(tk,px,sd,div){let adj=px,close=px;return days.map((d,i)=>{
  const r=0.0003+sd*g(); adj*=1+r; let dv=0;
  if(div&&i%63===40){dv=+(close*div/4).toFixed(4);}           // 季度除息
  close=dv?close*(1+r)-dv:close*(1+r);
  return {date:d+'T00:00:00.000Z',close:+close.toFixed(2),adjClose:+(adj*(close/adj)).toFixed(4)*0+ +adj.toFixed(4),divCash:dv};});}
const tiingo=tickers.map(t=>bars(t.ticker,100,0.01,t.pillar==='income'?0.036:0));
// QUAL 缺一天（模拟数据源漏数据）
tiingo[2]=tiingo[2].filter(b=>!b.date.startsWith('2026-09-15'));
const fred={observations:[{date:'2026-10-15',value:'4.08'},{date:'2026-10-16',value:'.'},{date:'2026-10-14',value:'4.10'}]};

const now=new Date('2026-10-17T01:00:00Z');   // 北京时间周六 09:00
const inp=assemble({tiingo,tickers,fred,now});
console.log('week_ending',inp.week_ending,'issue',inp.issue,'check',JSON.stringify(inp.data_check));
console.log('income yield',inp.pillars.income.dividend_yield,'10y',inp.pillars.income.treasury_10y,inp.pillars.income.treasury_date);
console.log('lens',Object.values(inp.pillars).flatMap(p=>Object.values(p.tickers).map(a=>a.length)).join(','));
const out=computeBarometer(inp);
out.pillars.forEach(p=>console.log(' ',p.name,p.label,p.weekly_return+'%','z',p.z,p.yield_spread!==undefined?'spread '+p.yield_spread:''));
// 过期
try{assemble({tiingo,tickers,fred,now:new Date('2026-10-24T01:00:00Z')});console.log('stale: NOT caught');}catch(e){console.log('stale: caught →',e.message);}
// 错误响应
try{const t2=[...tiingo];t2[0]={detail:'Invalid token'};assemble({tiingo:t2,tickers,fred,now});}catch(e){console.log('api err: caught →',e.message);}
