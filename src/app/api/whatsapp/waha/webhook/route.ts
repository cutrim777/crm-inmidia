import crypto from 'crypto'
import { NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { parseAppSecrets } from '@/lib/whatsapp/webhook-signature'
import { paraFormatoMeta, remetenteComTelefone, type WahaEvento } from '@/lib/whatsapp/waha-convert'
import { WAHA_PREFIXO, waha, telefoneDe } from '@/lib/whatsapp/waha'
import { withBase } from '@/lib/base-path'

/**
 * In Mídia: porta de entrada do WhatsApp por QR code (WAHA).
 *
 * O WAHA manda cada evento para cá com o cabeçalho x-crm-segredo. A
 * mensagem é traduzida para o formato da Meta, assinada com o
 * META_APP_SECRET e entregue em /api/whatsapp/webhook, que já sabe
 * criar contato, conversa, mensagem, rodar automação e responder com IA.
 */
export const maxDuration = 60

function segredoConfere(recebido: string | null): boolean {
  const esperado = process.env.WAHA_WEBHOOK_SECRET
  if (!esperado || !recebido) return false
  const a = Buffer.from(recebido)
  const b = Buffer.from(esperado)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** Remetente @lid sem número no evento: pergunta ao WAHA. */
async function resolverLid(sessao: string, de: string): Promise<string | null> {
  try {
    const r = await waha<{ pn?: string | null }>('GET', `/api/${encodeURIComponent(sessao)}/lids/${encodeURIComponent(de.split('@')[0])}`)
    return r.pn ? telefoneDe(r.pn) : null
  } catch {
    return null
  }
}

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
  if (!segredoConfere(request.headers.get('x-crm-segredo'))) {
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
      if (ev.event === 'session.status' && ev.session) {
        const st = String((ev.payload as { status?: string } | undefined)?.status ?? '')
        const status = st === 'WORKING' ? 'connected' : st === 'STOPPED' || st === 'FAILED' ? 'disconnected' : null
        if (status) {
          await supabaseAdmin()
            .from('whatsapp_config')
            .update({ status, ...(status === 'connected' ? { connected_at: new Date().toISOString() } : {}) })
            .eq('phone_number_id', `${WAHA_PREFIXO}${ev.session}`)
        }
        return
      }

      let telefone: string | null = null
      if (ev.event === 'message' && ev.session && ev.payload) {
        const p = ev.payload
        const de = typeof p.from === 'string' ? p.from : ''
        if (!p.fromMe && de.endsWith('@lid') && !remetenteComTelefone(p)) {
          telefone = await resolverLid(ev.session, de)
          if (!telefone) console.warn('[waha] remetente @lid sem número, mensagem ignorada:', p.id)
        }
      }

      const corpo = paraFormatoMeta(ev, telefone)
      if (corpo) await entregar(origem, corpo)
    } catch (e) {
      console.error('[waha] erro ao processar evento:', e)
    }
  })

  return NextResponse.json({ ok: true })
}
