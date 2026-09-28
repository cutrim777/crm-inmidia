import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { encrypt } from '@/lib/whatsapp/encryption'
import {
  WAHA_PREFIXO,
  WahaError,
  desconectarSessao,
  iniciarSessao,
  ponteOnline,
  sessaoDaConta,
  statusDaSessao,
} from '@/lib/whatsapp/waha'

/**
 * In Mídia: botão "Conectar por QR code" de Configurações > WhatsApp.
 *
 *   POST   pede à ponte para ligar o número da conta e grava a conexão
 *   GET    situação: ponte fora do ar, QR code para escanear ou conectado
 *   DELETE pede à ponte para desconectar o número
 *
 * O CRM não fala com a ponte direto: deixa o pedido em whatsapp_sessoes e
 * a ponte busca em /api/whatsapp/ponte/pendencias.
 */

function erro(e: unknown) {
  if (e instanceof WahaError) return NextResponse.json({ erro: e.message }, { status: 502 })
  return toErrorResponse(e)
}

export async function POST() {
  try {
    const ctx = await requireRole('admin')
    const sessao = sessaoDaConta(ctx.accountId)
    await iniciarSessao(sessao, ctx.accountId)

    const db = supabaseAdmin()
    const linha = {
      phone_number_id: `${WAHA_PREFIXO}${sessao}`,
      waba_id: null,
      // o envio pela ponte não usa token; este campo só precisa existir
      access_token: encrypt('ponte'),
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
    if (!(await ponteOnline())) {
      return NextResponse.json({
        status: 'PONTE_OFFLINE',
        erro: 'O programa do WhatsApp (a ponte) não está rodando agora. Com o Mac ligado e conectado à internet, esta tela continua sozinha.',
      })
    }
    if (st.status === 'WORKING') {
      return NextResponse.json({ status: 'WORKING', numero: st.numero ?? null, nome: st.nome ?? null })
    }
    if (st.status === 'SCAN_QR_CODE' && st.qr) {
      return NextResponse.json({ status: st.status, qr: st.qr })
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
