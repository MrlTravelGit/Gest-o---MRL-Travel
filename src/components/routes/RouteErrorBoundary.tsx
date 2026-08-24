import { Component, type ErrorInfo, type ReactNode } from "react";

interface RouteErrorBoundaryProps {
  children: ReactNode;
}

interface RouteErrorBoundaryState {
  error: Error | null;
}

export class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Falha ao renderizar a rota", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="route-error" role="alert">
        <div className="route-error-card">
          <span className="eyebrow">Erro de carregamento</span>
          <h1>Não foi possível abrir esta página</h1>
          <p>{this.state.error.message || "O módulo encontrou uma resposta incompatível."}</p>
          <div className="route-error-actions">
            <button className="primary-button" onClick={() => window.location.reload()}>Tentar novamente</button>
            <a className="secondary-button" href="/admin">Voltar ao painel</a>
          </div>
        </div>
      </main>
    );
  }
}
