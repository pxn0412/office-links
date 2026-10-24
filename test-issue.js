// 运行: node test-issue.js   测试"问题"这条协同流程
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '负责人页面-v4.html'), 'utf8');
const m = /\/\*LOGIC_START\*\/([\s\S]*?)\/\*LOGIC_END\*\//.exec(html);
const L = new Function(m[1] + '; return Logic;')();
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('ok   ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n     ' + e.message); } }
function eq(a, b, msg) { if (a !== b) throw new Error((msg || '') + ' 期望 ' + JSON.stringify(b) + ' 实际 ' + JSON.stringify(a)); }
const proj = (s, id) => s.projects.find(p => p.id === id);
const act = (s, a) => L.reduce(s, a);
const sum = (s, id) => L.summarize(proj(s, id), s.today);

// C 学校:任务 3 采购备货约 6/15,未开始卡住;供应商报问题
function reported() { return act(L.seed(), { type: 'REPORT_PROBLEM', p: 'C', t: 3, role: 'supplier', reason: '工厂延期3天' }); }

t('供应商报问题:自动生成一件独立的问题,状态待指派', () => {
  const p = proj(reported(), 'C'); eq(p.issues.length, 1); eq(p.issues[0].status, 'open'); eq(p.issues[0].by, 'supplier'); eq(p.issues[0].t, 3);
});
t('影响范围:任务 3 的下游未完成任务都算上', () => {
  const i = proj(reported(), 'C').issues[0]; eq(i.affected.join(','), '5,6,7,8,9,10');
});
t('施工方自动收到通知,供应商自己不收,客户不自动收', () => {
  const p = proj(reported(), 'C');
  eq(p.msgs.filter(x => x.to === 'builder').length, 1); eq(p.msgs.filter(x => x.to === 'supplier').length, 0); eq(p.msgs.filter(x => x.to === 'customer').length, 0);
  if (!/到货核验|安装施工/.test(p.msgs[0].text)) throw new Error(p.msgs[0].text);
});
t('负责人待办里出现"有新问题还没指派"', () => {
  const s = reported(); eq(sum(s, 'C').items.some(x => x.kind === 'issue_open'), true);
});
t('不重复:同一任务已有未关闭问题,再报会重复生成问题吗(不会)', () => {
  const s = act(reported(), { type: 'REPORT_PROBLEM', p: 'C', t: 3, role: 'supplier', reason: '再说一次' });
  eq(proj(s, 'C').issues.length, 1);
});
t('指派:状态变处理中,被指派方收到通知,外部角色不能指派', () => {
  let s = reported();
  const bad = act(s, { type: 'ASSIGN_ISSUE', p: 'C', issue: 'i1', assignee: 'builder', role: 'supplier' }); eq(bad, s);
  s = act(s, { type: 'ASSIGN_ISSUE', p: 'C', issue: 'i1', assignee: 'supplier', note: '找替代货源' });
  const p = proj(s, 'C'); eq(p.issues[0].status, 'assigned'); eq(p.issues[0].assignee, 'supplier');
  eq(p.msgs.filter(x => x.to === 'supplier').length, 1);
  if (!/找替代货源/.test(p.msgs.find(x => x.to === 'supplier').text)) throw new Error('通知里要带负责人的要求');
});
t('只有被指派的人能回复,别人回复无效', () => {
  let s = act(reported(), { type: 'ASSIGN_ISSUE', p: 'C', issue: 'i1', assignee: 'supplier' });
  eq(act(s, { type: 'ISSUE_REPLY', p: 'C', issue: 'i1', role: 'builder', text: '我来' }), s);
  eq(act(s, { type: 'ISSUE_REPLY', p: 'C', issue: 'i1', role: 'supplier', text: '' }), s, '空回复');
});
t('回复后:待负责人确认,首页出现待办', () => {
  let s = act(reported(), { type: 'ASSIGN_ISSUE', p: 'C', issue: 'i1', assignee: 'supplier' });
  s = act(s, { type: 'ISSUE_REPLY', p: 'C', issue: 'i1', role: 'supplier', text: '换现货', date: '2026-06-18' });
  eq(proj(s, 'C').issues[0].status, 'resolved'); eq(sum(s, 'C').items.some(x => x.kind === 'issue_result'), true);
});
t('确认结果:问题关闭,任务 3 新日期生效,原约定日保留,相关人收到新安排', () => {
  let s = act(reported(), { type: 'ASSIGN_ISSUE', p: 'C', issue: 'i1', assignee: 'supplier' });
  s = act(s, { type: 'ISSUE_REPLY', p: 'C', issue: 'i1', role: 'supplier', text: '换现货', date: '2026-06-18' });
  s = act(s, { type: 'CONFIRM_ISSUE', p: 'C', issue: 'i1' });
  const p = proj(s, 'C');
  eq(p.issues[0].status, 'closed'); eq(p.tasks[3].promised, '2026-06-18'); eq(p.tasks[3].original, '2026-06-15'); eq(p.tasks[3].problem, null);
  const b = p.msgs.filter(x => x.to === 'builder'); eq(b.length, 2, '施工方先收到风险通知,关闭后再收到新安排');
  if (!/6\/18/.test(b[1].text)) throw new Error(b[1].text);
});
t('退回结果:回到处理中,被指派人收到通知', () => {
  let s = act(reported(), { type: 'ASSIGN_ISSUE', p: 'C', issue: 'i1', assignee: 'supplier' });
  s = act(s, { type: 'ISSUE_REPLY', p: 'C', issue: 'i1', role: 'supplier', text: '换现货' });
  s = act(s, { type: 'REJECT_ISSUE', p: 'C', issue: 'i1', note: '价格太高' });
  eq(proj(s, 'C').issues[0].status, 'assigned');
  if (!/价格太高/.test(proj(s, 'C').msgs.filter(x => x.to === 'supplier').pop().text)) throw new Error('退回原因没带上');
});
t('时间线完整:上报、通知、指派、回复、关闭都有记录', () => {
  let s = act(reported(), { type: 'ASSIGN_ISSUE', p: 'C', issue: 'i1', assignee: 'supplier' });
  s = act(s, { type: 'ISSUE_REPLY', p: 'C', issue: 'i1', role: 'supplier', text: '换现货', date: '2026-06-18' });
  s = act(s, { type: 'CONFIRM_ISSUE', p: 'C', issue: 'i1' });
  const text = proj(s, 'C').issues[0].timeline.map(x => x.text).join('|');
  ['上报问题', '已通知', '指派给', '回复处理结果', '问题关闭'].forEach(k => { if (!text.includes(k)) throw new Error('缺 ' + k + ':' + text); });
});
t('首页那句话:问题处理中,卡在被指派的人手上', () => {
  const s = act(reported(), { type: 'ASSIGN_ISSUE', p: 'C', issue: 'i1', assignee: 'supplier' });
  const x = sum(s, 'C'); if (!/交货延期|工厂延期/.test(x.line1)) throw new Error(x.line1);
});
t('负责人自己上报问题(施工风险),通知相关人', () => {
  const s = act(L.seed(), { type: 'OWNER_ISSUE', p: 'C', t: 7, kind: '施工风险', text: '现场没有脚手架' });
  const i = proj(s, 'C').issues[0]; eq(i.kind, '施工风险'); eq(i.by, 'owner'); eq(i.status, 'open');
});
t('外部可上报不挂任务的问题(如资金)', () => {
  const s = act(L.seed(), { type: 'REPORT_ISSUE', p: 'C', role: 'supplier', kind: '资金', text: '货款周转紧张' });
  const i = proj(s, 'C').issues[0]; eq(i.t, null); eq(i.kind, '资金'); eq(i.affected.length, 0);
});
t('越权:外部不能上报别人任务上的问题', () => {
  const s = L.seed(); eq(act(s, { type: 'REPORT_ISSUE', p: 'C', t: 4, role: 'supplier', kind: '其他', text: 'x' }), s);
});
t('负责人直接关闭问题:相关人收到通知', () => {
  let s = act(reported(), { type: 'CLOSE_ISSUE', p: 'C', issue: 'i1', text: '电话解决了', date: '2026-06-17' });
  const p = proj(s, 'C'); eq(p.issues[0].status, 'closed'); eq(p.tasks[3].promised, '2026-06-17');
});
t('选方案(旧流程)也会关闭问题', () => {
  let s = reported();
  s = act(s, { type: 'PROPOSE', p: 'C', t: 3, role: 'supplier', options: [{ text: '等原厂', impact: '晚7天', deadline: '2026-06-20', newDate: '2026-06-20' }] });
  s = act(s, { type: 'CHOOSE', p: 'C', dec: 'd1', opt: 'o1' });
  eq(proj(s, 'C').issues[0].status, 'closed'); eq(proj(s, 'C').tasks[3].promised, '2026-06-20');
});
t('任务完成后,未关闭的问题自动关闭', () => {
  let s = reported();
  s = act(s, { type: 'REPORT_DONE', p: 'C', t: 3, role: 'supplier' }); s = act(s, { type: 'CONFIRM_DONE', p: 'C', t: 3 });
  eq(proj(s, 'C').issues[0].status, 'closed');
});
t('已读:只标自己的消息', () => {
  let s = reported(); s = act(s, { type: 'MSG_READ', p: 'C', role: 'builder' });
  eq(proj(s, 'C').msgs.filter(x => x.to === 'builder')[0].read, true);
});
t('旧状态(没有 issues 字段)不会报错', () => {
  const s = L.seed(); delete proj(s, 'A').issues; delete proj(s, 'A').msgs;
  sum(s, 'A'); act(s, { type: 'ADVANCE_DAY', n: 1 });
});


