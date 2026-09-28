-- In Mídia: ponte do WhatsApp por QR code.
--
-- A ponte é um programa que roda num computador sempre ligado (hoje o
-- Mac do Matheus; depois pode ir para o Railway). Ela conecta os números
-- no WhatsApp e conversa com o CRM SEMPRE saindo de lá: pergunta ao CRM o
-- que fazer (/api/whatsapp/ponte/pendencias) e avisa o que aconteceu
-- (/estado, /resultado, /waha/webhook). Estas tabelas são a caixa postal
-- entre os dois. Só o servidor lê e grava (RLS ligado, sem regra).

-- uma sessão (um número de WhatsApp) por conta
CREATE TABLE IF NOT EXISTS whatsapp_sessoes (
  sessao TEXT PRIMARY KEY,
  account_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  -- o que o CRM quer: 'conectar' (manter ligada) ou 'desconectar'
  pedido TEXT CHECK (pedido IN ('conectar', 'desconectar')),
  -- o que a ponte relata: STOPPED, STARTING, SCAN_QR_CODE, WORKING, FAILED
  status TEXT NOT NULL DEFAULT 'STOPPED',
  qr TEXT,
  numero TEXT,
  nome TEXT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT whatsapp_sessoes_da_conta CHECK (sessao = 'crm-' || left(replace(account_id::text, '-', ''), 12))
);
ALTER TABLE whatsapp_sessoes ENABLE ROW LEVEL SECURITY;

-- caixa de saída: o que o CRM pediu para a ponte mandar
CREATE TABLE IF NOT EXISTS whatsapp_saida (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sessao TEXT NOT NULL REFERENCES whatsapp_sessoes(sessao) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('texto', 'midia', 'visto', 'digitando', 'reacao')),
  dados JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'enviando', 'ok', 'erro', 'expirado')),
  message_id TEXT,
  erro TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_saida_fila ON whatsapp_saida(status, criado_em);
ALTER TABLE whatsapp_saida ENABLE ROW LEVEL SECURITY;

-- sinal de vida da ponte (uma linha só)
CREATE TABLE IF NOT EXISTS whatsapp_ponte (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  visto_em TIMESTAMPTZ,
  versao TEXT,
  maquina TEXT
);
ALTER TABLE whatsapp_ponte ENABLE ROW LEVEL SECURITY;
INSERT INTO whatsapp_ponte (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- a ponte reserva o que vai mandar (duas pontes nunca pegam o mesmo item);
-- item parado há mais de 40 s não sai mais: quem pediu já desistiu
CREATE OR REPLACE FUNCTION public.ponte_reservar_envios(p_limite INT)
RETURNS SETOF whatsapp_saida
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE whatsapp_saida SET status = 'enviando', atualizado_em = NOW()
  WHERE id IN (
    SELECT id FROM whatsapp_saida
    WHERE status = 'pendente' AND criado_em > NOW() - INTERVAL '40 seconds'
    ORDER BY criado_em
    LIMIT p_limite
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;
REVOKE ALL ON FUNCTION public.ponte_reservar_envios(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ponte_reservar_envios(INT) TO service_role;
