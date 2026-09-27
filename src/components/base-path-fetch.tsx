"use client";

import { BASE_PATH, withBase } from "@/lib/base-path";

/**
 * In Mídia: o app tem dezenas de fetch("/api/...") relativos à raiz.
 * Em vez de mexer em cada um (e brigar com toda atualização do projeto
 * original), o fetch do navegador ganha o prefixo /crm uma vez só,
 * no carregamento do módulo, antes de qualquer componente rodar.
 */
if (typeof window !== "undefined" && BASE_PATH) {
  const w = window as typeof window & { __basePathFetch?: boolean };
  if (!w.__basePathFetch) {
    const original = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
      original(typeof input === "string" ? withBase(input) : input, init);
    w.__basePathFetch = true;
  }
}

export function BasePathFetch() {
  return null;
}
