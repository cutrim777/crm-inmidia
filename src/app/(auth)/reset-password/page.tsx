"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LogoIn } from "@/components/logo-in";
import { withBase } from "@/lib/base-path";

/**
 * In Mídia: tela de nova senha. O link do e-mail de recuperação passa
 * por /auth/confirm, que já deixa a pessoa logada, e cai aqui.
 */
export default function ResetPasswordPage() {
  const t = useTranslations("ResetPasswordPage");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) return setError(t("tooShort"));
    if (password !== confirm) return setError(t("mismatch"));

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message.includes("session") ? t("expired") : error.message);
      setLoading(false);
      return;
    }
    window.location.href = withBase("/dashboard");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <LogoIn className="h-12 w-12 rounded-xl" />
          </div>
          <CardTitle className="text-xl text-foreground">{t("title")}</CardTitle>
          <CardDescription className="text-muted-foreground">{t("desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                {error}{" "}
                {error === t("expired") && (
                  <Link href="/forgot-password" className="underline">
                    {t("askAgain")}
                  </Link>
                )}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="password" className="text-foreground">{t("passwordLabel")}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("passwordPlaceholder")}
                required
                className="border-border bg-muted text-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm" className="text-foreground">{t("confirmLabel")}</Label>
              <Input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                className="border-border bg-muted text-foreground"
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t("saving") : t("submit")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
