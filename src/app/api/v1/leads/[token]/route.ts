import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  findOrCreateContact,
  resolveAuditUserId,
  ContactError,
} from '@/lib/api/v1/contacts';
import { resolveImportTagIds } from '@/lib/contacts/resolve-import-tags';
import { addContactTagAndDispatch } from '@/lib/contacts/tag-events';
import { addContactTagIfAbsent } from '@/lib/contacts/tag-write';
import {
  HONEYPOT,
  notaDoLead,
  separaCampos,
  telefoneInternacional,
} from '@/lib/leads/intake';

/**
 * In Mídia: entrada pública de leads dos formulários de site.
 *
 *   POST /crm/api/v1/leads/<token>
 *   JSON, x-www-form-urlencoded ou multipart. Campos livres.
 *
 * O token (tabela lead_sources) diz de qual conta e de qual formulário
 * o lead é. Ele só cria: não lê nem apaga nada, então pode ficar no
 * HTML do site. Proteções (revisão de segurança de 28/09/2026):
 *   - só aceita navegador vindo dos sites da fonte (allowed_origins);
 *   - limite de envios no banco, por IP e por formulário;
 *   - corpo pequeno e com poucos campos;
 *   - a resposta é a mesma para contato novo e antigo (não revela quem
 *     já é cliente);
 *   - contato que já existia ganha nota e etiqueta, mas sem disparar
 *     automação (ninguém usa o formulário para mandar WhatsApp a
 *     números alheios).
 */

const LIMITE_IP_10MIN = 5;
const LIMITE_FONTE_1H = 300;
const CORPO_MAX = 16 * 1024;
const CAMPOS_MAX = 40;

const cabecalhosCors = (origem: string | null): Record<string, string> =>
  origem
    ? {
        'Access-Control-Allow-Origin': origem,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'content-type',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      }
    : { Vary: 'Origin' };

type Fonte = {
  id: string;
  account_id: string;
  name: string;
  tags: string[];
  pipeline_stage_id: string | null;
  active: boolean;
  allowed_origins: string[];
};

const tokenValido = (t: string) => /^[A-Za-z0-9_-]{16,80}$/.test(t);

async function buscaFonte(token: string): Promise<Fonte | null> {
  if (!tokenValido(token)) return null;
  const { data } = await supabaseAdmin()
    .from('lead_sources')
    .select('id, account_id, name, tags, pipeline_stage_id, active, allowed_origins')
    .eq('token', token)
    .maybeSingle();
  return data && data.active ? (data as Fonte) : null;
}

/** Origem liberada para esta fonte? Sem Origin (n8n, Make, curl) passa. */
function origemLiberada(fonte: Fonte, origem: string | null): boolean {
  if (!origem) return true;
  const lista = fonte.allowed_origins ?? [];
  return lista.length === 0 || lista.includes(origem);
}

export async function OPTIONS(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const origem = request.headers.get('origin');
  const fonte = await buscaFonte(token);
  // sem o Allow-Origin o navegador nem envia o POST
  const libera = fonte && origemLiberada(fonte, origem) ? origem : null;
  return new NextResponse(null, { status: 204, headers: cabecalhosCors(libera) });
}

