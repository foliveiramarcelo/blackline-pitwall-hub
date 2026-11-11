# Blackline Pitwall Hub

Servidor da equipe Blackline Motorsport para o app Blackline Pitwall:

- contas por e-mail e senha (só e-mails liberados pelo administrador);
- leitura das impressões do piloto pela IA (Claude Sonnet 5.5) na conta do administrador, com teto mensal;
- registro de uso e relatório visível só para o administrador (MASTER_EMAIL).

## Implantação (Vercel)

1. Importe este repositório em vercel.com (Add New → Project). Não precisa mudar nada no build.
2. Em Storage (ou Marketplace), crie um banco **Neon Postgres** e conecte ao projeto. Ele cria a variável `DATABASE_URL`.
3. Em Settings → Environment Variables, crie:
   - `ANTHROPIC_API_KEY`: chave da API da Anthropic (platform.claude.com → API Keys);
   - `MASTER_EMAIL`: e-mail do administrador;
   - opcionais: `CAP_USD` (teto mensal inicial, padrão 15) e `AI_MODEL` (padrão `claude-sonnet-5-5`).
4. Faça o deploy e abra `https://<projeto>.vercel.app/api/health`. Deve responder `{"ok":true,...,"ai":true}`.

As tabelas são criadas sozinhas no primeiro acesso. O segredo dos tokens é gerado e guardado no banco.

## Rotas

`POST /api/auth/register` · `POST /api/auth/login` · `GET /api/me` · `POST /api/ai/impressions` ·
`GET /api/admin/report?month=AAAA-MM` · `GET|POST|DELETE /api/admin/users` · `POST /api/admin/settings` (admin só para o master).

## Testes locais

`npm install && npm test` (banco em memória e IA simulada).
