// 运行: node server.js [端口]   不需要安装任何依赖
// 负责人页面: http://<本机地址>:端口/?k=<负责人密钥>   (启动时会打印)
// 对方手机页: 负责人页面项目页里的"发给对方的链接"
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || Number(process.argv[2]) || 3000;
const DIR = __dirname;
const DATA = process.env.DATA_FILE || path.join(DIR, 'data.json');
// 公开演示模式(DEMO=1):链接和密钥固定,首页是入口页,任何人都能进来试。只放模拟数据。
const DEMO = process.env.DEMO === '1';
const DEMO_KEY = 'demo-owner';

// 逻辑只有一份:直接从负责人页面里取出来用
const html = fs.readFileSync(path.join(DIR, '负责人页面-v4.html'), 'utf8');
const L = new Function(/\/\*LOGIC_START\*\/([\s\S]*?)\/\*LOGIC_END\*\//.exec(html)[1] + '; return Logic;')();

// ---------- 存储 ----------
let db;
function newTokens(state) {
  const tokens = {};
  state.projects.forEach(p => ['supplier', 'builder', 'customer'].forEach(r => { tokens[DEMO ? 'demo' + p.id + r : crypto.randomBytes(9).toString('hex')] = { p: p.id, role: r }; }));
  return tokens;
}
// 新建项目后,给新项目补发链接(已有项目的链接不变)
function addMissingTokens(state) {
  state.projects.forEach(p => {
    if (Object.keys(db.tokens).some(t => db.tokens[t].p === p.id)) return;
    ['supplier', 'builder', 'customer'].forEach(r => { db.tokens[crypto.randomBytes(9).toString('hex')] = { p: p.id, role: r }; });
  });
}
function load() {
  try { db = JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch (e) { db = null; }
  if (DEMO && db && db.ownerKey !== DEMO_KEY) db = null;   // 公开演示只用固定密钥,旧的随机密钥不沿用
  if (!db || !db.state) {
    const state = L.seed();
    db = { rev: 1, ownerKey: DEMO ? DEMO_KEY : crypto.randomBytes(8).toString('hex'), state, tokens: newTokens(state) };
    save();
  }
}
function save() { try { fs.writeFileSync(DATA, JSON.stringify(db)); } catch (e) { /* 云上磁盘不可写时只保留在内存里 */ } }

// ---------- 工具 ----------
function send(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); }
function sendHtml(res, text) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(text); }
function body(req) {
  return new Promise((ok, no) => {
    let s = ''; req.on('data', c => { s += c; if (s.length > 100000) { no(new Error('too big')); req.destroy(); } });
    req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { no(e); } });
  });
}
const isOwner = req => req.headers['x-key'] === db.ownerKey;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 100);
const date = v => (typeof v === 'string' && DATE.test(v) ? v : null);

// ---------- 对方看到的内容(只含自己的事,不含金额) ----------
function mobileView(tk) {
  const p = db.state.projects.find(x => x.id === tk.p);
  const D = L.derive(p, db.state.today);
  const tasks = L.TASKS.filter(d => d.parties.includes(tk.role)).map(d => D.T[d.id])
    .filter(c => !c.done && (c.ready || c.s.problem))
    .map(c => ({
      id: c.def.id, name: c.def.name, deliver: c.def.deliver,
      promised: c.s.promised, status: c.status, label: L.statusLabel(c), late: c.late,
      reported: !!c.s.reportedDone, pendingDate: c.s.pending ? c.s.pending.date : null,
      problem: c.s.problem ? c.s.problem.reason : null, canPropose: !!c.s.problem && !c.dec, waitingChoice: !!c.dec
    }));
  const done = L.TASKS.filter(d => d.parties.includes(tk.role)).map(d => D.T[d.id]).filter(c => c.done).map(c => c.def.name);
  const issues = L.issuesOf(p);
  const tname = i => (i.t ? L.TASK_BY_ID[i.t].name : '项目');
  const msgs = (p.msgs || []).filter(m => m.to === tk.role).slice(-8).reverse().map(m => ({ id: m.id, text: m.text, at: m.at, read: m.read }));
  // 派给我处理的问题(要回复)
  const assigned = issues.filter(i => i.status === 'assigned' && i.assignee === tk.role).map(i => ({ id: i.id, task: tname(i), kind: i.kind, text: i.text, note: i.note, by: i.by === 'owner' ? '负责人' : L.ROLE[i.by] }));
  // 我报的问题进展
  const mine = issues.filter(i => i.by === tk.role && i.status !== 'closed').map(i => ({ id: i.id, task: tname(i), text: i.text, status: L.ISSUE_LABEL[i.status], assignee: i.assignee ? L.ROLE[i.assignee] : null }));
  const myTasks = L.TASKS.filter(d => d.parties.includes(tk.role)).map(d => ({ id: d.id, name: d.name }));
  const LBL = { late: '已逾期', today: '今天到期', soon: '明天到期', ask: '请填完成日' };
  const ORD = { late: 0, today: 1, soon: 2, ask: 3 };
  const todo = L.reminders(p, db.state.today).filter(r => r.role === tk.role).sort((a, b) => ORD[a.kind] - ORD[b.kind])
    .map(r => ({ t: r.t, name: L.TASK_BY_ID[r.t].name, kind: r.kind, label: LBL[r.kind], days: r.days }));
  return { project: p.name, role: L.ROLE[tk.role], today: db.state.today, todo, tasks, done, msgs, assigned, mine, myTasks, kinds: L.KINDS };
}