async function leCorpo(request: Request): Promise<Record<string, unknown> | null | 'grande'> {
  const tamanho = Number(request.headers.get('content-length') ?? 0);
  if (tamanho > CORPO_MAX) return 'grande';
  const tipo = request.headers.get('content-type') ?? '';
  let bruto: string;
  try {
    bruto = await request.text();
  } catch {
    return null;
  }
  if (bruto.length > CORPO_MAX) return 'grande';
  if (!bruto) return null;
  try {
    if (tipo.includes('application/x-www-form-urlencoded')) {
      return Object.fromEntries(new URLSearchParams(bruto));
    }
    if (tipo.includes('multipart/form-data')) {
      const f = await new Response(bruto, { headers: { 'content-type': tipo } }).formData();
      const out: Record<string, unknown> = {};
      for (const [k, v] of f.entries()) if (typeof v === 'string') out[k] = v;
      return out;
    }
    const j = JSON.parse(bruto);
    return j && typeof j === 'object' && !Array.isArray(j) ? j : null;
  } catch {
    return null;
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const origem = request.headers.get('origin');
  const responde = (dados: object, status = 200, libera: string | null = null) =>
    NextResponse.json(dados, { status, headers: { ...cabecalhosCors(libera), 'Cache-Control': 'no-store' } });

  const fonte = await buscaFonte(token);
  if (!fonte) return responde({ ok: false, erro: 'formulário não encontrado' }, 404);
  if (!origemLiberada(fonte, origem)) return responde({ ok: false, erro: 'site não autorizado' }, 403);
  const libera = origem;

  const corpo = await leCorpo(request);
  if (corpo === 'grande') return responde({ ok: false, erro: 'envio grande demais' }, 413, libera);
  if (!corpo) return responde({ ok: false, erro: 'envio vazio ou ilegível' }, 400, libera);
  if (Object.keys(corpo).length > CAMPOS_MAX) return responde({ ok: false, erro: 'campos demais' }, 400, libera);

  // robô preenche o campo escondido; finge que deu certo e não grava
  if (HONEYPOT.some((k) => typeof corpo[k] === 'string' && (corpo[k] as string).trim())) {
    return responde({ ok: true }, 200, libera);
  }

  const campos = separaCampos(corpo);
  const phone = telefoneInternacional(campos.phone);
  if (!phone) return responde({ ok: false, erro: 'telefone inválido' }, 400, libera);

  const db = supabaseAdmin();

  // limite de envios guardado no banco (vale para todas as cópias do servidor)
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'sem-ip';
  const ipHash = crypto.createHash('sha256').update(`${ip}|${fonte.id}`).digest('hex').slice(0, 32);
  const { data: liberado, error: erroLimite } = await db.rpc('registrar_envio_lead', {
    p_source: fonte.id,
    p_ip_hash: ipHash,
    p_limite_ip: LIMITE_IP_10MIN,
    p_limite_fonte: LIMITE_FONTE_1H,
  });
  if (erroLimite) console.error('[api/v1/leads] limite:', erroLimite.message);
  if (liberado === false) {
    return responde({ ok: false, erro: 'muitos envios, tente de novo em alguns minutos' }, 429, libera);
  }

  try {
    const accountId = fonte.account_id;
    const auditUserId = await resolveAuditUserId(db, accountId);

    const { id: contactId, created } = await findOrCreateContact(db, accountId, auditUserId, {
      phone,
      name: campos.name ?? undefined,
      email: campos.email ?? undefined,
      company: campos.company ?? undefined,
    });

    // etiquetas: soma às que o contato já tem (nunca apaga as antigas).
    // Automação de etiqueta só dispara para contato NOVO.
    const nomes = [...new Set([...(fonte.tags ?? []), 'Formulário'])];
    const { tagIdByKey } = await resolveImportTagIds(db, {
      accountId,
      userId: auditUserId,
      tagNames: nomes,
      canCreateTags: true,
    });
    const { data: atuais } = await db.from('contact_tags').select('tag_id').eq('contact_id', contactId);
    const jaTem = new Set((atuais ?? []).map((r) => r.tag_id as string));
    for (const nome of nomes) {
      const tagId = tagIdByKey.get(nome.trim().toLowerCase());
      if (!tagId || jaTem.has(tagId)) continue;
      if (created) {
        await addContactTagAndDispatch({ db, accountId, contactId, tagId });
      } else {
        await addContactTagIfAbsent(db, { accountId, contactId, tagId });
      }
    }

    const pagina = request.headers.get('referer');
    await db.from('contact_notes').insert({
      account_id: accountId,
      contact_id: contactId,
      user_id: auditUserId,
      note_text: notaDoLead(fonte.name, campos, pagina),
    });

    // card no funil: só etapa de funil da MESMA conta, e só se o contato
    // ainda não tiver card aberto nesse funil
    if (fonte.pipeline_stage_id) {
      const { data: etapa } = await db
        .from('pipeline_stages')
        .select('id, pipeline_id, pipelines!inner(account_id)')
        .eq('id', fonte.pipeline_stage_id)
        .eq('pipelines.account_id', accountId)
        .maybeSingle();
      if (etapa) {
        const { data: aberto } = await db
          .from('deals')
          .select('id')
          .eq('contact_id', contactId)
          .eq('pipeline_id', etapa.pipeline_id)
          .eq('status', 'open')
          .limit(1);
        if (!aberto?.length) {
          const { data: conta } = await db
            .from('accounts')
            .select('default_currency')
            .eq('id', accountId)
            .maybeSingle();
          await db.from('deals').insert({
            account_id: accountId,
            user_id: auditUserId,
            pipeline_id: etapa.pipeline_id,
            stage_id: etapa.id,
            contact_id: contactId,
            title: `${campos.name ?? phone} · ${fonte.name}`,
            currency: (conta?.default_currency as string | undefined) ?? 'BRL',
          });
        }
      }
    }

    await db.rpc('bump_lead_source', { p_id: fonte.id });
    // mesma resposta para contato novo e antigo
    return responde({ ok: true }, 200, libera);
  } catch (err) {
    if (err instanceof ContactError && err.status === 400) {
      return responde({ ok: false, erro: 'telefone inválido' }, 400, libera);
    }
    console.error('[api/v1/leads] falhou:', err);
    return responde({ ok: false, erro: 'não foi possível registrar o lead' }, 500, libera);
  }
}
