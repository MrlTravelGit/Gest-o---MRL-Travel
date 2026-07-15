import { Navigate, Outlet, useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { LoadingScreen } from "@/components/routes/LoadingScreen";

export function ClientProtectedRoute() {
  const { user, loading } = useAuth();
  const { publicId } = useParams();

  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to={`/c/${publicId ?? ""}`} replace />;
  return <Outlet />;
}
