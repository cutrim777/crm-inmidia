import { describe, expect, it } from "vitest";
import { gravacaoBloqueada } from "./beta";

describe("gravacaoBloqueada", () => {
  it("bloqueia gravação nos módulos em beta", () => {
    expect(gravacaoBloqueada("POST", "/api/automations")).toBe(true);
    expect(gravacaoBloqueada("PATCH", "/api/flows/123")).toBe(true);
    expect(gravacaoBloqueada("DELETE", "/api/ai/knowledge/9")).toBe(true);
  });
  it("deixa olhar e não mexe no resto", () => {
    expect(gravacaoBloqueada("GET", "/api/automations")).toBe(false);
    expect(gravacaoBloqueada("POST", "/api/contacts")).toBe(false);
    expect(gravacaoBloqueada("POST", "/api/whatsapp/waha/webhook")).toBe(false);
    expect(gravacaoBloqueada("POST", "/api/aircraft")).toBe(false);
  });
});
