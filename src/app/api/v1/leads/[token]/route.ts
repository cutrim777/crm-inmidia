import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  findOrCreateContact,
  resolveAuditUserId,
  ContactError,
} from '@/lib/api/v1/contacts';
import { resolveImportTagIds } from '@/lib/contacts/resolve-import-tags';
import { addContactTagAndDispatch } from '@/lib/contacts/tag-events';
import { checkRateLimit } from '@/lib/rate-limit';
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
 * HTML do site. Etiqueta adicionada dispara as automações de etiqueta.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Max-Age': '86400',
};

const responde = (dados: object, status = 200) =>
  NextResponse.json(dados, { status, headers: { ...CORS, 'Cache-Control': 'no-store' } });

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

async function leCorpo(request: Request): Promise<Record<string, unknown> | null> {
  const tipo = request.headers.get('content-type') ?? '';
  try {
    if (tipo.includes('application/json')) {
      const j = await request.json();
      return j && typeof j === 'object' && !Array.isArray(j) ? j : null;
    }
    if (tipo.includes('form')) {
      const f = await request.formData();
      const out: Record<string, unknown> = {};
      for (const [k, v] of f.entries()) if (typeof v === 'string') out[k] = v;
      return out;
    }
    // sem content-type (sendBeacon com texto): tenta JSON
    const t = await request.text();
    return t ? JSON.parse(t) : null;
  } catch {
    return null;
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(token)) return responde({ ok: false, erro: 'formulário não encontrado' }, 404);

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'sem-ip';
  const limite = checkRateLimit(`lead:${token}:${ip}`, { limit: 20, windowMs: 10 * 60 * 1000 });
  if (!limite.success) return responde({ ok: false, erro: 'muitos envios, tente de novo em alguns minutos' }, 429);

  const corpo = await leCorpo(request);
  if (!corpo) return responde({ ok: false, erro: 'envio vazio ou ilegível' }, 400);

  // robô preenche o campo escondido; finge que deu certo e não grava
  if (HONEYPOT.some((k) => typeof corpo[k] === 'string' && (corpo[k] as string).trim())) {
    return responde({ ok: true });
  }

  const db = supabaseAdmin();
  const { data: fonte } = await db
    .from('lead_sources')
    .select('id, account_id, name, tags, pipeline_stage_id, active')
    .eq('token', token)
    .maybeSingle();
  if (!fonte || !fonte.active) return responde({ ok: false, erro: 'formulário não encontrado' }, 404);

  const campos = separaCampos(corpo);
  const phone = telefoneInternacional(campos.phone);
  if (!phone) return responde({ ok: false, erro: 'telefone inválido' }, 400);

  try {
    const accountId = fonte.account_id as string;
    const auditUserId = await resolveAuditUserId(db, accountId);

    const { id: contactId, created } = await findOrCreateContact(db, accountId, auditUserId, {
      phone,
      name: campos.name ?? undefined,
      email: campos.email ?? undefined,
      company: campos.company ?? undefined,
    });

    // etiquetas: soma às que o contato já tem (nunca apaga as antigas)
    const nomes = [...new Set([...(fonte.tags as string[]), 'Formulário'])];
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
      if (tagId && !jaTem.has(tagId)) {
        await addContactTagAndDispatch({ db, accountId, contactId, tagId });
      }
    }

    const pagina = request.headers.get('referer');
    await db.from('contact_notes').insert({
      account_id: accountId,
      contact_id: contactId,
      user_id: auditUserId,
      note_text: notaDoLead(fonte.name as string, campos, pagina),
    });

    // card no funil, se a fonte tiver etapa e o contato ainda não estiver nesse funil
    if (fonte.pipeline_stage_id) {
      const { data: etapa } = await db
        .from('pipeline_stages')
        .select('id, pipeline_id')
        .eq('id', fonte.pipeline_stage_id)
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
          await db.from('deals').insert({
            account_id: accountId,
            user_id: auditUserId,
            pipeline_id: etapa.pipeline_id,
            stage_id: etapa.id,
            contact_id: contactId,
            title: `${campos.name ?? phone} · ${fonte.name}`,
          });
        }
      }
    }

    await db.rpc('bump_lead_source', { p_id: fonte.id });
    return responde({ ok: true, novo: created }, created ? 201 : 200);
  } catch (err) {
    if (err instanceof ContactError && err.status === 400) {
      return responde({ ok: false, erro: 'telefone inválido' }, 400);
    }
    console.error('[api/v1/leads] falhou:', err);
    return responde({ ok: false, erro: 'não foi possível registrar o lead' }, 500);
  }
}
