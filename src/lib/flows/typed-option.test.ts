import { describe, expect, it } from "vitest";
import { matchTypedOption } from "./engine";

const botoes = {
  node_type: "send_buttons",
  config: {
    text: "Você já é cliente?",
    buttons: [
      { reply_id: "a", title: "Já sou cliente", next_node_key: "antigo" },
      { reply_id: "b", title: "Primeira vez", next_node_key: "novo" },
    ],
  },
};

const lista = {
  node_type: "send_list",
  config: {
    text: "Assunto?",
    sections: [
      { rows: [{ reply_id: "h", title: "Horário", next_node_key: "horario" }, { reply_id: "v", title: "Valores", next_node_key: "valores" }] },
      { rows: [{ reply_id: "p", title: "Falar com uma pessoa", next_node_key: "humano" }] },
    ],
  },
};

describe("matchTypedOption (WhatsApp por QR)", () => {
  it("número da opção", () => {
    expect(matchTypedOption(botoes, "1")).toBe("antigo");
    expect(matchTypedOption(botoes, " 2. ")).toBe("novo");
    expect(matchTypedOption(lista, "3)")).toBe("humano");
  });
  it("nome da opção, sem ligar para acento e maiúscula", () => {
    expect(matchTypedOption(botoes, "ja sou CLIENTE")).toBe("antigo");
    expect(matchTypedOption(lista, "valores")).toBe("valores");
  });
  it("o que não é opção não casa", () => {
    expect(matchTypedOption(botoes, "9")).toBeNull();
    expect(matchTypedOption(botoes, "talvez")).toBeNull();
    expect(matchTypedOption({ node_type: "send_text", config: {} }, "1")).toBeNull();
  });
});
