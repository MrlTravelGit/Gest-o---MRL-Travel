export function LoadingScreen() {
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <span className="spinner" />
      <p>Validando acesso...</p>
    </div>
  );
}
