/**
 * In Mídia: WhatsApp sem API oficial, pelo WAHA (github.com/devlikeapro/waha).
 *
 * O CRM foi feito para a API oficial da Meta. Para não reescrever nada,
 * um número do WAHA vira uma linha comum em `whatsapp_config`, com
 * `phone_number_id = "waha:<sessão>"`. A partir daí:
 *
 *   - envio: as funções de meta-api.ts olham o prefixo e desviam para cá;
 *   - recebimento: /api/whatsapp/waha/webhook traduz o evento do WAHA para
 *     o formato da Meta e entrega na porta de sempre (/api/whatsapp/webhook).
 *
 * O servidor WAHA é um só para todas as contas (env WAHA_URL + WAHA_API_KEY);
 * cada conta tem a sua sessão (um número de WhatsApp por conta).
 */

export const WAHA_PREFIXO = 'waha:'

export const ehWaha = (phoneNumberId: string | null | undefined): boolean =>
  typeof phoneNumberId === 'string' && phoneNumberId.startsWith(WAHA_PREFIXO)

export const sessaoDe = (phoneNumberId: string): string => phoneNumberId.slice(WAHA_PREFIXO.length)

/** Nome da sessão de uma conta: estável e curto. */
export const sessaoDaConta = (accountId: string): string => `crm-${accountId.replace(/-/g, '').slice(0, 12)}`

export class WahaError extends Error {
  constructor(message: string, public status?: number) {
    super(message)
    this.name = 'WahaError'
  }
}

function config() {
  const url = process.env.WAHA_URL?.replace(/\/+$/, '')
  const key = process.env.WAHA_API_KEY
  if (!url || !key) throw new WahaError('WhatsApp por QR code não está configurado no servidor (WAHA_URL / WAHA_API_KEY).')
  return { url, key }
}