// ---------- 新建项目 ----------
const mk = (o) => act(L.seed(), Object.assign({ type: 'CREATE_PROJECT', name: 'D 商场', customer: '某商场', target: '陈总', total: 200, pcts: [30, 50, 10, 10] }, o || {}));
t('新建项目:多出一个项目,旧项目不变', () => {
  const s0 = L.seed(), s = mk(); eq(s.projects.length, 4); eq(proj(s, 'A').name, proj(s0, 'A').name);
  eq(s.projects[3].name, 'D 商场'); eq(s.projects[3].id, 'P4');
});
t('新建项目:付款金额按比例算,累计比例正确', () => {
  const p = mk().projects[3]; eq(p.payments.map(x => x.amount).join(','), '60,100,20,20'); eq(p.payments.map(x => x.cum).join(','), '30,80,90,100');
});
t('新建项目:比例不等于 100 不能建', () => { const s = L.seed(); eq(mk({ pcts: [30, 50, 10, 5] }).projects.length, 3); });
t('新建项目:缺名称/金额为 0/负数/比例为小数,都不能建', () => {
  eq(mk({ name: '  ' }).projects.length, 3); eq(mk({ total: 0 }).projects.length, 3); eq(mk({ total: -5 }).projects.length, 3); eq(mk({ pcts: [30.5, 49.5, 10, 10] }).projects.length, 3);
});
t('新建项目:验收款设为 0 就没有这一笔', () => { eq(mk({ pcts: [30, 60, 0, 10] }).projects[3].payments.length, 3); });
t('新建项目:能算出首页那句话,第一步卡在负责人手上,没有假数据', () => {
  const s = mk(), x = sum(s, 'P4'); if (!x.line1 && !x.line3) throw new Error('空'); eq(proj(s, 'P4').tasks[1].done, false);
  eq(sum(s, 'P4').D.T[1].ready, true);
});
t('新建项目后:走第一步,任务 2 才轮到客户', () => {
  let s = mk(); eq(sum(s, 'P4').D.T[2].ready, false);
  s = act(s, { type: 'OWNER_DONE', p: 'P4', t: 1 }); eq(sum(s, 'P4').D.T[2].ready, true);
});
t('新建项目:同一个新项目里可以上报问题,不影响别的项目', () => {
  let s = mk(); s = act(s, { type: 'OWNER_ISSUE', p: 'P4', kind: '资金', text: '客户要求延后付款' });
  eq(proj(s, 'P4').issues.length, 1); eq((proj(s, 'C').issues || []).length, 0);
});
t('新建项目:连建两个,编号不重复', () => { const s = act(mk(), { type: 'CREATE_PROJECT', name: 'E', customer: 'x', target: 'y', total: 10, pcts: [30, 50, 10, 10] }); eq(s.projects[4].id, 'P5'); });

