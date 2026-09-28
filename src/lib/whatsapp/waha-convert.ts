/**
 * In Mídia: traduz eventos do WAHA para o formato do webhook da Meta,
 * para a porta de entrada que já existe (/api/whatsapp/webhook) cuidar
 * de contato, conversa, mensagem, automação e IA sem mudar nada.
 */
import { WAHA_PREFIXO, idCurto, telefoneDe } from './waha'

export interface WahaEvento {
  event?: string
  session?: string
  payload?: Record<string, unknown>
}

type Qualquer = Record<string, unknown>

const obj = (v: unknown): Qualquer => (v && typeof v === 'object' ? (v as Qualquer) : {})
const txt = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)

/** Nome que a pessoa usa no WhatsApp, em qualquer motor do WAHA. */
export function nomeDoRemetente(p: Qualquer): string {
  const d = obj(p._data)
  const info = obj(d.Info)
  return txt(p.notifyName) ?? txt(info.PushName) ?? txt(d.notifyName) ?? txt(d.pushName) ?? ''
}

/**
 * Telefone de quem mandou. Contas novas do WhatsApp chegam como
 * "...@lid" (id que esconde o número); aí o número real vem num campo
 * alternativo, dependendo do motor do WAHA. Devolve null se não achar.
 */
export function remetenteComTelefone(p: Qualquer): string | null {
  const de = txt(p.from) ?? ''
  if (de.endsWith('@c.us') || de.endsWith('@s.whatsapp.net')) return telefoneDe(de)
  const d = obj(p._data)
  const info = obj(d.Info)
  const chave = obj(d.key)
  const alternativo =
    txt(info.SenderAlt) ?? txt(info.Sender) ?? txt(chave.senderPn) ?? txt(chave.remoteJidAlt) ?? txt(p.participant)
  if (alternativo && !alternativo.endsWith('@lid')) return telefoneDe(alternativo)
  return null
}

const ehGrupoOuStatus = (de: string) =>
  de.endsWith('@g.us') || de.endsWith('@newsletter') || de.includes('broadcast')

/** Texto da mensagem; mídia vira uma descrição, porque o arquivo fica no celular. */
export function textoDaMensagem(p: Qualquer): string {
  const corpo = txt(p.body) ?? ''
  if (!p.hasMedia) return corpo
  const mime = txt(obj(p.media).mimetype) ?? ''
  const [tipo, recebido] = mime.startsWith('image/')
    ? ['📷 Imagem', 'recebida']
    : mime.startsWith('audio/')
      ? ['🎤 Áudio', 'recebido']
      : mime.startsWith('video/')
        ? ['🎬 Vídeo', 'recebido']
        : ['📎 Arquivo', 'recebido']
  return corpo ? `[${tipo}] ${corpo}` : `[${tipo} ${recebido}: abra no celular]`
}

const ACK: Record<number, string> = { 1: 'sent', 2: 'delivered', 3: 'read', 4: 'read', [-1]: 'failed' }

/**
 * Evento do WAHA -> corpo de webhook da Meta. Devolve null quando não há
 * nada para o CRM (mensagem própria, grupo, status, evento desconhecido).
 * `telefoneResolvido` vem de fora quando o remetente é @lid e foi preciso
 * perguntar o número ao WAHA.
 */
export function paraFormatoMeta(ev: WahaEvento, telefoneResolvido?: string | null): Qualquer | null {
  const sessao = ev.session
  const p = obj(ev.payload)
  if (!sessao) return null
  const metadata = { display_phone_number: '', phone_number_id: `${WAHA_PREFIXO}${sessao}` }
  const envelope = (value: Qualquer) => ({
    object: 'whatsapp_business_account',
    entry: [{ id: `waha-${sessao}`, changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata, ...value } }] }],
  })

  if (ev.event === 'message') {
    const de = txt(p.from) ?? ''
    if (p.fromMe || !de || ehGrupoOuStatus(de)) return null
    const telefone = telefoneResolvido ?? remetenteComTelefone(p)
    if (!telefone) return null
    const id = txt(p.id)
    if (!id) return null
    const ts = typeof p.timestamp === 'number' ? p.timestamp : Math.floor(Date.now() / 1000)
    return envelope({
      contacts: [{ profile: { name: nomeDoRemetente(p) }, wa_id: telefone }],
      messages: [{ from: telefone, id, timestamp: String(ts), type: 'text', text: { body: textoDaMensagem(p) } }],
    })
  }

  if (ev.event === 'message.ack') {
    const id = txt(p.id)
    const status = typeof p.ack === 'number' ? ACK[p.ack] : undefined
    if (!id || !status || !p.fromMe) return null
    const para = txt(p.to) ?? txt(p.from) ?? ''
    return envelope({
      statuses: [{ id: idCurto(id), status, timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: telefoneDe(para) }],
    })
  }

  if (ev.event === 'message.reaction') {
    const de = txt(p.from) ?? ''
    const reacao = obj(p.reaction)
    const alvo = txt(reacao.messageId)
    if (p.fromMe || !de || ehGrupoOuStatus(de) || !alvo) return null
    const telefone = telefoneResolvido ?? remetenteComTelefone(p)
    const id = txt(p.id)
    if (!telefone || !id) return null
    return envelope({
      contacts: [{ profile: { name: nomeDoRemetente(p) }, wa_id: telefone }],
      messages: [{
        from: telefone,
        id,
        timestamp: String(typeof p.timestamp === 'number' ? p.timestamp : Math.floor(Date.now() / 1000)),
        type: 'reaction',
        // emoji vazio = reação removida (mesmo formato da Meta)
        reaction: { message_id: idCurto(alvo), emoji: typeof reacao.text === 'string' ? reacao.text : '' },
      }],
    })
  }

  return null
}