export async function waha<T = unknown>(
  metodo: 'GET' | 'POST' | 'PUT' | 'DELETE',
  caminho: string,
  corpo?: unknown,
  aceitar = 'application/json'
): Promise<T> {
  const { url, key } = config()
  let r: Response
  try {
    r = await fetch(`${url}${caminho}`, {
      method: metodo,
      headers: { 'X-Api-Key': key, 'Content-Type': 'application/json', Accept: aceitar },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    throw new WahaError(
      'O servidor do WhatsApp não respondeu. Se ele ainda não foi instalado, é isso: falta subir o servidor (whats.inmidia.space).',
      503
    )
  }
  if (!r.ok) {
    const txt = await r.text().catch(() => '')
    throw new WahaError(`WAHA ${metodo} ${caminho} ${r.status}: ${txt.slice(0, 300)}`, r.status)
  }
  if (aceitar !== 'application/json') return (await r.arrayBuffer()) as T
  const txt = await r.text()
  return (txt ? JSON.parse(txt) : {}) as T
}

/* ------------------------------------------------------------ telefone */

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
 * O WhatsApp guarda alguns números antigos do Brasil sem o 9 da frente.
 * Antes de mandar, pergunta ao WAHA qual é o chatId de verdade.
 * Se o WAHA não souber responder, usa o número como veio.
 */
export async function chatIdVerificado(sessao: string, telefone: string): Promise<string> {
  if (telefone.includes('@')) return telefone
  try {
    const r = await waha<{ numberExists?: boolean; chatId?: string }>(
      'GET',
      `/api/contacts/check-exists?phone=${encodeURIComponent(telefone.replace(/\D/g, ''))}&session=${encodeURIComponent(sessao)}`
    )
    if (r.numberExists && r.chatId) return r.chatId
    if (r.numberExists === false) throw new WahaError('Esse número não tem WhatsApp.', 400)
  } catch (e) {
    if (e instanceof WahaError && e.status === 400) throw e
  }
  return chatIdDe(telefone)
}

/* ------------------------------------------------------------ envio */

export async function enviarTexto(
  sessao: string,
  telefone: string,
  texto: string,
  responderA?: string
): Promise<{ messageId: string }> {
  const chatId = await chatIdVerificado(sessao, telefone)
  const r = await waha<{ id?: string | { _serialized?: string }; key?: { id?: string } }>('POST', '/api/sendText', {
    session: sessao,
    chatId,
    text: texto,
    ...(responderA ? { reply_to: responderA } : {}),
  })
  return { messageId: idDaResposta(r) }
}

export type TipoMidia = 'image' | 'video' | 'document' | 'audio'

export async function enviarMidia(
  sessao: string,
  telefone: string,
  tipo: TipoMidia,
  arquivo: { url: string; mimetype?: string; filename?: string },
  legenda?: string
): Promise<{ messageId: string }> {
  const chatId = await chatIdVerificado(sessao, telefone)
  const rota = { image: '/api/sendImage', video: '/api/sendVideo', document: '/api/sendFile', audio: '/api/sendVoice' }[tipo]
  const r = await waha<Record<string, unknown>>('POST', rota, {
    session: sessao,
    chatId,
    file: arquivo,
    ...(legenda ? { caption: legenda } : {}),
  })
  return { messageId: idDaResposta(r) }
}

export async function marcarLida(sessao: string, telefone: string): Promise<void> {
  await waha('POST', '/api/sendSeen', { session: sessao, chatId: chatIdDe(telefone) }).catch(() => {})
}

export async function digitando(sessao: string, telefone: string): Promise<void> {
  await waha('POST', '/api/startTyping', { session: sessao, chatId: chatIdDe(telefone) }).catch(() => {})
}

export async function reagir(sessao: string, messageId: string, emoji: string): Promise<{ messageId: string }> {
  const corpo = { session: sessao, messageId, reaction: emoji }
  // versões novas do WAHA usam POST; as antigas, PUT
  await waha('POST', '/api/reaction', corpo).catch(() => waha('PUT', '/api/reaction', corpo))
  return { messageId: `${messageId}:reacao` }
}

function idDaResposta(r: unknown): string {
  const o = (r ?? {}) as { id?: string | { _serialized?: string; id?: string }; key?: { id?: string } }
  if (typeof o.id === 'string') return o.id
  if (o.id && typeof o.id === 'object') return o.id._serialized ?? o.id.id ?? `waha-${Date.now()}`
  if (o.key?.id) return o.key.id
  return `waha-${Date.now()}`
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

/* ------------------------------------------------------------ sessão */

export interface StatusSessao {
  status: 'STOPPED' | 'STARTING' | 'SCAN_QR_CODE' | 'WORKING' | 'FAILED' | string
  me?: { id?: string; pushName?: string } | null
}

export async function statusDaSessao(sessao: string): Promise<StatusSessao | null> {
  try {
    return await waha<StatusSessao>('GET', `/api/sessions/${encodeURIComponent(sessao)}`)
  } catch (e) {
    if (e instanceof WahaError && e.status === 404) return null
    throw e
  }
}

/** Cria (ou reinicia) a sessão já com o webhook apontando para o CRM. */
export async function iniciarSessao(sessao: string, webhookUrl: string, segredo: string): Promise<void> {
  const webhook = {
    url: webhookUrl,
    events: ['message', 'message.ack', 'session.status'],
    customHeaders: [{ name: 'x-crm-segredo', value: segredo }],
  }
  const existente = await statusDaSessao(sessao)
  if (!existente) {
    await waha('POST', '/api/sessions', { name: sessao, start: true, config: { webhooks: [webhook] } })
    return
  }
  await waha('PUT', `/api/sessions/${encodeURIComponent(sessao)}`, { name: sessao, config: { webhooks: [webhook] } })
  if (existente.status === 'STOPPED' || existente.status === 'FAILED') {
    await waha('POST', `/api/sessions/${encodeURIComponent(sessao)}/start`)
  }
}

export async function qrDaSessao(sessao: string): Promise<string> {
  const png = await waha<ArrayBuffer>('GET', `/api/${encodeURIComponent(sessao)}/auth/qr?format=image`, undefined, 'image/png')
  return `data:image/png;base64,${Buffer.from(png).toString('base64')}`
}

export async function desconectarSessao(sessao: string): Promise<void> {
  await waha('POST', `/api/sessions/${encodeURIComponent(sessao)}/logout`).catch(() => {})
  await waha('POST', `/api/sessions/${encodeURIComponent(sessao)}/stop`).catch(() => {})
}