// ---------- 催办 ----------
const assigned = () => act(reported(), { type: 'ASSIGN_ISSUE', p: 'C', issue: 'i1', assignee: 'supplier' });
t('催办:被指派的人收到提醒,时间线有记录', () => {
  let s = act(assigned(), { type: 'ADVANCE_DAY', n: 2 }); s = act(s, { type: 'NUDGE_ISSUE', p: 'C', issue: 'i1' });
  const p = proj(s, 'C'); eq(p.issues[0].nudges, 1);
  const m = p.msgs.filter(x => x.to === 'supplier').pop(); if (!/提醒/.test(m.text) || !/2 天/.test(m.text)) throw new Error(m.text);
});
t('催办:同一天只能催一次,过一天可以再催', () => {
  let s = act(assigned(), { type: 'NUDGE_ISSUE', p: 'C', issue: 'i1' });
  const again = act(s, { type: 'NUDGE_ISSUE', p: 'C', issue: 'i1' }); eq(again, s);
  s = act(s, { type: 'ADVANCE_DAY', n: 1 }); s = act(s, { type: 'NUDGE_ISSUE', p: 'C', issue: 'i1' }); eq(proj(s, 'C').issues[0].nudges, 2);
});
t('催办:没指派、已回复、外部角色发起,都不行', () => {
  const s0 = reported(); eq(act(s0, { type: 'NUDGE_ISSUE', p: 'C', issue: 'i1' }), s0);
  const s1 = assigned(); eq(act(s1, { type: 'NUDGE_ISSUE', p: 'C', issue: 'i1', role: 'supplier' }), s1);
  const s2 = act(s1, { type: 'ISSUE_REPLY', p: 'C', issue: 'i1', role: 'supplier', text: '好' }); eq(act(s2, { type: 'NUDGE_ISSUE', p: 'C', issue: 'i1' }), s2);
});

