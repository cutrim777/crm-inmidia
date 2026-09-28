import crypto from 'crypto'
import { NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { parseAppSecrets } from '@/lib/whatsapp/webhook-signature'
import { paraFormatoMeta, type WahaEvento } from '@/lib/whatsapp/waha-convert'
import { segredoDaPonteConfere } from '@/lib/whatsapp/ponte-auth'
import { withBase } from '@/lib/base-path'

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
