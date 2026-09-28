import { describe, expect, it } from 'vitest'
import { paraFormatoMeta, remetenteComTelefone, textoDaMensagem } from './waha-convert'
import { chatIdDoMessageId, textoDoModelo } from './meta-api'
import { textoDeOpcoes, chatIdDe, telefoneDe, sessaoDaConta } from './waha'

const valor = (b: unknown) =>
  (b as { entry: Array<{ changes: Array<{ value: Record<string, unknown> }> }> }).entry[0].changes[0].value

describe('paraFormatoMeta: mensagem recebida', () => {
  const base = {
    event: 'message',
    session: 'crm-58aa2907267a',
    payload: {
      id: 'false_5562999990000@c.us_ABC',
      timestamp: 1790000000,
      from: '5562999990000@c.us',
      fromMe: false,
      body: 'Oi, quero um orçamento',
      hasMedia: false,
      notifyName: 'Maria',
    },
  }

  it('vira o corpo da Meta com a sessão como phone_number_id', () => {
    const v = valor(paraFormatoMeta(base))
    expect(v.metadata).toEqual({ display_phone_number: '', phone_number_id: 'waha:crm-58aa2907267a' })
    expect(v.contacts).toEqual([{ profile: { name: 'Maria' }, wa_id: '5562999990000' }])
    expect(v.messages).toEqual([
      { from: '5562999990000', id: 'false_5562999990000@c.us_ABC', timestamp: '1790000000', type: 'text', text: { body: 'Oi, quero um orçamento' } },
    ])
  })

  it('ignora mensagem própria, grupo e status', () => {
    expect(paraFormatoMeta({ ...base, payload: { ...base.payload, fromMe: true } })).toBeNull()
    expect(paraFormatoMeta({ ...base, payload: { ...base.payload, from: '123@g.us' } })).toBeNull()
    expect(paraFormatoMeta({ ...base, payload: { ...base.payload, from: 'status@broadcast' } })).toBeNull()
  })

  it('remetente @lid: usa o número alternativo ou o resolvido de fora', () => {
    const lid = { ...base.payload, from: '999888777@lid', _data: { Info: { SenderAlt: '5562988887777@s.whatsapp.net' } } }
    expect(remetenteComTelefone(lid)).toBe('5562988887777')
    const semAlt = { ...base, payload: { ...base.payload, from: '999888777@lid' } }
    expect(paraFormatoMeta(semAlt)).toBeNull()
    expect(valor(paraFormatoMeta(semAlt, '5562911112222')).messages).toMatchObject([{ from: '5562911112222' }])
  })

  it('mídia vira descrição em português', () => {
    expect(textoDaMensagem({ hasMedia: true, media: { mimetype: 'image/jpeg' }, body: '' })).toBe('[📷 Imagem recebido: abra no celular]')
    expect(textoDaMensagem({ hasMedia: true, media: { mimetype: 'audio/ogg' }, body: '' })).toBe('[🎤 Áudio recebido: abra no celular]')
    expect(textoDaMensagem({ hasMedia: true, media: { mimetype: 'image/png' }, body: 'olha' })).toBe('[📷 Imagem] olha')
  })
})

describe('paraFormatoMeta: confirmação de entrega', () => {
  it('ack 3 vira "read" com o mesmo id do envio', () => {
    const v = valor(paraFormatoMeta({ event: 'message.ack', session: 's', payload: { id: 'true_5562@c.us_X', fromMe: true, ack: 3, to: '5562999990000@c.us' } }))
    expect(v.statuses).toMatchObject([{ id: 'true_5562@c.us_X', status: 'read', recipient_id: '5562999990000' }])
  })
  it('evento desconhecido é ignorado', () => {
    expect(paraFormatoMeta({ event: 'presence.update', session: 's', payload: {} })).toBeNull()
  })
})

describe('auxiliares', () => {
  it('ids e telefones', () => {
    expect(chatIdDe('+55 62 99999-0000')).toBe('5562999990000@c.us')
    expect(telefoneDe('5562999990000@c.us')).toBe('5562999990000')
    expect(chatIdDoMessageId('false_5562999990000@c.us_ABC')).toBe('5562999990000@c.us')
    expect(chatIdDoMessageId('wamid.xyz')).toBeNull()
    expect(sessaoDaConta('58aa2907-267a-4971-afe6-53b68b937b6a')).toBe('crm-58aa2907267a')
  })

  it('botões viram opções numeradas', () => {
    expect(textoDeOpcoes('Como posso ajudar?', ['Orçamento', 'Suporte'], 'In Mídia')).toBe(
      'Como posso ajudar?\n\n1. Orçamento\n2. Suporte\n\nIn Mídia'
    )
  })

  it('modelo da Meta vira texto com as variáveis preenchidas', () => {
    const texto = textoDoModelo({
      phoneNumberId: 'waha:s', accessToken: 'x', to: '5562', templateName: 'boas_vindas',
      template: { body_text: 'Olá {{1}}, recebemos seu pedido de {{2}}.', header_type: 'text', header_content: 'In Mídia', footer_text: 'Responda aqui' } as never,
      messageParams: { body: ['Maria', 'orçamento'] },
    })
    expect(texto).toBe('*In Mídia*\n\nOlá Maria, recebemos seu pedido de orçamento.\n\n_Responda aqui_')
  })
})
