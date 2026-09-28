import { NextResponse, type NextRequest } from "next/server";
import { withBase } from "@/lib/base-path";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * In Mídia: para onde leva o link dos e-mails do Supabase (confirmar
 * cadastro, recuperar senha). O projeto original não tinha esta rota,
 * então o link caía no endereço padrão do Supabase e dava erro.
 *
 * Aceita os dois formatos que o Supabase manda:
 *   ?token_hash=...&type=...  (modelo de e-mail da In Mídia)
 *   ?code=...                 (modelo padrão do Supabase)
 * Deu certo: a pessoa já sai logada e vai para `next`.
 * Deu errado: volta para o login com um aviso em português.
 *
 * Dentro de rota, nem redirect() nem request.nextUrl trazem o /crm,
 * então o destino passa por withBase(). Vai como endereço relativo:
 * o navegador resolve no domínio em que está (inmidia.space).
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const code = params.get("code");
  const pedido = params.get("next") ?? "/dashboard";
  // só caminho interno: nada de mandar a pessoa para outro site
  const next = pedido.startsWith("/") && !pedido.startsWith("//") ? pedido : "/dashboard";

  const supabase = await createClient();
  let ok = false;
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }

  const destino = ok ? next : "/login?erro=link";
  return new NextResponse(null, { status: 307, headers: { Location: withBase(destino) } });
}
