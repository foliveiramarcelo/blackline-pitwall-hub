// Blackline Pitwall Hub: contas da equipe, IA (Claude) na conta do master e relatório de uso.
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const AIP = require('./ai-prompt.cjs');

const PRICES = { 'claude-sonnet-5-5': [2e-6, 10e-6], 'claude-haiku-5-5': [0.1e-6, 0.5e-6] };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const err = (status, why, msg) => json({ ok: false, why, msg: msg || why }, status);
const normEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e);
const b64u = (b) => Buffer.from(b).toString('base64url');
const monthRange = (m) => { const [y, mo] = (/^\d{4}-\d{2}$/.test(m || '') ? m : new Date().toISOString().slice(0, 7)).split('-').map(Number); return [new Date(Date.UTC(y, mo - 1, 1)), new Date(Date.UTC(y, mo, 1)), `${y}-${String(mo).padStart(2, '0')}`]; };

function hashPass(p) { const salt = crypto.randomBytes(16); const h = crypto.scryptSync(p, salt, 32, { N: 16384, r: 8, p: 1 }); return `s1$${salt.toString('base64')}$${h.toString('base64')}`; }
function checkPass(p, stored) {
  if (!stored || !stored.startsWith('s1$')) return false;
  const [, s, h] = stored.split('$'); const got = crypto.scryptSync(p, Buffer.from(s, 'base64'), 32, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(h, 'base64'); return want.length === got.length && crypto.timingSafeEqual(want, got);
}
const passTag = (ph) => crypto.createHash('sha256').update(String(ph || '')).digest('hex').slice(0, 10);

export function createHub({ store, env = {}, fetchImpl = fetch, now = () => new Date() }) {
  const MASTER = normEmail(env.MASTER_EMAIL);
  const MODEL = env.AI_MODEL || 'claude-sonnet-5-5';
  const DEFAULT_CAP = Number(env.CAP_USD || 15);
  let secret = null;
  async function getSecret() {
    if (secret) return secret;
    let s = await store.getConfig('token_secret');
    if (!s) { s = crypto.randomBytes(32).toString('hex'); await store.setConfig('token_secret', s); s = await store.getConfig('token_secret'); }
    return (secret = s);
  }
  async function sign(user) {
    const p = b64u(JSON.stringify({ e: user.email, h: passTag(user.pass_hash), exp: Date.now() + 60 * 864e5 }));
    return p + '.' + crypto.createHmac('sha256', await getSecret()).update(p).digest('base64url');
  }
  async function auth(req) {
    const m = /^Bearer (.+)$/.exec(req.headers.get('authorization') || ''); if (!m) return null;
    const [p, sig] = m[1].split('.'); if (!p || !sig) return null;
    const want = crypto.createHmac('sha256', await getSecret()).update(p).digest('base64url');
    if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
    let d; try { d = JSON.parse(Buffer.from(p, 'base64url').toString()); } catch (e) { return null; }
    if (!d.exp || d.exp < Date.now()) return null;
    const u = await store.getUser(d.e); if (!u || !u.active || passTag(u.pass_hash) !== d.h) return null;
    return u;
  }
  const isMaster = (u) => u && (u.role === 'master' || (MASTER && u.email === MASTER));
  const pub = (u) => ({ email: u.email, name: u.name, role: isMaster(u) ? 'master' : u.role });
  async function ensureMaster(email) { if (MASTER && email === MASTER) { const u = await store.getUser(email); if (!u) await store.addUser({ email, name: 'Master', role: 'master' }); else if (u.role !== 'master') await store.updateUser(email, { role: 'master' }); } }
  async function body(req, max = 64000) { const t = await req.text(); if (t.length > max) throw Object.assign(new Error('grande demais'), { status: 413 }); try { return t ? JSON.parse(t) : {}; } catch (e) { throw Object.assign(new Error('JSON inválido'), { status: 400 }); } }

  async function register(req) {
    const b = await body(req), email = normEmail(b.email), pass = String(b.password || '');
    if (!validEmail(email)) return err(400, 'email', 'E-mail inválido.');
    if (pass.length < 8) return err(400, 'senha', 'A senha precisa ter pelo menos 8 caracteres.');
    await ensureMaster(email);
    const u = await store.getUser(email);
    if (!u || !u.active) return err(403, 'naoliberado', 'Este e-mail ainda não foi liberado pelo administrador da equipe.');
    if (u.pass_hash) return err(409, 'jacadastrado', 'Este e-mail já tem senha. Use Entrar (ou peça ao administrador para redefinir).');
    const ph = hashPass(pass); const name = String(b.name || u.name || '').slice(0, 60);
    await store.updateUser(email, { pass_hash: ph, name, fails: 0, locked_until: null, last_login: now() });
    const u2 = await store.getUser(email);
    return json({ ok: true, token: await sign(u2), user: pub(u2) });
  }
  async function login(req) {
    const b = await body(req), email = normEmail(b.email), pass = String(b.password || '');
    await ensureMaster(email);
    const u = await store.getUser(email);
    const fail = () => err(401, 'credenciais', 'E-mail ou senha incorretos.');
    if (!u || !u.active) return fail();
    if (!u.pass_hash) return err(409, 'semsenha', 'Primeiro acesso: use Criar senha.');
    if (u.locked_until && new Date(u.locked_until) > now()) return err(429, 'bloqueado', 'Muitas tentativas. Tente de novo em alguns minutos.');
    if (!checkPass(pass, u.pass_hash)) { const f = (u.fails || 0) + 1; await store.updateUser(email, { fails: f, locked_until: f >= 8 ? new Date(now().getTime() + 15 * 60e3) : null }); return fail(); }
    await store.updateUser(email, { fails: 0, locked_until: null, last_login: now() });
    return json({ ok: true, token: await sign(u), user: pub(u) });
  }

  async function capFor(u) {
    const [from, to] = monthRange();
    const cap = Number((await store.getConfig('cap_usd')) || DEFAULT_CAP);
    const total = await store.spendBetween(from, to);
    if (total >= cap) return 'O teto mensal de IA da equipe foi atingido. Fale com o administrador.';
    if (u.cap_usd != null && (await store.spendBetween(from, to, u.email)) >= u.cap_usd) return 'Seu limite mensal de IA foi atingido. Fale com o administrador.';
    const hour = (await store.usageBetween(new Date(now().getTime() - 3600e3), new Date(now().getTime() + 1))).filter((x) => x.email === u.email).length;
    if (hour >= 30) return 'Muitas leituras em pouco tempo. Tente de novo daqui a pouco.';
    return null;
  }
  async function impressions(req, u) {
    const d = await body(req);
    if (!d || !d.text || String(d.text).trim().length < 3) return err(400, 'empty');
    if (!env.ANTHROPIC_API_KEY) return err(503, 'semchave', 'O servidor ainda não tem a chave da IA configurada.');
    const blocked = await capFor(u); if (blocked) return err(402, 'cap', blocked);
    const P = AIP.buildImpressions(d), ctx = d.context || {};
    const log = { email: u.email, kind: 'impressoes', model: MODEL, track: String(ctx.track || '').slice(0, 80), car: String(ctx.car || '').slice(0, 80), session_kind: String(ctx.kind || '').slice(0, 20), app_version: String(d.appVersion || '').slice(0, 20) };
    let res, out;
    try {
      res = await fetchImpl('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: MODEL, max_tokens: P.maxTokens, system: P.system, messages: [{ role: 'user', content: P.user }], tools: [P.tool], tool_choice: { type: 'tool', name: P.tool.name } }), signal: AbortSignal.timeout(45000) });
      out = await res.json().catch(() => ({}));
    } catch (e) { await store.addUsage({ ...log, ok: false, error: 'rede: ' + String(e.message || e).slice(0, 200) }); return err(502, 'api', 'A IA não respondeu agora.'); }
    const usage = out.usage || {}, pr = PRICES[MODEL] || PRICES['claude-sonnet-5-5'], cost = (usage.input_tokens || 0) * pr[0] + (usage.output_tokens || 0) * pr[1];
    if (!res.ok) {
      const raw = ((out.error && out.error.message) || 'HTTP ' + res.status).slice(0, 300);
      console.error('Anthropic', res.status, out.error && out.error.type, raw);
      await store.addUsage({ ...log, ok: false, error: `${res.status} ${raw}`.slice(0, 300), cost, in_tokens: usage.input_tokens, out_tokens: usage.output_tokens });
      const why = /credit balance/i.test(raw) ? 'A conta da API da equipe está sem crédito. O administrador precisa colocar crédito em platform.claude.com (Billing).'
        : res.status === 401 ? 'A chave da API configurada no servidor foi recusada. O administrador precisa conferir a ANTHROPIC_API_KEY na Vercel.'
        : res.status === 403 ? 'A chave da API não tem permissão para este modelo. Confira a conta em platform.claude.com.'
        : res.status === 404 ? 'O modelo de IA configurado não foi encontrado (' + MODEL + ').'
        : res.status === 429 ? 'A IA pediu um intervalo (limite de uso). Tente de novo em alguns segundos.'
        : res.status >= 500 ? 'A IA está instável agora. Tente de novo em instantes.'
        : 'A IA recusou a leitura: ' + raw;
      return err(502, 'api', why);
    }
    const tu = (out.content || []).find((b) => b.type === 'tool_use');
    const result = tu ? AIP.cleanResult(tu.input, P.ids) : null;
    await store.addUsage({ ...log, ok: !!result, error: result ? null : 'sem conteúdo estruturado', cost, in_tokens: usage.input_tokens, out_tokens: usage.output_tokens, summary: result ? String(result.resumo || '').slice(0, 400) : null, symptoms: result ? result.sintomas.map((x) => x.sym).join(',') : null });
    if (!result) return err(502, 'api', 'A IA não respondeu no formato esperado.');
    return json({ ok: true, result, model: MODEL, cost });
  }

  async function report(req) {
    const url = new URL(req.url); const [from, to, month] = monthRange(url.searchParams.get('month'));
    const rows = await store.usageBetween(from, to), users = await store.listUsers();
    const name = (e) => (users.find((u) => u.email === e) || {}).name || e;
    const byUser = {}, byDay = {};
    for (const r of rows) {
      const k = r.email, b = byUser[k] = byUser[k] || { email: k, name: name(k), calls: 0, errors: 0, cost: 0, in_tokens: 0, out_tokens: 0, last: null };
      b.calls++; if (!r.ok) b.errors++; b.cost += Number(r.cost) || 0; b.in_tokens += r.in_tokens || 0; b.out_tokens += r.out_tokens || 0; const at = new Date(r.at); if (!b.last || at > b.last) b.last = at;
      const d = at.toISOString().slice(0, 10), dd = byDay[d] = byDay[d] || { day: d, calls: 0, cost: 0 }; dd.calls++; dd.cost += Number(r.cost) || 0;
    }
    const cap = Number((await store.getConfig('cap_usd')) || DEFAULT_CAP);
    const total = rows.reduce((s, r) => s + (Number(r.cost) || 0), 0);
    return json({ ok: true, month, model: MODEL, cap_usd: cap, total_cost: total, calls: rows.length, errors: rows.filter((r) => !r.ok).length,
      by_user: Object.values(byUser).sort((a, b) => b.cost - a.cost), by_day: Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day)),
      recent: rows.slice(0, 60).map((r) => ({ at: r.at, email: r.email, name: name(r.email), ok: r.ok, error: r.error, cost: Number(r.cost) || 0, track: r.track, car: r.car, session_kind: r.session_kind, summary: r.summary, symptoms: r.symptoms })),
      users });
  }
  async function adminUsers(req) {
    if (req.method === 'GET') return json({ ok: true, users: await store.listUsers() });
    const b = await body(req), email = normEmail(b.email);
    if (req.method === 'DELETE') { if (email === MASTER) return err(400, 'master', 'O master não pode ser removido.'); await store.deleteUser(email); return json({ ok: true, users: await store.listUsers() }); }
    if (!validEmail(email)) return err(400, 'email', 'E-mail inválido.');
    if (b.action === 'reset') { await store.updateUser(email, { pass_hash: null, fails: 0, locked_until: null }); return json({ ok: true, users: await store.listUsers() }); }
    if (b.action === 'toggle') { const u = await store.getUser(email); if (u && email !== MASTER) await store.updateUser(email, { active: !u.active }); return json({ ok: true, users: await store.listUsers() }); }
    const cap = b.cap_usd === '' || b.cap_usd == null ? null : Math.max(0, Math.min(500, Number(b.cap_usd)));
    await store.addUser({ email, name: String(b.name || '').slice(0, 60), cap_usd: cap }); return json({ ok: true, users: await store.listUsers() });
  }
  async function adminSettings(req) { const b = await body(req); if (b.cap_usd != null) await store.setConfig('cap_usd', Math.max(0, Math.min(1000, Number.isFinite(Number(b.cap_usd)) ? Number(b.cap_usd) : DEFAULT_CAP))); return json({ ok: true, cap_usd: Number(await store.getConfig('cap_usd')) }); }

  return async function handle(req) {
    try {
      const path = new URL(req.url).pathname.replace(/\/+$/, '');
      if (path === '/api/health' || path === '/api') return json({ ok: true, service: 'blackline-pitwall-hub', ai: !!env.ANTHROPIC_API_KEY, model: MODEL });
      if (req.method === 'POST' && path === '/api/auth/register') return register(req);
      if (req.method === 'POST' && path === '/api/auth/login') return login(req);
      const u = await auth(req); if (!u) return err(401, 'auth', 'Sessão expirada. Entre de novo.');
      if (req.method === 'GET' && path === '/api/me') { const [from, to] = monthRange(); return json({ ok: true, user: pub(u), month_spend: await store.spendBetween(from, to, u.email), ai: !!env.ANTHROPIC_API_KEY, model: MODEL }); }
      if (req.method === 'POST' && path === '/api/ai/impressions') return impressions(req, u);
      if (path.startsWith('/api/admin/')) {
        if (!isMaster(u)) return err(403, 'master', 'Só o administrador da equipe vê esta área.');
        if (req.method === 'GET' && path === '/api/admin/report') return report(req);
        if (path === '/api/admin/users') return adminUsers(req);
        if (req.method === 'POST' && path === '/api/admin/settings') return adminSettings(req);
      }
      return err(404, 'notfound', 'Rota não encontrada.');
    } catch (e) { return err(e.status || 500, 'server', e.status ? e.message : 'Erro no servidor.'); }
  };
}
