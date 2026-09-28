/**
 * In Mídia: módulos em beta ficam só para olhar até estarem rodando
 * liso. A tela mostra tudo mas não aceita clique (BetaSomenteLeitura) e
 * o servidor recusa qualquer gravação nas rotas deles (middleware).
 *
 * Para liberar um módulo, é só tirar da lista.
 */
export const TELAS_BETA = ["/automations", "/flows", "/agents"] as const;

export const APIS_BETA = ["/api/automations", "/api/flows", "/api/ai"] as const;

export const MENSAGEM_BETA =
  "Este módulo está em beta: por enquanto dá para olhar, mas não para mexer.";

/** true quando a requisição tenta gravar num módulo em beta. */
export function gravacaoBloqueada(metodo: string, caminho: string): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(metodo.toUpperCase())) return false;
  return APIS_BETA.some((p) => caminho === p || caminho.startsWith(`${p}/`));
}
