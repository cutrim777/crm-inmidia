import crypto from 'crypto'
import { NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { parseAppSecrets } from '@/lib/whatsapp/webhook-signature'
import { paraFormatoMeta, type WahaEvento } from '@/lib/whatsapp/waha-convert'
import { segredoDaPonteConfere } from '@/lib/whatsapp/ponte-auth'
import { withBase } from '@/lib/base-path'
import { WAHA_PREFIXO, idCurto, telefoneDe } from '@/lib/whatsapp/waha'
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation'
import { textoDaMensagem } from '@/lib/whatsapp/waha-convert'

/**
 * In Mídia: porta de entrada do WhatsApp por QR code.
 *
 * A ponte (Empresas/In Mídia/crm-whatsapp) manda cada evento para cá com o
 * cabeçalho x-crm-segredo, no formato de evento do WAHA. A mensagem é
 * traduzida para o formato da Meta, assinada com o META_APP_SECRET e
 * entregue em /api/whatsapp/webhook, que já sabe criar contato, conversa,
 * mensagem, rodar automação e responder com IA.
 *
 * O telefone de quem manda já vem resolvido pela ponte (inclusive os
 * contatos que o WhatsApp esconde atrás de um código @lid).
 */
export const maxDuration = 60

async function entregar(origem: string, corpoMeta: Record<string, unknown>) {
  const segredo = parseAppSecrets(process.env.META_APP_SECRET)[0]
  if (!segredo) {
    console.error('[waha] META_APP_SECRET ausente: não dá para entregar a mensagem ao CRM')
    return
  }
  const bruto = JSON.stringify(corpoMeta)
  const assinatura = 'sha256=' + crypto.createHmac('sha256', segredo).update(bruto).digest('hex')
  const r = await fetch(`${origem}${withBase('/api/whatsapp/webhook')}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': assinatura },
    body: bruto,
  })
  if (!r.ok) console.error('[waha] entrega ao webhook falhou:', r.status, await r.text().catch(() => ''))
}

/**
 * Mensagem que o dono do número mandou pelo celular (ou pelo WhatsApp do
 * computador), fora do CRM. Entra na conversa como mensagem da equipe,
 * para o histórico ficar inteiro.
 */
async function registrarMinha(ev: WahaEvento) {
  const p = (ev.payload ?? {}) as Record<string, unknown>
  const id = typeof p.id === 'string' ? idCurto(p.id) : null
  const para = typeof p.to === 'string' ? telefoneDe(p.to) : ''
  if (!ev.session || !id || !para) return
  const db = supabaseAdmin()
  const { data: config } = await db
    .from('whatsapp_config')
    .select('account_id')
    .eq('phone_number_id', `${WAHA_PREFIXO}${ev.session}`)
    .maybeSingle()
  if (!config) return
  const { data: ja } = await db.from('messages').select('id').eq('message_id', id).limit(1)
  if (ja?.length) return

  const { conversationId } = await resolveConversationByPhone(db, config.account_id as string, `+${para}`)
  const quando = typeof p.timestamp === 'number' ? new Date(p.timestamp * 1000).toISOString() : new Date().toISOString()
  const texto = textoDaMensagem(p)
  const { error } = await db.from('messages').insert({
    conversation_id: conversationId,
    sender_type: 'agent',
    content_type: 'text',
    content_text: texto,
    message_id: id,
    status: 'sent',
    created_at: quando,
  })
  if (error) {
    console.error('[waha] mensagem do celular não foi gravada:', error.message)
    return
  }
  // só mexe no "última mensagem" se esta for mais nova
  await db
    .from('conversations')
    .update({ last_message_text: texto, last_message_at: quando, updated_at: new Date().toISOString() })
    .eq('id', conversationId)
    .or(`last_message_at.is.null,last_message_at.lt.${quando}`)
}

export async function POST(request: Request) {
  if (!segredoDaPonteConfere(request.headers.get('x-crm-segredo'))) {
    return NextResponse.json({ erro: 'não autorizado' }, { status: 401 })
  }
  let ev: WahaEvento
  try {
    ev = await request.json()
  } catch {
    return NextResponse.json({ erro: 'corpo inválido' }, { status: 400 })
  }
  const origem = new URL(request.url).origin

  after(async () => {
    try {
      if (ev.event === 'message.own') {
        await registrarMinha(ev)
        return
      }
      // a ponte pode reenviar o mesmo evento se a rede falhar: não duplica
      const id = typeof ev.payload?.id === 'string' ? ev.payload.id : null
      if (ev.event === 'message' && id) {
        const { data: ja } = await supabaseAdmin().from('messages').select('id').eq('message_id', id).limit(1)
        if (ja?.length) return
      }
      const corpo = paraFormatoMeta(ev)
      if (corpo) await entregar(origem, corpo)
    } catch (e) {
      console.error('[waha] erro ao processar evento:', e)
    }
  })

  return NextResponse.json({ ok: true })
}
