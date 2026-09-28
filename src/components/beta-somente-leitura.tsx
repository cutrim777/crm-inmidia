import { Eye } from "lucide-react";
import { MENSAGEM_BETA } from "@/lib/beta";

/**
 * In Mídia: embrulha as telas em beta. O conteúdo aparece, mas fica
 * `inert`: sem clique, sem digitação, sem arrastar, sem foco.
 */
export function BetaSomenteLeitura({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <div className="mx-4 mt-4 flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-foreground sm:mx-6">
        <Eye className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p>
          <span className="font-semibold">Em beta. </span>
          {MENSAGEM_BETA} Estamos terminando os testes para liberar.
        </p>
      </div>
      <div inert className="flex-1 select-none opacity-80">
        {children}
      </div>
    </div>
  );
}
