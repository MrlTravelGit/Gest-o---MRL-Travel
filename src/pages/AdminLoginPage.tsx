import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

export function AdminLoginPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) return <Navigate to="/admin" replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (signInError) {
      setError("Credenciais inválidas");
      return;
    }
    navigate("/admin", { replace: true });
  }

  return (
    <div className="access-page admin-access-page">
      <section className="access-card">
        <div className="brand-lockup access-brand">
          <BrandLogo size="large" className="login-brand-logo" />
        </div>
        <form onSubmit={submit} className="access-form">
          <div className="access-icon"><ShieldCheck /></div>
          <h1>Acesso da equipe</h1>
          <p>Entre com e-mail e senha individuais. A autorização administrativa continua validada no backend.</p>
          <label htmlFor="adminEmail">E-mail</label>
          <input id="adminEmail" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required />
          <label htmlFor="adminPassword">Senha</label>
          <input id="adminPassword" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="primary-button" disabled={submitting}>{submitting ? "Entrando..." : "Continuar"}</button>
        </form>
      </section>
    </div>
  );
}
