// Função única do Vercel: todas as rotas /api/* chegam aqui (ver vercel.json).
import { createHub } from '../lib/core.js';
import { sqlStore } from '../lib/store.js';

let hub = null;
async function getHub() {
  if (hub) return hub;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error('Banco de dados não configurado (DATABASE_URL).');
  hub = createHub({ store: await sqlStore(url), env: process.env });
  return hub;
}

export default {
  async fetch(request) {
    try { return await (await getHub())(request); }
    catch (e) { return new Response(JSON.stringify({ ok: false, why: 'config', msg: e.message }), { status: 500, headers: { 'content-type': 'application/json' } }); }
  }
};
