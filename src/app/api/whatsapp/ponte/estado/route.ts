import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { segredoDaPonteConfere } from '@/lib/whatsapp/ponte-auth'
import { WAHA_PREFIXO } from '@/lib/whatsapp/waha'

/**
 * In Mídia: a ponte conta como está cada sessão (e dá sinal de vida).
 *
 * Corpo: { maquina?, versao?, sessoes: [{ sessao, status, qr?, numero?, nome?, qrExpirado? }] }
 */
type Relato = { sessao?: string; status?: string; qr?: string | null; numero?: string | null; nome?: string | null; qrExpirado?: boolean }

const STATUS = new Set(['STOPPED', 'STARTING', 'SCAN_QR_CODE', 'WORKING', 'FAILED'])

export async function POST(request: Request) {
  if (!segredoDaPonteConfere(request.headers.get('x-crm-segredo'))) {
    return NextResponse.json({ erro: 'não autorizado' }, { status: 401 })
  }
  let corpo: { maquina?: string; versao?: string; sessoes?: Relato[] }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'corpo inválido' }, { status: 400 })
  }
  const db = supabaseAdmin()
  const agora = new Date().toISOString()
  await db
    .from('whatsapp_ponte')
    .update({
      visto_em: agora,
      ...(typeof corpo.versao === 'string' ? { versao: corpo.versao.slice(0, 40) } : {}),
      ...(typeof corpo.maquina === 'string' ? { maquina: corpo.maquina.slice(0, 80) } : {}),
    })
    .eq('id', 1)

  for (const r of (corpo.sessoes ?? []).slice(0, 50)) {
    if (typeof r.sessao !== 'string' || !r.status || !STATUS.has(r.status)) continue
    const { data: atual } = await db.from('whatsapp_sessoes').select('pedido').eq('sessao', r.sessao).maybeSingle()
    if (!atual) continue
    const qr = r.status === 'SCAN_QR_CODE' && typeof r.qr === 'string' && r.qr.startsWith('data:image/') ? r.qr.slice(0, 20000) : null
    // pedido cumprido some da fila: desligou de vez, ou o QR expirou sem ninguém escanear
    const pedido =
      r.status === 'STOPPED' && (atual.pedido === 'desconectar' || r.qrExpirado) ? null : atual.pedido
    await db
      .from('whatsapp_sessoes')
      .update({
        status: r.status,
        qr,
        numero: r.status === 'WORKING' ? (r.numero ?? null) : null,
        nome: r.status === 'WORKING' ? (r.nome ?? null) : null,
        pedido,
        atualizado_em: agora,
      })
      .eq('sessao', r.sessao)

    const conectado = r.status === 'WORKING'
    await db
      .from('whatsapp_config')
      .update({ status: conectado ? 'connected' : 'disconnected', ...(conectado ? { connected_at: agora } : {}) })
      .eq('phone_number_id', `${WAHA_PREFIXO}${r.sessao}`)
  }
  return NextResponse.json({ ok: true })
}