// ---------- 催款记录 ----------
const dun = (s, o) => act(s, Object.assign({ type: 'DUN_PAY', p: 'B', pay: 'p3', channel: '微信', note: '说本周处理', promise: '2026-06-20' }, o || {}));
t('催款记录:逾期款能记,记下对象/方式/承诺日', () => {
  const s = dun(L.seed()), pay = proj(s, 'B').payments.find(x => x.id === 'p3');
  eq(pay.duns.length, 1); eq(pay.duns[0].channel, '微信'); eq(pay.duns[0].promise, '2026-06-20'); eq(pay.duns[0].to, proj(s, 'B').target);
});
t('催款记录:首页那句话带上"已催几次、对方承诺哪天"', () => {
  const s = dun(L.seed()); const x = sum(s, 'B'); if (!/已催 1 次/.test(x.line2) || !/6\/20/.test(x.line2)) throw new Error(x.line2);
  if (!/等到 6\/20/.test(x.line3)) throw new Error(x.line3);
});
t('催款记录:承诺日过了还没到账,提示再催', () => {
  let s = dun(L.seed()); s = act(s, { type: 'ADVANCE_DAY', n: 8 }); const x = sum(s, 'B'); if (!/再催/.test(x.line3)) throw new Error(x.line3);
});
t('催款记录:不能记已收的、触发任务没完成的、外部角色、未知方式、过去的承诺日', () => {
  const s = L.seed();
  eq(dun(s, { pay: 'p1' }), s);            // 已收
  eq(dun(s, { pay: 'p4' }), s);            // 质保任务没完成
  eq(dun(s, { role: 'customer' }), s);
  eq(dun(s, { channel: '短信轰炸' }), s);
  eq(dun(s, { promise: '2026-06-01' }), s);
});
t('催款记录:可以不填承诺日,记两次累加', () => {
  let s = dun(L.seed(), { promise: null }); s = dun(s, { channel: '电话' }); eq(proj(s, 'B').payments.find(x => x.id === 'p3').duns.length, 2);
});
t('催款记录:到账后不能再记', () => { let s = act(L.seed(), { type: 'RECORD_PAY', p: 'B', pay: 'p3' }); eq(dun(s), s); });

// ---------- 我的待办(对方自己看到,不用催) ----------
const rem = (s, id) => L.reminders(proj(s, id), s.today);
t('待办:前置完成、没约日期的外部任务,出现在对方待办里', () => {
  const r = rem(L.seed(), 'C'); if (!r.length) throw new Error('空');
  r.forEach(x => { if (x.role === 'owner') throw new Error('不该给负责人'); });
});
t('待办:前置没完成的任务不提醒', () => {
  const s = mk(); eq(rem(s, 'P4').length, 0);
});
t('待办:约定日临近分档:明天到期/今天到期/已逾期', () => {
  let s = L.seed(); const p = proj(s, 'C'); const open = L.TASKS.find(d => d.holder !== 'owner' && L.derive(p, s.today).T[d.id].ready && !L.derive(p, s.today).T[d.id].done);
  const set = n => { const x = L.seed(); const q = proj(x, 'C'); q.tasks[open.id].promised = L.addDays(x.today, n); return rem(x, 'C').find(r => r.t === open.id); };
  eq(set(1).kind, 'soon'); eq(set(0).kind, 'today'); eq(set(-2).kind, 'late'); eq(set(-2).days, -2); eq(set(5), undefined);
});
t('待办:已报完成、在等你确认的,不再提醒对方', () => {
  const x = L.seed(); const q = proj(x, 'C'); const d = L.TASKS.find(d => d.holder !== 'owner' && L.derive(q, x.today).T[d.id].ready && !L.derive(q, x.today).T[d.id].done);
  q.tasks[d.id].promised = L.addDays(x.today, -1); q.tasks[d.id].reportedDone = x.today;
  eq(rem(x, 'C').find(r => r.t === d.id), undefined);
});
t('待办:负责人自己的任务不提醒', () => { L.seed().projects.forEach(p => rem(L.seed(), p.id).forEach(r => { if (r.role === 'owner') throw new Error('x'); })); });
console.log('\n' + pass + ' 通过, ' + fail + ' 失败'); process.exit(fail ? 1 : 0);
