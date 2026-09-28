-- In Mídia: correções da revisão de segurança de 28/09/2026.

-- 1. WhatsApp por QR code (WAHA): a sessão fica presa à conta dona dela.
--    Sem isso, um admin de qualquer conta podia gravar "waha:<sessão de
--    outra conta>" em phone_number_id e mandar mensagem pelo número alheio.
ALTER TABLE whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_waha_da_conta;
ALTER TABLE whatsapp_config ADD CONSTRAINT whatsapp_config_waha_da_conta CHECK (
  phone_number_id NOT LIKE 'waha:%'
  OR phone_number_id = 'waha:crm-' || left(replace(account_id::text, '-', ''), 12)
);

-- 2. Entrada de leads: sites autorizados por formulário (vazio = qualquer um).
ALTER TABLE lead_sources ADD COLUMN IF NOT EXISTS allowed_origins TEXT[] NOT NULL DEFAULT '{}';

-- 3. Entrada de leads: limite de envios guardado no banco (o limite em
--    memória não segura na Vercel, que roda várias cópias do servidor).
CREATE TABLE IF NOT EXISTS lead_intake_hits (
  id BIGSERIAL PRIMARY KEY,
  source_id UUID NOT NULL REFERENCES lead_sources(id) ON DELETE CASCADE,
  ip_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lead_intake_hits_ip ON lead_intake_hits(ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_lead_intake_hits_fonte ON lead_intake_hits(source_id, created_at);
ALTER TABLE lead_intake_hits ENABLE ROW LEVEL SECURITY;  -- sem regra: só o servidor lê e grava

CREATE OR REPLACE FUNCTION public.registrar_envio_lead(
  p_source UUID, p_ip_hash TEXT, p_limite_ip INT, p_limite_fonte INT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- faxina leve: some com o que tem mais de um dia
  IF random() < 0.02 THEN
    DELETE FROM lead_intake_hits WHERE created_at < NOW() - INTERVAL '1 day';
  END IF;
  IF (SELECT count(*) FROM lead_intake_hits
      WHERE ip_hash = p_ip_hash AND created_at > NOW() - INTERVAL '10 minutes') >= p_limite_ip THEN
    RETURN FALSE;
  END IF;
  IF (SELECT count(*) FROM lead_intake_hits
      WHERE source_id = p_source AND created_at > NOW() - INTERVAL '1 hour') >= p_limite_fonte THEN
    RETURN FALSE;
  END IF;
  INSERT INTO lead_intake_hits (source_id, ip_hash) VALUES (p_source, p_ip_hash);
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.registrar_envio_lead(UUID, TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_envio_lead(UUID, TEXT, INT, INT) TO service_role;

-- 4. Módulos em beta (src/lib/beta.ts): só leitura também no banco.
--    Para liberar um módulo, apague as regras "beta_somente_leitura_*" dele.
DO $$
DECLARE t TEXT; op TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['automations', 'automation_steps', 'flows', 'flow_nodes',
                           'ai_configs', 'ai_knowledge_documents', 'ai_knowledge_chunks'] LOOP
    FOREACH op IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'beta_somente_leitura_' || lower(op), t);
      IF op = 'INSERT' THEN
        EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (false)',
                       'beta_somente_leitura_' || lower(op), t);
      ELSE
        EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR %s TO authenticated USING (false)',
                       'beta_somente_leitura_' || lower(op), t, op);
      END IF;
    END LOOP;
  END LOOP;
END $$;
