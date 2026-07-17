import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { ClientDashboardErrorState, ClientDashboardSkeleton, ClientDashboardView } from "@/components/client/ClientDashboardView";
import { getPublicClientDashboardByLink } from "@/services/dashboard";

export function PublicClientDashboardPage() {
  const { token } = useParams();
  const safeTokenKey = token ? createSafeTokenKey(token) : "missing";

  useEffect(() => {
    const referrer = document.createElement("meta");
    referrer.name = "referrer";
    referrer.content = "no-referrer";
    document.head.appendChild(referrer);

    const cacheControl = document.createElement("meta");
    cacheControl.httpEquiv = "Cache-Control";
    cacheControl.content = "no-store";
    document.head.appendChild(cacheControl);

    return () => {
      referrer.remove();
      cacheControl.remove();
    };
  }, []);

  const dashboard = useQuery({
    queryKey: ["public-client-dashboard", safeTokenKey],
    queryFn: () => getPublicClientDashboardByLink(token!),
    enabled: Boolean(token),
    retry: false,
  });

  return (
    <main className="client-dashboard-page">
      {dashboard.isLoading && <ClientDashboardSkeleton />}
      {(dashboard.isError || !token) && <ClientDashboardErrorState />}
      {dashboard.data && <ClientDashboardView dashboard={dashboard.data} onRefresh={() => void dashboard.refetch()} refreshing={dashboard.isFetching} />}
    </main>
  );
}

function createSafeTokenKey(token: string) {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `${token.length}:${(hash >>> 0).toString(16)}`;
}
