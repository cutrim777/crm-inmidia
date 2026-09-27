# CRM In Mídia

Cópia do **wacrm** (github.com/ArnasDon/wacrm, licença MIT) no GitHub da In
Mídia: **github.com/cutrim777/crm-inmidia**. Next.js na Vercel, Supabase como
banco e login, conector MCP para o Claude.

Endereço: `crm.inmidia.space`. O site leva `inmidia.space/crm` para lá.

## Onde fica cada coisa

| O quê | Onde no CRM |
|---|---|
| Números e gráficos | **Painel**: conversas por dia, tempo de resposta, valor do funil |
| Funil em colunas | **Funis**: cada etapa é uma coluna, arrasta o card |
| Contatos | **Contatos**: etiquetas, campos próprios, importar CSV |
| WhatsApp | **Caixa de entrada** (API oficial da Meta; ver abaixo) |
| Disparos | **Disparos**: só com modelo aprovado pela Meta |
| Automações | **Automações** e **Fluxos**: gatilho por mensagem, contato novo, palavra |
| IA | **Configurações > IA**: chave da Anthropic, respostas sugeridas e base de conhecimento |
| Receber lead | **Configurações > Chaves de API**: `POST /api/v1/contacts` |
| Claude | `docs/mcp.md`: pacote `wacrm-mcp` com a chave de API |

**Cada cliente** é uma conta própria: cria login, convida a equipe dele em
Configurações > Equipe. Um não vê o outro.

## Variáveis na Vercel

Conectar o Supabase pela integração da Vercel preenche as três primeiras.

| Variável | De onde vem |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase > Project Settings > API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | idem |
| `SUPABASE_SERVICE_ROLE_KEY` | idem (secreta) |
| `ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `NEXT_PUBLIC_APP_LOCALE` | `pt` |
| `NEXT_PUBLIC_SITE_URL` | `https://crm.inmidia.space` |
| `META_APP_SECRET` | só quando ligar o WhatsApp oficial |

## Banco

As tabelas estão em `supabase/migrations/` (001 a 034), em ordem.

## Testes

```bash
TZ=UTC npm test
```

Sem `TZ=UTC`, dois testes de dia da semana falham no fuso de Brasília. É do
teste, não do sistema, e acontece igual no projeto original.

## WhatsApp sem API oficial

O wacrm só fala com a API oficial da Meta. Para número por QR code (sem API
oficial), o caminho é o WAHA num servidor, mandando mensagem para o CRM pela
API. O kit de servidor está em `../crm-twenty-vps/` (WAHA + ponte) e pode ser
reaproveitado.

## Receber atualizações do projeto original

```bash
git remote add original https://github.com/ArnasDon/wacrm.git
git fetch original && git merge original/main
```
