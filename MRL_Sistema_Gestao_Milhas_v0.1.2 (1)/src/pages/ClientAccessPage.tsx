import { FormEvent, useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { KeyRound, LockKeyhole, Plane } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { requestClientAccess, verifyClientAccess } from "@/services/client-access";

type Step = "name" | "code";

export function ClientAccessPage() {
  const { publicId } = useParams();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [step, setStep] = useState<Step>("name");
  const [firstName, setFirstName] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setError("");
  }, [step]);

  if (!publicId) return <Navigate to="/" replace />;
  if (!loading && user) return <Navigate to={`/c/${publicId}/dashboard`} replace />;

  async function submitName(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const result = await requestClientAccess({ publicId: publicId!, firstName });
      setChallengeId(result.challengeId);
      setMessage(result.message);
      setStep("code");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível continuar");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await verifyClientAccess({
        publicId: publicId!,
        firstName,
        challengeId,
        code,
      });
      navigate(`/c/${publicId}/dashboard`, { replace: true });
    } catch (verificationError) {
      setError(verificationError instanceof Error ? verificationError.message : "Código inválido");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="access-page">
      <div className="access-decoration"><Plane size={44} /></div>
      <section className="access-card">
        <div className="brand-lockup access-brand">
          <div className="brand-mark">MRL</div>
          <div><strong>MRL Travel</strong><span>Gestão exclusiva</span></div>
        </div>

        {step === "name" ? (
          <form onSubmit={submitName} className="access-form">
            <div className="access-icon"><KeyRound /></div>
            <h1>Acesse sua gestão</h1>
            <p>Digite apenas o seu primeiro nome. A validação será concluída pelo contato cadastrado.</p>
            <label htmlFor="firstName">Primeiro nome</label>
            <input
              id="firstName"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              autoComplete="given-name"
              maxLength={60}
              required
            />
            {error && <div className="form-error" role="alert">{error}</div>}
            <button className="primary-button" disabled={submitting || firstName.trim().length < 1}>
              {submitting ? "Validando..." : "Continuar"}
            </button>
          </form>
        ) : (
          <form onSubmit={submitCode} className="access-form">
            <div className="access-icon"><LockKeyhole /></div>
            <h1>Confirme o código</h1>
            <p>{message}</p>
            <label htmlFor="code">Código temporário</label>
            <input
              id="code"
              className="code-input"
              inputMode="numeric"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
              autoComplete="one-time-code"
              required
            />
            {error && <div className="form-error" role="alert">{error}</div>}
            <button className="primary-button" disabled={submitting || code.length < 6}>
              {submitting ? "Confirmando..." : "Entrar no dashboard"}
            </button>
            <button type="button" className="text-button" onClick={() => setStep("name")}>
              Solicitar outro código
            </button>
          </form>
        )}

        <div className="security-note">
          <LockKeyhole size={16} />
          <span>O link identifica sua página. O código temporário protege seus dados.</span>
        </div>
      </section>
    </div>
  );
}
