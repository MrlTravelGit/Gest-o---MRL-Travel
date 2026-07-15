import { FormEvent, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { KeyRound, ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

export function AdminMfaPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const [factors, assurance] = await Promise.all([
        supabase.auth.mfa.listFactors(),
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      ]);

      if (assurance.data?.currentLevel === "aal2") {
        navigate("/admin", { replace: true });
        return;
      }

      const verified = factors.data?.totp.find((factor) => factor.status === "verified");
      setFactorId(verified?.id ?? null);
      setBusy(false);
    })().catch(() => {
      setError("Não foi possível carregar a autenticação adicional");
      setBusy(false);
    });
  }, [navigate, user]);

  if (!loading && !user) return <Navigate to="/admin/login" replace />;

  async function enroll() {
    setBusy(true);
    setError("");
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "MRL Travel Admin",
    });
    setBusy(false);
    if (enrollError || !data) {
      setError("Não foi possível iniciar a configuração");
      return;
    }
    setFactorId(data.id);
    setQrCode(data.totp.qr_code);
    setSecret(data.totp.secret);
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!factorId) return;
    setBusy(true);
    setError("");
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code,
    });
    setBusy(false);
    if (verifyError) {
      setError("Código inválido. Confira o aplicativo autenticador.");
      return;
    }
    navigate("/admin", { replace: true });
  }

  return (
    <div className="access-page admin-access-page">
      <section className="access-card mfa-card">
        <div className="access-icon"><ShieldCheck /></div>
        <h1>Proteção administrativa</h1>
        {!factorId ? (
          <>
            <p>Configure um aplicativo autenticador antes de acessar dados dos clientes.</p>
            <button className="primary-button" onClick={() => void enroll()} disabled={busy}>
              {busy ? "Carregando..." : "Configurar autenticação"}
            </button>
          </>
        ) : (
          <form onSubmit={verify} className="access-form">
            {qrCode && <img className="mfa-qr" src={qrCode} alt="QR Code para aplicativo autenticador" />}
            {secret && <p className="mfa-secret">Chave manual: <code>{secret}</code></p>}
            <label htmlFor="mfaCode">Código do autenticador</label>
            <div className="input-with-icon"><KeyRound size={18} /><input id="mfaCode" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))} required /></div>
            {error && <div className="form-error" role="alert">{error}</div>}
            <button className="primary-button" disabled={busy || code.length < 6}>{busy ? "Validando..." : "Validar e acessar"}</button>
          </form>
        )}
        {error && !factorId && <div className="form-error" role="alert">{error}</div>}
      </section>
    </div>
  );
}
