import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { encrypt } from '@/lib/whatsapp/encryption'
import {
  WAHA_PREFIXO,
  WahaError,
  desconectarSessao,
  iniciarSessao,
  qrDaSessao,
  sessaoDaConta,
  statusDaSessao,
} from '@/lib/whatsapp/waha'
import { withBase } from '@/lib/base-path'

/**
 * In Mídia: botão "Conectar por QR code" de Configurações > WhatsApp.
 *
 *   POST   liga a sessão da conta no WAHA e grava a conexão no CRM
 *   GET    situação da sessão e, enquanto não conecta, o QR code
 *   DELETE desconecta o número
 *
 * A chave do WAHA fica só no servidor; o navegador nunca vê.
 */

function urlDoWebhook(request: Request): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, '') || new URL(request.url).origin + withBase('')
  return `${base}/api/whatsapp/waha/webhook`
}

function erro(e: unknown) {
  if (e instanceof WahaError) return NextResponse.json({ erro: e.message }, { status: 502 })
  return toErrorResponse(e)
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const segredo = process.env.WAHA_WEBHOOK_SECRET
    if (!segredo) return NextResponse.json({ erro: 'WAHA_WEBHOOK_SECRET não configurado no servidor.' }, { status: 500 })
    const sessao = sessaoDaConta(ctx.accountId)
    await iniciarSessao(sessao, urlDoWebhook(request), segredo)

    const db = supabaseAdmin()
    const linha = {
      phone_number_id: `${WAHA_PREFIXO}${sessao}`,
      waba_id: null,
      // o envio pelo WAHA usa a chave do servidor; este campo só precisa existir
      access_token: encrypt('waha'),
      status: 'disconnected',
    }
    const { data: atual } = await db.from('whatsapp_config').select('id').eq('account_id', ctx.accountId).maybeSingle()
    const { error } = atual
      ? await db.from('whatsapp_config').update(linha).eq('id', atual.id)
      : await db.from('whatsapp_config').insert({ account_id: ctx.accountId, user_id: ctx.userId, ...linha })
    if (error) {
      console.error('[waha/conectar] gravar config:', error)
      return NextResponse.json({ erro: 'Não foi possível salvar a conexão.' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, sessao })
  } catch (e) {
    return erro(e)
  }
}

export async function GET() {
  try {
    const ctx = await requireRole('admin')
    const sessao = sessaoDaConta(ctx.accountId)
    const st = await statusDaSessao(sessao)
    if (!st) return NextResponse.json({ status: 'NAO_INICIADA' })
    if (st.status === 'WORKING') {
      await supabaseAdmin()
        .from('whatsapp_config')
        .update({ status: 'connected', connected_at: new Date().toISOString() })
        .eq('account_id', ctx.accountId)
        .eq('phone_number_id', `${WAHA_PREFIXO}${sessao}`)
      return NextResponse.json({ status: 'WORKING', numero: st.me?.id?.split('@')[0] ?? null, nome: st.me?.pushName ?? null })
    }
    if (st.status === 'SCAN_QR_CODE') {
      return NextResponse.json({ status: st.status, qr: await qrDaSessao(sessao) })
    }
    return NextResponse.json({ status: st.status })
  } catch (e) {
    return erro(e)
  }
}

export async function DELETE() {
  try {
    const ctx = await requireRole('admin')
    const sessao = sessaoDaConta(ctx.accountId)
    await desconectarSessao(sessao)
    await supabaseAdmin()
      .from('whatsapp_config')
      .update({ status: 'disconnected' })
      .eq('account_id', ctx.accountId)
      .eq('phone_number_id', `${WAHA_PREFIXO}${sessao}`)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return erro(e)
  }
}
