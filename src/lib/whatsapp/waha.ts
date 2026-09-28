/**
 * In Mídia: WhatsApp sem API oficial, por QR code, pela PONTE.
 *
 * O CRM foi feito para a API oficial da Meta. Para não reescrever nada,
 * um número conectado por QR vira uma linha comum em `whatsapp_config`,
 * com `phone_number_id = "waha:<sessão>"` (o prefixo ficou do primeiro
 * desenho, com o WAHA). A partir daí:
 *
 *   - envio: as funções de meta-api.ts olham o prefixo e desviam para cá.
 *     Aqui o pedido vai para a caixa de saída (tabela whatsapp_saida) e o
 *     CRM espera a ponte mandar e devolver o id da mensagem;
 *   - recebimento: a ponte manda cada evento para /api/whatsapp/waha/webhook,
 *     que traduz para o formato da Meta e entrega na porta de sempre.
 *
 * A ponte é o programa `Empresas/In Mídia/crm-whatsapp` (Baileys). Ela roda
 * num computador sempre ligado (hoje o Mac do Matheus) e só faz conexões de
 * saída: ninguém precisa abrir porta nenhuma para ela.
 */
import { isDeliverableUrl } from '@/lib/webhooks/ssrf'
import { supabaseAdmin } from '@/lib/flows/admin-client'

export const WAHA_PREFIXO = 'waha:'

export const ehWaha = (phoneNumberId: string | null | undefined): boolean =>
  typeof phoneNumberId === 'string' && phoneNumberId.startsWith(WAHA_PREFIXO)

export const sessaoDe = (phoneNumberId: string): string => phoneNumberId.slice(WAHA_PREFIXO.length)

/** Nome da sessão de uma conta: estável e curto. */
export const sessaoDaConta = (accountId: string): string => `crm-${accountId.replace(/-/g, '').slice(0, 12)}`

/**
 * Id curto da mensagem. Na recebida o CRM guarda o id completo
 * ("false_5562...@c.us_3EB0ABC"); na enviada, só o final ("3EB0ABC"),
 * para a confirmação de entrega/leitura casar com o envio.
 */
export function idCurto(id: string): string {
  const partes = id.split('_')
  return partes.length >= 3 ? partes[partes.length - 1] : id
}

export class WahaError extends Error {
  constructor(message: string, public status?: number) {
    super(message)
    this.name = 'WahaError'
  }
}

/** "5562999990000" ou "+55 62 ..." -> "5562999990000@c.us". */
export function chatIdDe(telefone: string): string {
  if (telefone.includes('@')) return telefone
  return `${telefone.replace(/\D/g, '')}@c.us`
}

/** "5562999990000@c.us" -> "5562999990000". */
export function telefoneDe(chatId: string): string {
  return chatId.split('@')[0].replace(/\D/g, '')
}

/**
 * Botões e listas não existem no WhatsApp comum de forma confiável.
 * Viram texto com as opções numeradas.
 */
export function textoDeOpcoes(corpo: string, opcoes: string[], rodape?: string): string {
  const linhas = [corpo.trim(), '', ...opcoes.map((o, i) => `${i + 1}. ${o}`)]
  if (rodape?.trim()) linhas.push('', rodape.trim())
  return linhas.join('\n')
}

/* ------------------------------------------------------------ caixa de saída */

const ESPERA_MAX_MS = 25_000
const PONTE_VIVA_MS = 90_000

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A ponte deu sinal de vida há pouco? */
export async function ponteOnline(): Promise<boolean> {
  const { data } = await supabaseAdmin().from('whatsapp_ponte').select('visto_em').eq('id', 1).maybeSingle()
  const visto = data?.visto_em ? new Date(data.visto_em as string).getTime() : 0
  return Date.now() - visto < PONTE_VIVA_MS
}

type TipoEnvio = 'texto' | 'midia' | 'visto' | 'digitando' | 'reacao'

async function enfileirar(sessao: string, tipo: TipoEnvio, dados: Record<string, unknown>): Promise<string> {
  const { data, error } = await supabaseAdmin()
    .from('whatsapp_saida')
    .insert({ sessao, tipo, dados })
    .select('id')
    .single()
  if (error || !data) throw new WahaError(`Não foi possível pôr a mensagem na fila: ${error?.message ?? 'sem resposta'}`)
  return data.id as string
}

