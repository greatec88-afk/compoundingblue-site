const fs=require('fs'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'guard.js'),'utf8');
const mod={exports:{}}; new Function('module','$input',src)(mod,undefined);
const {guard}=mod.exports;
const b=JSON.parse(fs.readFileSync(path.join(__dirname,'sample-output.json'),'utf8'));
const good={observation:'进攻抽屉遇雷暴，长寿抽屉却放晴——这正是把四个抽屉分开放的意义：风雨只打湿其中一格。',
 voiceover:[{t:'0-2.5',text:'进攻抽屉一周跌了5%，雷暴。'},{t:'2.5-8',text:'本周组合晴雨表：进攻雷暴，基石多云，长寿晴，收益底座阴。'},
  {t:'9-12.5',text:'进攻这次的跌幅，偏离常态超过两个标准差。'},{t:'12.5-16',text:'同一周，长寿主题却涨了3.76%，放晴。'},
  {t:'16-20',text:'风雨只打湿一格，这就是分抽屉的意义。教育分享，非投资建议。'}],
 caption:'进攻雷暴，长寿放晴：同一周，四个抽屉四种天气。\n教育分享 · 非投资建议',hashtags:['#组合晴雨表']};
const wrap=o=>({content:[{type:'text',text:JSON.stringify(o)}]});
try{guard(b,wrap(good));console.log('good: PASS');}catch(e){console.log('good: FAIL',e.message);}
const bad=JSON.parse(JSON.stringify(good)); bad.caption='进攻暴跌，正是抄底机会，涨幅12%\n教育分享 · 非投资建议';
try{guard(b,wrap(bad));console.log('bad: PASS (unexpected)');}catch(e){console.log('bad: blocked →',e.message);}
