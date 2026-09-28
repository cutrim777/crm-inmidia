import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { segredoDaPonteConfere } from '@/lib/whatsapp/ponte-auth'

/**
 * In Mídia: a ponte do WhatsApp pergunta "o que eu faço agora?".
 *
 * Responde com as sessões (e o que o CRM quer de cada uma) e com as
 * mensagens da caixa de saída, já reservadas para esta ponte. Se não há
 * nada, segura a pergunta por até 20 s olhando a caixa a cada segundo:
 * assim a mensagem sai rápido sem a ponte ficar perguntando sem parar.
 */
export const maxDuration = 60

const SEGURA_MS = 20_000
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function GET(request: Request) {
  if (!segredoDaPonteConfere(request.headers.get('x-crm-segredo'))) {
    return NextResponse.json({ erro: 'não autorizado' }, { status: 401 })
  }
  const db = supabaseAdmin()
  const versao = new URL(request.url).searchParams.get('versao')
  await db.from('whatsapp_ponte').update({ visto_em: new Date().toISOString(), ...(versao ? { versao } : {}) }).eq('id', 1)

  const lerSessoes = async () => {
    const { data } = await db.from('whatsapp_sessoes').select('sessao, pedido, status')
    return data ?? []
  }
  // precisa de ação: pediu para ligar e está parada, ou pediu para desligar e está ligada
  const precisaAgir = (s: { pedido: string | null; status: string }) =>
    (s.pedido === 'conectar' && (s.status === 'STOPPED' || s.status === 'FAILED')) ||
    (s.pedido === 'desconectar' && s.status !== 'STOPPED')

  const imediato = new URL(request.url).searchParams.get('imediato') === '1'
  const inicio = Date.now()
  for (;;) {
    const sessoes = await lerSessoes()
    const { data: envios, error } = await db.rpc('ponte_reservar_envios', { p_limite: 20 })
    if (error) console.error('[ponte/pendencias] reservar:', error.message)
    const lista = envios ?? []
    if (imediato || lista.length || sessoes.some(precisaAgir) || Date.now() - inicio > SEGURA_MS) {
      return NextResponse.json({ sessoes, envios: lista })
    }
    await pausa(1000)
  }
}
