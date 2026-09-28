"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, QrCode, Smartphone, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * In Mídia: conectar o WhatsApp por QR code (WAHA), sem API oficial.
 * Fala só com /api/whatsapp/waha/conectar; a chave do WAHA fica no servidor.
 */

type Estado =
  | { tipo: "carregando" }
  | { tipo: "desconectado" }
  | { tipo: "iniciando" }
  | { tipo: "qr"; qr: string }
  | { tipo: "conectado"; numero: string | null; nome: string | null }
  | { tipo: "ponteDesligada"; mensagem: string }
  | { tipo: "erro"; mensagem: string };

export function WhatsAppQrCard() {
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });
  const [ocupado, setOcupado] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const parar = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  const consultar = useCallback(async () => {
    try {
      const r = await fetch("/api/whatsapp/waha/conectar", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) return setEstado({ tipo: "erro", mensagem: d.erro ?? "Não foi possível consultar o WhatsApp." });
      if (d.status === "WORKING") {
        parar();
        return setEstado({ tipo: "conectado", numero: d.numero, nome: d.nome });
      }
      if (d.status === "SCAN_QR_CODE" && d.qr) return setEstado({ tipo: "qr", qr: d.qr });
      if (d.status === "PONTE_OFFLINE") {
        return setEstado({ tipo: "ponteDesligada", mensagem: d.erro ?? "O programa do WhatsApp não está rodando agora." });
      }
      if (d.status === "NAO_INICIADA" || d.status === "STOPPED" || d.status === "FAILED") {
        parar();
        return setEstado({ tipo: "desconectado" });
      }
      setEstado({ tipo: "iniciando" });
    } catch {
      setEstado({ tipo: "erro", mensagem: "Sem resposta do servidor do WhatsApp." });
    }
  }, []);

  const acompanhar = useCallback(() => {
    parar();
    timer.current = setInterval(consultar, 4000);
  }, [consultar]);

  useEffect(() => {
    consultar();
    return parar;
  }, [consultar]);

  useEffect(() => {
    if (estado.tipo === "qr" || estado.tipo === "iniciando" || estado.tipo === "ponteDesligada") {
      if (!timer.current) acompanhar();
    }
  }, [estado.tipo, acompanhar]);

  const conectar = async () => {
    setOcupado(true);
    try {
      const r = await fetch("/api/whatsapp/waha/conectar", { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro ?? "Não foi possível iniciar a conexão.");
      setEstado({ tipo: "iniciando" });
      acompanhar();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const desconectar = async () => {
    if (!window.confirm("Desconectar este WhatsApp do CRM? As conversas já salvas continuam no CRM.")) return;
    setOcupado(true);
    try {
      await fetch("/api/whatsapp/waha/conectar", { method: "DELETE" });
      setEstado({ tipo: "desconectado" });
      toast.success("WhatsApp desconectado.");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <QrCode className="h-5 w-5 text-primary" /> WhatsApp por QR code
        </CardTitle>
        <CardDescription>
          Conecta o seu número atual, igual ao WhatsApp Web. As conversas caem na Caixa de entrada do CRM.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {estado.tipo === "carregando" && (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Verificando a conexão...
          </p>
        )}

        {estado.tipo === "erro" && (
          <div className="space-y-3">
            <p className="text-red-400">{estado.mensagem}</p>
            <Button variant="outline" onClick={consultar}>Tentar de novo</Button>
          </div>
        )}

        {estado.tipo === "desconectado" && (
          <div className="space-y-3">
            <p className="text-muted-foreground">Nenhum número conectado.</p>
            <Button onClick={conectar} disabled={ocupado}>
              {ocupado ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Smartphone className="mr-2 h-4 w-4" />}
              Conectar por QR code
            </Button>
          </div>
        )}

        {estado.tipo === "ponteDesligada" && (
          <div className="space-y-2">
            <p className="text-amber-400">{estado.mensagem}</p>
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Esperando a ponte do WhatsApp voltar...
            </p>
          </div>
        )}

        {estado.tipo === "iniciando" && (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Preparando o QR code (leva até 30 segundos)...
          </p>
        )}

        {estado.tipo === "qr" && (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={estado.qr} alt="QR code do WhatsApp" className="h-56 w-56 rounded-lg bg-white p-2" />
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>Abra o WhatsApp no celular do número que vai atender.</li>
              <li>Toque em <span className="text-foreground">Aparelhos conectados</span> e depois em <span className="text-foreground">Conectar aparelho</span>.</li>
              <li>Aponte a câmera para este QR code.</li>
              <li>O QR se renova sozinho. Esta tela muda quando conectar.</li>
            </ol>
          </div>
        )}

        {estado.tipo === "conectado" && (
          <div className="space-y-3">
            <p className="text-foreground">
              ✅ Conectado{estado.nome ? ` como ${estado.nome}` : ""}{estado.numero ? ` (+${estado.numero})` : ""}.
            </p>
            <p className="text-muted-foreground">
              Sem API oficial não existe a regra de 24 horas: dá para responder a qualquer momento. Evite mandar a mesma
              mensagem para muita gente que não chamou, que é o que leva a bloqueio do número.
            </p>
            <Button variant="outline" onClick={desconectar} disabled={ocupado}>
              <Unplug className="mr-2 h-4 w-4" /> Desconectar
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
