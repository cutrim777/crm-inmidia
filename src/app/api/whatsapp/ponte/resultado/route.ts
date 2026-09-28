import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { segredoDaPonteConfere } from '@/lib/whatsapp/ponte-auth'

/**
 * In Mídia: a ponte conta como foi cada envio da caixa de saída.
 * Corpo: { id, ok, message_id?, erro? }
 */
export async function POST(request: Request) {
  if (!segredoDaPonteConfere(request.headers.get('x-crm-segredo'))) {
    return NextResponse.json({ erro: 'não autorizado' }, { status: 401 })
  }
  let corpo: { id?: string; ok?: boolean; message_id?: string; erro?: string }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'corpo inválido' }, { status: 400 })
  }
  if (typeof corpo.id !== 'string') return NextResponse.json({ erro: 'falta o id' }, { status: 400 })
  await supabaseAdmin()
    .from('whatsapp_saida')
    .update({
      status: corpo.ok ? 'ok' : 'erro',
      message_id: typeof corpo.message_id === 'string' ? corpo.message_id.slice(0, 200) : null,
      erro: corpo.ok ? null : String(corpo.erro ?? 'falhou').slice(0, 500),
      atualizado_em: new Date().toISOString(),
    })
    .eq('id', corpo.id)
    .eq('status', 'enviando')
  return NextResponse.json({ ok: true })
}
