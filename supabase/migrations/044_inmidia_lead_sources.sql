-- In Mídia: fontes de lead (um endereço público por formulário).
--
-- Cada formulário de site ganha um token. O formulário faz POST em
-- /crm/api/v1/leads/<token> e o lead cai na conta dona do token, com as
-- etiquetas da fonte e, se houver etapa de funil, um card nela.
--
-- O token não é segredo (fica no HTML do site): ele só CRIA contato,
-- não lê nem apaga nada. Quem grava é a rota, com a service role.

CREATE TABLE IF NOT EXISTS lead_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  tags TEXT[] NOT NULL DEFAULT '{}',
  pipeline_stage_id UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  leads_count INTEGER NOT NULL DEFAULT 0,
  last_lead_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_sources_account ON lead_sources(account_id);

ALTER TABLE lead_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_sources_select ON lead_sources;
DROP POLICY IF EXISTS lead_sources_write ON lead_sources;
CREATE POLICY lead_sources_select ON lead_sources FOR SELECT USING (is_account_member(account_id));
CREATE POLICY lead_sources_write ON lead_sources FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- contador de leads por fonte, chamado pela rota (service role)
CREATE OR REPLACE FUNCTION public.bump_lead_source(p_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE lead_sources SET leads_count = leads_count + 1, last_lead_at = NOW() WHERE id = p_id;
$$;
REVOKE ALL ON FUNCTION public.bump_lead_source(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_lead_source(UUID) TO service_role;
