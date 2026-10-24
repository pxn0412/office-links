// 运行: node test-v4.js
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '负责人页面-v4.html'), 'utf8');
const m = /\/\*LOGIC_START\*\/([\s\S]*?)\/\*LOGIC_END\*\//.exec(html);
const L = new Function(m[1] + '; return Logic;')();
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('ok   ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n     ' + e.message); } }
function eq(a, b, msg) { if (a !== b) throw new Error((msg || '') + ' 期望 ' + JSON.stringify(b) + ' 实际 ' + JSON.stringify(a)); }
const proj = (s, id) => s.projects.find(p => p.id === id);
const sum = (s, id) => L.summarize(proj(s, id), s.today);
const st = (s, id, n) => sum(s, id).D.T[n].status;
const act = (s, a) => L.reduce(s, a);

t('初始:A 酒店任务 3 晚 3 天,卡住', () => {
  const s = L.seed(); eq(st(s, 'A', 3), 'blocked'); eq(sum(s, 'A').D.T[3].late, 3);
});
t('任务 5 到货核验 及后续 6-10 标受影响', () => {
  const s = L.seed(); [5, 6, 7, 8, 9].forEach(n => eq(st(s, 'A', n), 'affected', '任务' + n));
});
t('任务 4 已完成不受影响', () => { eq(st(L.seed(), 'A', 4), 'done'); });
t('到货款与验收款标受影响,不可催', () => {
  const s = L.seed(); const pays = sum(s, 'A').pays;
  eq(pays.find(x => x.pay.id === 'p2').state, 'affected'); eq(pays.find(x => x.pay.id === 'p3').state, 'affected');
});
t('定金已收', () => { eq(sum(L.seed(), 'A').pays.find(x => x.pay.id === 'p1').state, 'received'); });
t('那句话包含 发生了什么 / 卡在谁手上 / 会拖住什么 / 下一步', () => {
  const x = sum(L.seed(), 'A');
  if (!/晚 3 天/.test(x.line1)) throw new Error(x.line1);
  if (!/供应商/.test(x.line1)) throw new Error(x.line1);
  if (!/到货核验/.test(x.line2) || !/到货款/.test(x.line2)) throw new Error(x.line2);
  if (!/^下一步/.test(x.line3)) throw new Error(x.line3);
});
t('B 工厂:验收款逾期 5 天,催决策领导', () => {
  const x = sum(L.seed(), 'B'); eq(x.level, 2);
  if (!/逾期|已到期 5 天/.test(x.line1)) throw new Error(x.line1);
  if (!/李总\(决策领导\)/.test(x.line2)) throw new Error(x.line2);
});
t('C 学校正常,level 0', () => { eq(sum(L.seed(), 'C').level, 0); });
t('对方改期但负责人没确认:正式日期不变,显示待确认', () => {
  let s = act(L.seed(), { type: 'REPORT_DATE', p: 'A', t: 3, role: 'supplier', date: '2026-06-20' });
  const tk = proj(s, 'A').tasks[3]; eq(tk.promised, '2026-06-10'); eq(tk.pending.date, '2026-06-20'); eq(tk.changes, 0);
});
t('确认改期:原约定保留,改期次数 +1,历史完整', () => {
  let s = act(L.seed(), { type: 'REPORT_DATE', p: 'A', t: 3, role: 'supplier', date: '2026-06-20' });
  s = act(s, { type: 'CONFIRM_DATE', p: 'A', t: 3 });
  const tk = proj(s, 'A').tasks[3]; eq(tk.original, '2026-06-10'); eq(tk.promised, '2026-06-20'); eq(tk.changes, 1);
  eq(tk.history.join(','), '2026-06-10,2026-06-20'); eq(st(s, 'A', 3), 'doing');
});
t('改期三次:原约定、各次新约定、次数都可见', () => {
  let s = L.seed();
  ['2026-06-20', '2026-06-25', '2026-06-30'].forEach(d => {
    s = act(s, { type: 'REPORT_DATE', p: 'A', t: 3, role: 'supplier', date: d }); s = act(s, { type: 'CONFIRM_DATE', p: 'A', t: 3 });
  });
  const tk = proj(s, 'A').tasks[3]; eq(tk.changes, 3); eq(tk.original, '2026-06-10'); eq(tk.history.length, 4);
});
t('改期晚于后续任务约定:后续标日期冲突', () => {
  let s = act(L.seed(), { type: 'REPORT_DATE', p: 'A', t: 3, role: 'supplier', date: '2026-06-20' });
  s = act(s, { type: 'CONFIRM_DATE', p: 'A', t: 3 });
  const D = sum(s, 'A').D;
  eq(D.T[5].conflict, true, '任务5(6/12)早于 6/20'); eq(D.T[6].conflict, true);
});
t('日期冲突算要处理的事,首页不能显示进度正常', () => {
  let s = act(L.seed(), { type: 'REPORT_DATE', p: 'A', t: 3, role: 'supplier', date: '2026-06-20' });
  s = act(s, { type: 'CONFIRM_DATE', p: 'A', t: 3 });
  const x = sum(s, 'A'); eq(x.level >= 1, true);
  if (!x.items.some(i => i.kind === 'resched' && i.t === 5)) throw new Error('应有任务5的重新约');
  if (/进度正常/.test(x.line1)) throw new Error(x.line1);
});
t('确认前预览:如果属实会冲突的任务与付款', () => {
  const s = act(L.seed(), { type: 'REPORT_DATE', p: 'A', t: 3, role: 'supplier', date: '2026-06-25' });
  const im = L.pendingImpact(proj(s, 'A'), 3, s.today);
  if (!im.conflicts.includes(5)) throw new Error('应含任务5');
  if (!im.pays.some(x => x.id === 'p2')) throw new Error('到货款应受影响(6/20 < 6/25)');
});
t('任务没约定日期:未约定时间,不判断卡不卡', () => {
  const s = L.seed(); const c = sum(s, 'A').D.T[10]; eq(c.nodate, true); if (!/未约定时间/.test(L.statusLabel(c))) throw new Error(L.statusLabel(c)); eq(c.blocked, false);
});
t('对方报完成:待你确认,不是已完成', () => {
  let s = act(L.seed(), { type: 'REPORT_DONE', p: 'A', t: 3, role: 'supplier' });
  const c = sum(s, 'A').D.T[3]; eq(c.done, false); eq(c.pendingConfirm, true); eq(L.statusLabel(c), '待你确认');
});
t('确认完成后下游恢复,到货款不再受影响', () => {
  let s = act(L.seed(), { type: 'REPORT_DONE', p: 'A', t: 3, role: 'supplier' });
  s = act(s, { type: 'CONFIRM_DONE', p: 'A', t: 3 });
  eq(st(s, 'A', 3), 'done');
  // 任务 5 约定 6/12 已过且前置完成 -> 它自己卡住
  eq(st(s, 'A', 5), 'blocked');
});
t('退回完成报告:回到未完成', () => {
  let s = act(L.seed(), { type: 'REPORT_DONE', p: 'A', t: 3, role: 'supplier' });
  s = act(s, { type: 'REJECT_DONE', p: 'A', t: 3 }); eq(proj(s, 'A').tasks[3].reportedDone, null); eq(st(s, 'A', 3), 'blocked');
});
t('付款绑定的任务没完成:不能记到账', () => {
  const s = act(L.seed(), { type: 'RECORD_PAY', p: 'A', pay: 'p2' }); eq(proj(s, 'A').payments.find(x => x.id === 'p2').received, null);
});
t('任务完成后可记到账', () => {
  const s = act(L.seed(), { type: 'RECORD_PAY', p: 'B', pay: 'p3' }); eq(proj(s, 'B').payments.find(x => x.id === 'p3').received, s.today);
});
t('外部角色只能改自己名下的任务', () => {
  const s = L.seed();
  const r = act(s, { type: 'REPORT_DONE', p: 'A', t: 3, role: 'customer' }); eq(r, s);
  const r2 = act(s, { type: 'REPORT_DONE', p: 'A', t: 1, role: 'supplier' }); eq(r2, s);
});
t('外部不能标负责人的任务', () => {
  const s = L.seed(); const r = act(s, { type: 'REPORT_DONE', p: 'A', t: 6, role: 'builder' }); eq(r, s);
});
t('有问题:任务卡住,问题人可见', () => {
  let s = act(L.seed(), { type: 'REPORT_PROBLEM', p: 'C', t: 3, role: 'supplier', reason: '工厂停产' });
  eq(st(s, 'C', 3), 'blocked'); eq(sum(s, 'C').level, 3);
});
t('提出方案后进入待决策,选择后记录并更新日期', () => {
  let s = act(L.seed(), { type: 'REPORT_PROBLEM', p: 'A', t: 3, role: 'supplier', reason: '工厂延期' });
  s = act(s, { type: 'PROPOSE', p: 'A', t: 3, role: 'supplier', options: [
    { text: '等原供应商', impact: '晚 7 天', deadline: '2026-06-16', newDate: '2026-06-20' },
    { text: '换现货供应商', impact: '多花 2 万', deadline: '2026-06-14', newDate: '2026-06-16' }] });
  const dec = proj(s, 'A').decisions[0];
  if (!/选一个/.test(sum(s, 'A').line3)) throw new Error(sum(s, 'A').line3);
  s = act(s, { type: 'CHOOSE', p: 'A', dec: dec.id, opt: 'o2' });
  const tk = proj(s, 'A').tasks[3];
  eq(proj(s, 'A').decisions[0].chosen, 'o2'); eq(tk.promised, '2026-06-16'); eq(tk.original, '2026-06-10'); eq(tk.changes, 1); eq(tk.problem, null);
});
t('超过最晚决定日的方案不能选', () => {
  let s = act(L.seed(), { type: 'REPORT_PROBLEM', p: 'A', t: 3, role: 'supplier', reason: 'x' });
  s = act(s, { type: 'PROPOSE', p: 'A', t: 3, role: 'supplier', options: [{ text: '甲', deadline: '2026-06-12', newDate: '2026-06-20' }] });
  const before = s; s = act(s, { type: 'CHOOSE', p: 'A', dec: proj(s, 'A').decisions[0].id, opt: 'o1' }); eq(s, before);
});
t('推进一天:任务 4 之外 C 学校任务 4 到期当天提醒', () => {
  let s = act(L.seed(), { type: 'ADVANCE_DAY', n: 1 }); eq(s.today, '2026-06-14'); eq(sum(s, 'C').D.T[4].dueToday, true);
});
t('推进到过期:C 学校任务 4 变卡住', () => {
  let s = act(L.seed(), { type: 'ADVANCE_DAY', n: 2 }); eq(st(s, 'C', 4), 'blocked');
});
t('代录:记录标明代录', () => {
  const s = act(L.seed(), { type: 'REPORT_DONE', p: 'A', t: 3, role: 'supplier', proxy: true });
  const e = proj(s, 'A').log[0]; eq(e.proxy, true); if (!/代录/.test(e.who)) throw new Error(e.who);
});
t('依赖关系:任务 6 依赖 4 和 5,共 10 个任务', () => {
  eq(L.TASKS.length, 10); eq(L.TASKS[5].deps.join(','), '4,5');
});
t('下游:任务 3 的所有下游共 7 个(5-10 与不含 4)', () => {
  eq(L.dependents(3).sort((a, b) => a - b).join(','), '5,6,7,8,9,10');
});
t('任务 4 先完成,任务 5 未完成时开工确认不会进行中', () => {
  const s = L.seed(); eq(sum(s, 'A').D.T[6].ready, false);
});

console.log('\n' + pass + ' 通过, ' + fail + ' 失败'); process.exit(fail ? 1 : 0);
