import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { exchangeDirectAccessToken } from "@/services/direct-access";

export function ClientAccessPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    const referrer = document.createElement("meta");
    referrer.name = "referrer";
    referrer.content = "no-referrer";
    document.head.appendChild(referrer);

    const cacheControl = document.createElement("meta");
    cacheControl.httpEquiv = "Cache-Control";
    cacheControl.content = "no-store";
    document.head.appendChild(cacheControl);

    void exchangeDirectAccessToken(token)
      .then(() => navigate("/c/economia", { replace: true }))
      .catch((directError) => setError(directError instanceof Error ? directError.message : "Link inválido, expirado ou revogado."));

    return () => {
      referrer.remove();
      cacheControl.remove();
    };
  }, [navigate, token]);

  return (
    <main className="access-page">
      <section className="access-card">
        <div className="brand-lockup access-brand">
          <div className="brand-mark">MRL</div>
          <div><strong>MRL Travel</strong><span>Economia protegida</span></div>
        </div>
        <div className="access-form">
          <div className="access-icon">{token ? <LockKeyhole /> : <ShieldCheck />}</div>
          <h1>{token ? "Validando link seguro" : "Link exclusivo necessário"}</h1>
          <p>
            {token
              ? "Estamos abrindo sua página exclusiva de economia. Nenhum código ou dado adicional é necessário."
              : "Para acessar sua economia, use o link exclusivo enviado pela equipe MRL Travel."}
          </p>
          {token && !error && <div className="panel-state">Validando acesso...</div>}
          {error && <div className="form-error" role="alert">{error}</div>}
        </div>
      </section>
    </main>
  );
}
