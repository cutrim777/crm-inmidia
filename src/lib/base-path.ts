/**
 * In Mídia: o CRM mora em inmidia.space/crm.
 *
 * O Next já prefixa sozinho <Link>, router.push e redirect() com o
 * basePath. O que ele não prefixa é fetch("/api/..."),
 * window.location.href = "/x" e URLs montadas com location.origin.
 * Esses pontos passam por withBase().
 *
 * Sem NEXT_PUBLIC_BASE_PATH o CRM volta a rodar na raiz, igual ao original.
 */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/+$/, "");

export function withBase(path: string): string {
  if (!BASE_PATH || !path.startsWith("/") || path.startsWith("//")) return path;
  if (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`)) return path;
  return `${BASE_PATH}${path}`;
}
