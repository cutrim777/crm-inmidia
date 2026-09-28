/**
 * In Mídia: organiza o que chega de um formulário de site.
 *
 * Cada site chama os campos de um jeito (nome, name, nome_completo,
 * telefone, whatsapp, celular...). Aqui eles viram sempre os mesmos
 * quatro campos do contato, e o resto vira a nota do lead.
 */

const APELIDOS: Record<"name" | "phone" | "email" | "company", string[]> = {
  name: ["nome", "name", "nome_completo", "nomecompleto", "full_name", "fullname", "seu_nome"],
  phone: ["telefone", "phone", "whatsapp", "celular", "tel", "fone", "telefone_whatsapp", "numero"],
  email: ["email", "e-mail", "e_mail", "mail"],
  company: ["empresa", "company", "negocio", "nome_negocio", "nome_empresa", "clinica", "loja"],
};

// campos que não são resposta de quem preencheu
const IGNORAR = new Set(["website", "_gotcha", "token", "chave", "honeypot"]);

// armadilha de robô: campo escondido que gente não preenche
export const HONEYPOT = ["website", "_gotcha", "honeypot"];

const chave = (k: string) =>
  k.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/[\s-]+/g, "_");

export interface LeadCampos {
  name: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
  extras: Array<[string, string]>;
}

function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map(String).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v).trim();
  return s ? s.slice(0, 2000) : null;
}

export function separaCampos(corpo: Record<string, unknown>): LeadCampos {
  const out: LeadCampos = { name: null, phone: null, email: null, company: null, extras: [] };
  for (const [k, v] of Object.entries(corpo)) {
    const c = chave(k);
    if (IGNORAR.has(c)) continue;
    const valor = texto(v);
    if (!valor) continue;
    const alvo = (Object.keys(APELIDOS) as Array<keyof typeof APELIDOS>).find(
      (campo) => APELIDOS[campo].includes(c) && !out[campo]
    );
    if (alvo) out[alvo] = valor;
    else out.extras.push([k, valor]);
  }
  if (out.email) out.email = out.email.toLowerCase();
  return out;
}

/**
 * Telefone como o CRM exige (+ e código do país). Número brasileiro
 * sem +55 (10 ou 11 dígitos, com ou sem 0 na frente) ganha o +55.
 * Devolve null se não der para entender.
 */
export function telefoneInternacional(bruto: string | null): string | null {
  if (!bruto) return null;
  const limpo = bruto.trim();
  const digitos = limpo.replace(/\D/g, "");
  if (limpo.startsWith("+")) return digitos.length >= 8 ? `+${digitos}` : null;
  const semZero = digitos.replace(/^0+/, "");
  if (semZero.length === 10 || semZero.length === 11) return `+55${semZero}`;
  if (semZero.startsWith("55") && (semZero.length === 12 || semZero.length === 13)) return `+${semZero}`;
  return null;
}

const rotulo = (k: string) => {
  const s = k.replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Texto da nota que fica na linha do tempo do contato. */
export function notaDoLead(
  fonte: string,
  campos: LeadCampos,
  pagina: string | null
): string {
  const linhas = [`Lead do formulário: ${fonte}`];
  if (campos.company) linhas.push(`Empresa: ${campos.company}`);
  if (campos.email) linhas.push(`E-mail: ${campos.email}`);
  for (const [k, v] of campos.extras) linhas.push(`${rotulo(k)}: ${v}`);
  if (pagina) linhas.push(`Página: ${pagina}`);
  return linhas.join("\n");
}
