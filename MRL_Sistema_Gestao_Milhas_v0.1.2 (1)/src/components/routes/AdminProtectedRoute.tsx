import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { LoadingScreen } from "@/components/routes/LoadingScreen";

type AccessState = "loading" | "allowed" | "mfa" | "denied";

export function AdminProtectedRoute() {
  const { user, loading } = useAuth();
  const [access, setAccess] = useState<AccessState>("loading");

  useEffect(() => {
    if (!user) {
      setAccess("denied");
      return;
    }

    let active = true;
    void (async () => {
      const [{ data: staff }, factors, assurance] = await Promise.all([
        supabase
          .from("staff_members")
          .select("role, active")
          .eq("user_id", user.id)
          .eq("active", true)
          .maybeSingle(),
        supabase.auth.mfa.listFactors(),
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      ]);

      if (!active) return;
      if (!staff) {
        setAccess("denied");
        return;
      }

      const verifiedTotp = factors.data?.totp.some((factor) => factor.status === "verified");
      const currentLevel = assurance.data?.currentLevel;
      setAccess(verifiedTotp && currentLevel === "aal2" ? "allowed" : "mfa");
    })().catch(() => {
      if (active) setAccess("denied");
    });

    return () => {
      active = false;
    };
  }, [user]);

  if (loading || access === "loading") return <LoadingScreen />;
  if (!user || access === "denied") return <Navigate to="/admin/login" replace />;
  if (access === "mfa") return <Navigate to="/admin/mfa" replace />;
  return <Outlet />;
}
