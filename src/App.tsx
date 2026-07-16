import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AdminProtectedRoute } from "@/components/routes/AdminProtectedRoute";
import { ClientProtectedRoute } from "@/components/routes/ClientProtectedRoute";
import { LoadingScreen } from "@/components/routes/LoadingScreen";

const AdminDashboardPage = lazy(() => import("@/pages/AdminDashboardPage").then((module) => ({ default: module.AdminDashboardPage })));
const AdminClientsPage = lazy(() => import("@/pages/AdminClientsPage").then((module) => ({ default: module.AdminClientsPage })));
const AdminClientDetailPage = lazy(() => import("@/pages/AdminClientDetailPage").then((module) => ({ default: module.AdminClientDetailPage })));
const AdminCreateClientPage = lazy(() => import("@/pages/admin/AdminCreateClientPage").then((module) => ({ default: module.AdminCreateClientPage })));
const AdminTravelEconomyPage = lazy(() => import("@/pages/admin/AdminTravelEconomyPage").then((module) => ({ default: module.AdminTravelEconomyPage })));
const AdminPointsPage = lazy(() => import("@/pages/admin/AdminPointsPage").then((module) => ({ default: module.AdminPointsPage })));
const AdminFormsPage = lazy(() => import("@/pages/admin/AdminFormsPage").then((module) => ({ default: module.AdminFormsPage })));
const AdminInterestsPage = lazy(() => import("@/pages/admin/AdminInterestsPage").then((module) => ({ default: module.AdminInterestsPage })));
const AdminTransfersPage = lazy(() => import("@/pages/admin/AdminTransfersPage").then((module) => ({ default: module.AdminTransfersPage })));
const AdminManualExitsPage = lazy(() => import("@/pages/admin/AdminManualExitsPage").then((module) => ({ default: module.AdminManualExitsPage })));
const AdminClubsPage = lazy(() => import("@/pages/admin/AdminClubsPage").then((module) => ({ default: module.AdminClubsPage })));
const AdminInvoicesPage = lazy(() => import("@/pages/admin/AdminInvoicesPage").then((module) => ({ default: module.AdminInvoicesPage })));
const AdminMovementsPage = lazy(() => import("@/pages/admin/AdminMovementsPage").then((module) => ({ default: module.AdminMovementsPage })));
const AdminAccessLinksPage = lazy(() => import("@/pages/admin/AdminAccessLinksPage").then((module) => ({ default: module.AdminAccessLinksPage })));
const AdminClientEconomyPreviewPage = lazy(() => import("@/pages/admin/AdminClientEconomyPreviewPage").then((module) => ({ default: module.AdminClientEconomyPreviewPage })));
const AdminLoginPage = lazy(() => import("@/pages/AdminLoginPage").then((module) => ({ default: module.AdminLoginPage })));
const ClientAccessPage = lazy(() => import("@/pages/ClientAccessPage").then((module) => ({ default: module.ClientAccessPage })));
const ClientEconomyPage = lazy(() => import("@/pages/ClientEconomyPage").then((module) => ({ default: module.ClientEconomyPage })));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage").then((module) => ({ default: module.NotFoundPage })));

export default function App() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        <Route path="/" element={<Navigate to="/admin/login" replace />} />
        <Route path="/c/link/:token" element={<ClientAccessPage />} />
        <Route path="/c/acesso-expirado" element={<ClientAccessPage />} />
        <Route element={<ClientProtectedRoute />}>
          <Route path="/c/economia" element={<ClientEconomyPage />} />
        </Route>
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route path="/admin/mfa" element={<Navigate to="/admin" replace />} />
        <Route element={<AdminProtectedRoute />}>
          <Route path="/admin" element={<AdminDashboardPage />} />
          <Route path="/admin/clientes" element={<AdminClientsPage />} />
          <Route path="/admin/clientes/novo" element={<AdminCreateClientPage />} />
          <Route path="/admin/pessoas/novo" element={<AdminCreateClientPage />} />
          <Route path="/admin/clientes/:clientId" element={<AdminClientDetailPage />} />
          <Route path="/admin/clientes/:clientId/economia" element={<AdminClientEconomyPreviewPage />} />
          <Route path="/admin/clubes" element={<AdminClubsPage />} />
          <Route path="/admin/faturas" element={<AdminInvoicesPage />} />
          <Route path="/admin/movimentacoes" element={<AdminMovementsPage />} />
          <Route path="/admin/auditoria" element={<AdminAccessLinksPage />} />
          <Route path="/admin/acessos" element={<AdminAccessLinksPage />} />
          <Route path="/admin/viagens" element={<AdminTravelEconomyPage />} />
          <Route path="/admin/viagens-e-economia" element={<AdminTravelEconomyPage />} />
          <Route path="/admin/pontuacoes" element={<AdminPointsPage />} />
          <Route path="/admin/formularios" element={<AdminFormsPage />} />
          <Route path="/admin/interesses" element={<AdminInterestsPage />} />
          <Route path="/admin/transferencias" element={<AdminTransfersPage />} />
          <Route path="/admin/saidas" element={<AdminManualExitsPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
