// Armazenamento do servidor: Postgres (Neon) em produção, memória nos testes.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS pw_config (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pw_users (
     email TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'piloto',
     pass_hash TEXT, cap_usd DOUBLE PRECISION, active BOOLEAN NOT NULL DEFAULT TRUE,
     fails INTEGER NOT NULL DEFAULT 0, locked_until TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_login TIMESTAMPTZ)`,
  `CREATE TABLE IF NOT EXISTS pw_usage (
     id BIGSERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(), email TEXT NOT NULL, kind TEXT NOT NULL,
     model TEXT, in_tokens INTEGER NOT NULL DEFAULT 0, out_tokens INTEGER NOT NULL DEFAULT 0, cost DOUBLE PRECISION NOT NULL DEFAULT 0,
     ok BOOLEAN NOT NULL DEFAULT TRUE, error TEXT, track TEXT, car TEXT, session_kind TEXT, app_version TEXT, summary TEXT, symptoms TEXT)`,
  `CREATE INDEX IF NOT EXISTS pw_usage_at ON pw_usage (at)`,
  `ALTER TABLE pw_usage ADD COLUMN IF NOT EXISTS text_hash TEXT`,
  `ALTER TABLE pw_usage ADD COLUMN IF NOT EXISTS result TEXT`
];
const USER_COLS = ['name', 'role', 'pass_hash', 'cap_usd', 'active', 'fails', 'locked_until', 'last_login'];

export async function sqlStore(url) {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(url);
  return sqlStoreFrom((text, params = []) => sql.query(text, params));
}
// q(texto, parâmetros) devolve as linhas; usado com o Neon em produção e com o PGlite nos testes
export function sqlStoreFrom(q) {
  let ready = null;
  const init = () => (ready = ready || (async () => { for (const s of SCHEMA) await q(s); })());
  return {
    init,
    async getConfig(k) { await init(); const r = await q('SELECT v FROM pw_config WHERE k=$1', [k]); return r[0] ? r[0].v : null; },
    async setConfig(k, v) { await init(); await q('INSERT INTO pw_config (k,v) VALUES ($1,$2) ON CONFLICT (k) DO UPDATE SET v=EXCLUDED.v', [k, String(v)]); },
    async getUser(email) { await init(); const r = await q('SELECT * FROM pw_users WHERE email=$1', [email]); return r[0] || null; },
    async listUsers() { await init(); return q("SELECT email,name,role,cap_usd,active,created_at,last_login,(pass_hash IS NOT NULL) AS has_password FROM pw_users ORDER BY (role = 'master') DESC, name, email"); },
    async addUser(u) { await init(); await q('INSERT INTO pw_users (email,name,role,cap_usd) VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, cap_usd=EXCLUDED.cap_usd, active=TRUE', [u.email, u.name || '', u.role || 'piloto', u.cap_usd == null ? null : u.cap_usd]); },
    async updateUser(email, patch) {
      await init(); const keys = Object.keys(patch).filter((k) => USER_COLS.includes(k)); if (!keys.length) return;
      await q(`UPDATE pw_users SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(', ')} WHERE email=$1`, [email, ...keys.map((k) => patch[k])]);
    },
    async deleteUser(email) { await init(); await q('DELETE FROM pw_users WHERE email=$1', [email]); },
    async addUsage(u) { await init(); await q('INSERT INTO pw_usage (email,kind,model,in_tokens,out_tokens,cost,ok,error,track,car,session_kind,app_version,summary,symptoms,text_hash,result) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)', [u.email, u.kind, u.model || null, u.in_tokens || 0, u.out_tokens || 0, u.cost || 0, u.ok !== false, u.error || null, u.track || null, u.car || null, u.session_kind || null, u.app_version || null, u.summary || null, u.symptoms || null, u.text_hash || null, u.result || null]); },
    async recentResult(email, hash, since) { await init(); const r = await q('SELECT result FROM pw_usage WHERE email=$1 AND text_hash=$2 AND ok AND result IS NOT NULL AND at >= $3 ORDER BY at DESC LIMIT 1', [email, hash, since.toISOString()]); return r[0] ? r[0].result : null; },
    async usageBetween(from, to) { await init(); return q('SELECT * FROM pw_usage WHERE at >= $1 AND at < $2 ORDER BY at DESC', [from.toISOString(), to.toISOString()]); },
    async spendBetween(from, to, email) { await init(); const r = email ? await q('SELECT COALESCE(SUM(cost),0) AS s FROM pw_usage WHERE at >= $1 AND at < $2 AND email=$3', [from.toISOString(), to.toISOString(), email]) : await q('SELECT COALESCE(SUM(cost),0) AS s FROM pw_usage WHERE at >= $1 AND at < $2', [from.toISOString(), to.toISOString()]); return Number(r[0].s) || 0; }
  };
}

export function memoryStore() {
  const cfg = new Map(), users = new Map(), usage = []; let id = 0;
  return {
    async init() {},
    async getConfig(k) { return cfg.has(k) ? cfg.get(k) : null; },
    async setConfig(k, v) { cfg.set(k, String(v)); },
    async getUser(email) { const u = users.get(email); return u ? { ...u } : null; },
    async listUsers() { return [...users.values()].map(({ pass_hash, fails, locked_until, ...u }) => ({ ...u, has_password: !!pass_hash })); },
    async addUser(u) { const o = users.get(u.email); users.set(u.email, { email: u.email, name: u.name || '', role: (o && o.role) || u.role || 'piloto', pass_hash: o ? o.pass_hash : null, cap_usd: u.cap_usd == null ? null : u.cap_usd, active: true, fails: 0, locked_until: null, created_at: o ? o.created_at : new Date(), last_login: o ? o.last_login : null }); },
    async updateUser(email, patch) { const u = users.get(email); if (!u) return; for (const k of Object.keys(patch)) if (USER_COLS.includes(k)) u[k] = patch[k]; },
    async deleteUser(email) { users.delete(email); },
    async addUsage(u) { usage.push({ id: ++id, at: u.at || new Date(), ok: u.ok !== false, in_tokens: 0, out_tokens: 0, cost: 0, ...u }); },
    async recentResult(email, hash, since) { const r = usage.filter((x) => x.email === email && x.text_hash === hash && x.ok && x.result && x.at >= since).sort((a, b) => b.at - a.at)[0]; return r ? r.result : null; },
    async usageBetween(from, to) { return usage.filter((x) => x.at >= from && x.at < to).sort((a, b) => b.at - a.at); },
    async spendBetween(from, to, email) { return usage.filter((x) => x.at >= from && x.at < to && (!email || x.email === email)).reduce((s, x) => s + (x.cost || 0), 0); }
  };
}
