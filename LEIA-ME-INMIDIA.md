# CRM In Mídia

Cópia do **wacrm** (github.com/ArnasDon/wacrm, licença MIT) no GitHub da In
Mídia: **github.com/cutrim777/crm-inmidia**. Next.js na Vercel, Supabase como
banco e login, conector MCP para o Claude.

Endereço: **www.inmidia.space/crm** (login em `/crm/login`).

Como funciona: o CRM é o projeto `crm-inmidia` na Vercel, publicado com
`NEXT_PUBLIC_BASE_PATH=/crm`. O site (projeto `inmidia`) repassa tudo o que
começa com `/crm` para ele, pela regra no `vercel.json` do site. Para quem
usa, é um endereço só.

Todo `git push` na `main` publica o CRM sozinho.

Banco: Supabase `hfozbvdgwcgpuqyrfmfb` (org crm-inmidia). As 42 migrações do
original + `043_inmidia_fecha_funcoes.sql` já estão aplicadas.

## Onde fica cada coisa

| O quê | Onde no CRM |
|---|---|
| Números e gráficos | **Painel**: conversas por dia, tempo de resposta, valor do funil |
| Funil em colunas | **Funis**: cada etapa é uma coluna, arrasta o card |
| Contatos | **Contatos**: etiquetas, campos próprios, importar CSV |
| WhatsApp | **Caixa de entrada**. Número conectado por QR code em Configurações > WhatsApp, pela ponte (`../crm-whatsapp`) |
| Disparos | **Disparos**: só com modelo aprovado pela Meta |
| Automações | **Automações** e **Fluxos**: gatilho por mensagem, contato novo, palavra |
| IA | **Configurações > IA**: chave da Anthropic, respostas sugeridas e base de conhecimento |
| Receber lead | **Configurações > Chaves de API**: `POST /api/v1/contacts` |
| Claude | `docs/mcp.md`: pacote `wacrm-mcp` com a chave de API |

**Cada cliente** é uma conta própria: cria login, convida a equipe dele em
Configurações > Equipe. Um não vê o outro.

## Variáveis na Vercel

Todas já estão na Vercel, menos `SUPABASE_SERVICE_ROLE_KEY`, que o Matheus cola (é a chave mestra do banco).

| Variável | De onde vem |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase > Project Settings > API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | idem |
| `SUPABASE_SERVICE_ROLE_KEY` | idem (secreta) |
| `ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `NEXT_PUBLIC_APP_LOCALE` | `pt` |
| `NEXT_PUBLIC_BASE_PATH` | `/crm` |
| `NEXT_PUBLIC_SITE_URL` | `https://www.inmidia.space/crm` |
| `META_APP_SECRET` | segredo aleatório: assina o repasse das mensagens da ponte |
| `WAHA_WEBHOOK_SECRET` | senha da ponte do WhatsApp (igual ao `PONTE_SEGREDO` do `.env` da ponte) |
| `NEXT_PUBLIC_WHATSAPP_PROVIDER` | `waha`: WhatsApp por QR code em vez da API oficial |

## Banco

As tabelas estão em `supabase/migrations/` (001 a 043), em ordem.

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

## Formulários ligados ao CRM

Cada formulário tem uma fonte na tabela `lead_sources` (token público, só
cria lead). A rota é `POST /crm/api/v1/leads/<token>`: aceita JSON ou
formulário comum, entende nome/telefone/whatsapp/email/empresa em vários
nomes, completa o +55, não duplica contato, põe as etiquetas da fonte,
guarda o resto numa nota e abre card na etapa "Novo lead" do funil.

| Formulário | Onde está o envio | Funil |
|---|---|---|
| In Mídia /consultoria, /aulagratis, /clinicasmedicas, /ia, /iaclinicas | `site/src/lib/crm.ts` + cada formulário | Funil de vendas In Mídia |
| Santiago Freire (home) | `clientes/Santiago Freire/index.html`, função `enviarWhatsApp` | Cliente: Santiago Freire |

O envio ao CRM não espera resposta: o formulário segue igual (banco da
Lovable, CAPI, página de obrigado, WhatsApp). Formulários sem telefone
(Mercato, quizzes do Low Ticket) não entram: o CRM exige telefone.

## WhatsApp por QR code (sem API oficial)

O número é conectado por QR code e as mensagens passam pela **ponte**, um
programa em `Empresas/In Mídia/crm-whatsapp` que roda num computador sempre
ligado (hoje o Mac do Matheus). A ponte só faz conexões de saída:

- pergunta o que fazer em `/api/whatsapp/ponte/pendencias` (segura até 20 s);
- conta o estado em `/ponte/estado` e o resultado dos envios em `/ponte/resultado`;
- entrega o que chegou em `/api/whatsapp/waha/webhook` (traduzido para o
  formato da Meta e repassado para `/api/whatsapp/webhook`).

O CRM deixa os envios na tabela `whatsapp_saida` e espera a ponte responder
(até 25 s). Com a ponte desligada, enviar dá erro claro em vez de sumir.
Tabelas: `whatsapp_sessoes`, `whatsapp_saida`, `whatsapp_ponte` (migration 047).
