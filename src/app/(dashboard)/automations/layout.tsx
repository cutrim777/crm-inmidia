import { BetaSomenteLeitura } from "@/components/beta-somente-leitura";

// In Mídia: módulo em beta, só visualização (ver src/lib/beta.ts)
export default function Layout({ children }: { children: React.ReactNode }) {
  return <BetaSomenteLeitura>{children}</BetaSomenteLeitura>;
}
