-- In Mídia: fecha funções que o Postgres deixa abertas para qualquer um.
-- Por padrão toda função nasce executável por PUBLIC (inclusive visitante
-- sem login, pela rota /rest/v1/rpc). Aqui cada uma fica só com quem usa:
--   · internas (triggers, contadores, webhook, IA)  -> só o servidor
--   · equipe e presença                              -> só quem está logado
--   · ver convite                                    -> logado e visitante

-- internas: só service_role
REVOKE ALL ON FUNCTION public._bcast_bump(uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.broadcast_recipient_aggregate_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_ai_reply_slot(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merge_duplicate_contacts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merge_duplicate_conversations() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_conversation_assigned() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recompute_broadcast_counts(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_webhook_failure(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._bcast_bump(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.broadcast_recipient_aggregate_trigger() TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_ai_reply_slot(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
GRANT EXECUTE ON FUNCTION public.merge_duplicate_contacts() TO service_role;
GRANT EXECUTE ON FUNCTION public.merge_duplicate_conversations() TO service_role;
GRANT EXECUTE ON FUNCTION public.notify_conversation_assigned() TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_broadcast_counts(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_webhook_failure(uuid, integer) TO service_role;

-- equipe: só logado (is_account_member também é usada dentro das regras RLS)
REVOKE ALL ON FUNCTION public.is_account_member(uuid, public.account_role_enum) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.redeem_invitation(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_account_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_member_role(uuid, public.account_role_enum) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.touch_presence(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transfer_account_ownership(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_account_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_member_role(uuid, public.account_role_enum) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.touch_presence(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transfer_account_ownership(uuid) TO authenticated, service_role;

-- funções sem search_path fixo
ALTER FUNCTION public.update_updated_at_column() SET search_path = public;
ALTER FUNCTION public._bcast_cols_for_status(text) SET search_path = public;
ALTER FUNCTION public.update_ai_configs_updated_at() SET search_path = public;
ALTER FUNCTION public.update_ai_knowledge_documents_updated_at() SET search_path = public;
