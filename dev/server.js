// Servidor local para testes: banco em memória e IA simulada (ou real, se ANTHROPIC_API_KEY estiver definido e MOCK_AI=0).
import http from 'node:http';
import { createHub } from '../lib/core.js';
import { memoryStore } from '../lib/store.js';

const mockFetch = async (url, opt) => {
  const b = JSON.parse(opt.body); const txt = b.messages[0].content;
  return { ok: true, status: 200, json: async () => ({ usage: { input_tokens: 2600, output_tokens: 450 }, content: [{ type: 'tool_use', name: 'registrar_leitura', input: {
    resumo: 'Frente preguiçosa no turn-in das curvas 3, 4 e 5 e leve subesterço na 7.',
    sintomas: [{ sym: 'entry_us', curvas: [3, 4, 5], intensidade: 'moderado', citacao: txt.slice(txt.indexOf('<texto>') + 7, txt.indexOf('<texto>') + 60), explicacao: 'Simulado.' }],
    perguntas: [], outros: [] } }] }) };
};
export function start(port = Number(process.env.PORT || 8787), env = {}) {
  const real = process.env.ANTHROPIC_API_KEY && process.env.MOCK_AI === '0';
  const handle = createHub({ store: memoryStore(), env: { MASTER_EMAIL: 'master@teste.local', ANTHROPIC_API_KEY: real ? process.env.ANTHROPIC_API_KEY : 'mock', ...env }, fetchImpl: real ? fetch : mockFetch });
  const srv = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await handle(new Request('http://localhost' + req.url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }));
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
  });
  return new Promise((ok) => srv.listen(port, '127.0.0.1', () => ok(srv)));
}
if (import.meta.url === `file://${process.argv[1]}`) start().then(() => console.log('hub local em http://127.0.0.1:' + (process.env.PORT || 8787)));