/** Pede à ponte e espera ela responder com o id da mensagem. */
async function pedirEEsperar(sessao: string, tipo: TipoEnvio, dados: Record<string, unknown>): Promise<{ messageId: string }> {
  if (!(await ponteOnline())) {
    throw new WahaError(
      'O WhatsApp do CRM está desligado agora: o programa da ponte não está rodando (Mac desligado ou sem internet). A mensagem não foi enviada.',
      503
    )
  }
  const id = await enfileirar(sessao, tipo, dados)
  const db = supabaseAdmin()
  const inicio = Date.now()
  while (Date.now() - inicio < ESPERA_MAX_MS) {
    await pausa(400)
    const { data } = await db.from('whatsapp_saida').select('status, message_id, erro').eq('id', id).maybeSingle()
    if (data?.status === 'ok') return { messageId: (data.message_id as string) || `ponte-${id}` }
    if (data?.status === 'erro') throw new WahaError((data.erro as string) || 'O WhatsApp recusou o envio.', 502)
  }
  // ninguém pegou: desiste (a ponte não manda mais esse item)
  await db.from('whatsapp_saida').update({ status: 'expirado', atualizado_em: new Date().toISOString() }).eq('id', id).eq('status', 'pendente')
  throw new WahaError('A ponte do WhatsApp não respondeu a tempo. A mensagem não foi enviada; tente de novo.', 504)
}

/** Pedido que não precisa de resposta (visto, digitando). */
async function pedirSemEsperar(sessao: string, tipo: TipoEnvio, dados: Record<string, unknown>): Promise<void> {
  try {
    await enfileirar(sessao, tipo, dados)
  } catch {
    // aviso de leitura/digitando nunca pode derrubar uma resposta
  }
}

/* ------------------------------------------------------------ envio */

export async function enviarTexto(
  sessao: string,
  telefone: string,
  texto: string,
  responderA?: string
): Promise<{ messageId: string }> {
  return pedirEEsperar(sessao, 'texto', { telefone, texto, ...(responderA ? { responderA } : {}) })
}

export type TipoMidia = 'image' | 'video' | 'document' | 'audio'

export async function enviarMidia(
  sessao: string,
  telefone: string,
  tipo: TipoMidia,
  arquivo: { url: string; mimetype?: string; filename?: string },
  legenda?: string
): Promise<{ messageId: string }> {
  // quem baixa o arquivo é a ponte: só endereço público https
  if (!/^https:\/\//i.test(arquivo.url) || !(await isDeliverableUrl(arquivo.url))) {
    throw new WahaError('O arquivo precisa estar num endereço público (https).', 400)
  }
  return pedirEEsperar(sessao, 'midia', { telefone, tipo, ...arquivo, ...(legenda ? { legenda } : {}) })
}

/** Marca como lida a mensagem recebida (id completo "false_..."). */
export async function marcarLida(sessao: string, messageId: string): Promise<void> {
  await pedirSemEsperar(sessao, 'visto', { messageId })
}

export async function digitando(sessao: string, telefone: string): Promise<void> {
  await pedirSemEsperar(sessao, 'digitando', { telefone })
}

export async function reagir(
  sessao: string,
  messageId: string,
  emoji: string,
  telefone?: string
): Promise<{ messageId: string }> {
  await pedirSemEsperar(sessao, 'reacao', { messageId, emoji, ...(telefone ? { telefone } : {}) })
  return { messageId: `${idCurto(messageId)}:reacao` }
}

/* ------------------------------------------------------------ sessão */

export interface StatusSessao {
  status: 'STOPPED' | 'STARTING' | 'SCAN_QR_CODE' | 'WORKING' | 'FAILED' | 'PONTE_OFFLINE' | string
  qr?: string | null
  numero?: string | null
  nome?: string | null
}

export async function statusDaSessao(sessao: string): Promise<StatusSessao | null> {
  const { data } = await supabaseAdmin()
    .from('whatsapp_sessoes')
    .select('status, qr, numero, nome, pedido')
    .eq('sessao', sessao)
    .maybeSingle()
  if (!data) return null
  return {
    status: data.status as string,
    qr: (data.qr as string | null) ?? null,
    numero: (data.numero as string | null) ?? null,
    nome: (data.nome as string | null) ?? null,
  }
}

/** Pede à ponte para ligar a sessão da conta (mostra QR se ainda não pareou). */
export async function iniciarSessao(sessao: string, accountId: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('whatsapp_sessoes')
    .upsert(
      { sessao, account_id: accountId, pedido: 'conectar', atualizado_em: new Date().toISOString() },
      { onConflict: 'sessao' }
    )
  if (error) throw new WahaError(`Não foi possível pedir a conexão: ${error.message}`)
}

export async function desconectarSessao(sessao: string): Promise<void> {
  await supabaseAdmin()
    .from('whatsapp_sessoes')
    .update({ pedido: 'desconectar', atualizado_em: new Date().toISOString() })
    .eq('sessao', sessao)
}
