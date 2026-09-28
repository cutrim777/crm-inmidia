import { describe, expect, it } from "vitest";
import { notaDoLead, separaCampos, telefoneInternacional } from "./intake";

describe("separaCampos", () => {
  it("entende os nomes de campo dos sites em português", () => {
    const c = separaCampos({
      nome: "Maria da Silva",
      whatsapp: "(62) 99111-2222",
      "E-mail": "Maria@X.com",
      nome_negocio: "Clínica Bem",
      colaboradores: "5 a 10",
    });
    expect(c.name).toBe("Maria da Silva");
    expect(c.phone).toBe("(62) 99111-2222");
    expect(c.email).toBe("maria@x.com");
    expect(c.company).toBe("Clínica Bem");
    expect(c.extras).toEqual([["colaboradores", "5 a 10"]]);
  });

  it("ignora armadilha de robô e campos vazios", () => {
    const c = separaCampos({ nome: "A", website: "spam", obs: "  " });
    expect(c.extras).toEqual([]);
  });

  it("o segundo campo de telefone vira resposta, não sobrescreve", () => {
    const c = separaCampos({ telefone: "62 3333-4444", whatsapp: "62 99999-0000" });
    expect(c.phone).toBe("62 3333-4444");
    expect(c.extras).toEqual([["whatsapp", "62 99999-0000"]]);
  });
});

describe("telefoneInternacional", () => {
  it.each([
    ["(62) 99111-2222", "+5562991112222"],
    ["62 3333-4444", "+556233334444"],
    ["062991112222", "+5562991112222"],
    ["5562991112222", "+5562991112222"],
    ["+1 415 555 0123", "+14155550123"],
  ])("%s -> %s", (entrada, esperado) => {
    expect(telefoneInternacional(entrada)).toBe(esperado);
  });

  it("recusa o que não é telefone", () => {
    expect(telefoneInternacional("123")).toBeNull();
    expect(telefoneInternacional("")).toBeNull();
    expect(telefoneInternacional(null)).toBeNull();
  });
});

describe("notaDoLead", () => {
  it("monta a nota com fonte, respostas e página", () => {
    const campos = separaCampos({ nome: "A", telefone: "62999990000", faturamento: "50 mil" });
    expect(notaDoLead("Consultoria", campos, "https://inmidia.space/consultoria")).toBe(
      "Lead do formulário: Consultoria\nFaturamento: 50 mil\nPágina: https://inmidia.space/consultoria"
    );
  });
});