// ---------- 路由 ----------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;

    if (DEMO && req.method === 'GET' && p === '/' && !url.searchParams.get('k')) return sendHtml(res, landing());
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) return sendHtml(res, fs.readFileSync(path.join(DIR, '负责人页面-v4.html'), 'utf8'));
    if (req.method === 'GET' && /^\/m\/\w+$/.test(p)) return sendHtml(res, workbench());

    // 负责人接口
    if (p === '/api/state' && req.method === 'GET') {
      if (!isOwner(req)) return send(res, 401, { error: '需要负责人密钥:用启动时打印的地址打开' });
      return send(res, 200, { rev: db.rev, state: db.state });
    }
    if (p === '/api/links' && req.method === 'GET') {
      if (!isOwner(req)) return send(res, 401, {});
      const links = {};
      Object.keys(db.tokens).forEach(t => { const x = db.tokens[t]; (links[x.p] = links[x.p] || {})[x.role] = t; });
      const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0];
      return send(res, 200, { base: proto + '://' + req.headers.host, links });
    }
    if (p === '/api/act' && req.method === 'POST') {
      if (!isOwner(req)) return send(res, 401, {});
      const a = await body(req);
      const before = db.state;
      const next = L.reduce(before, a);
      if (next === before) return send(res, 200, { ok: false });
      db.state = next; db.rev++;
      if (a.type === 'RESET') db.tokens = newTokens(next);
      else addMissingTokens(next);
      save();
      return send(res, 200, { ok: true, rev: db.rev, state: db.state });
    }

    // 对方接口:项目和身份只看链接,不信任页面传来的
    const m = /^\/api\/m\/(\w+)(\/act)?$/.exec(p);
    if (m) {
      const tk = db.tokens[m[1]];
      if (!tk) return send(res, 404, { error: '链接无效或已失效' });
      if (!m[2] && req.method === 'GET') return send(res, 200, mobileView(tk));
      if (m[2] && req.method === 'POST') {
        const b = await body(req);
        const t = Number(b.t);
        const a = { p: tk.p, t, role: tk.role, proxy: false };
        if (b.type === 'done') a.type = 'REPORT_DONE';
        else if (b.type === 'date') { a.type = 'REPORT_DATE'; a.date = date(b.date); }
        else if (b.type === 'problem') { a.type = 'REPORT_PROBLEM'; a.reason = text(b.reason, 100); }
        else if (b.type === 'issue') {
          a.type = 'REPORT_ISSUE'; a.t = t ? t : null; a.kind = text(b.kind, 10); a.text = text(b.text, 100);
        } else if (b.type === 'reply') {
          a.type = 'ISSUE_REPLY'; a.issue = text(b.issue, 10); a.text = text(b.text, 100); a.date = date(b.date);
        } else if (b.type === 'read') a.type = 'MSG_READ';
        else if (b.type === 'propose') {
          a.type = 'PROPOSE';
          a.options = (Array.isArray(b.options) ? b.options : []).slice(0, 3).map(o => ({ text: text(o.text, 60), impact: text(o.impact, 60), deadline: date(o.deadline), newDate: date(o.newDate) }));
        } else return send(res, 400, { ok: false });
        const before = db.state;
        const next = L.reduce(before, a);
        if (next === before) return send(res, 200, { ok: false, error: '现在不能这样操作' });
        db.state = next; db.rev++; save();
        return send(res, 200, { ok: true, view: mobileView(tk) });
      }
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 400, { error: '请求有误' });
  }
});

// ---------- 公开演示的入口页(只在 DEMO=1 时出现) ----------
function landing() {
  return fs.readFileSync(path.join(DIR, '入口页.html'), 'utf8').replace('__KEY__', DEMO_KEY);
}

// ---------- 对方的工作台(电脑和手机都能用,页面在 工作台.html) ----------
const workbench = () => fs.readFileSync(path.join(DIR, '工作台.html'), 'utf8');

load();
server.listen(PORT, '0.0.0.0', () => {
  console.log('已启动,端口 ' + PORT + '。数据存在 data.json');
  console.log('负责人页面: http://localhost:' + PORT + '/?k=' + db.ownerKey);
  console.log('手机和电脑要在同一个 wifi。把上面地址里的 localhost 换成本机地址即可,例如 192.168.x.x');
  console.log('注意:没有加密,只适合演示;负责人密钥不要发给别人。');
});
