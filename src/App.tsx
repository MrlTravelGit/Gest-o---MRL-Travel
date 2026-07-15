import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AdminProtectedRoute } from "@/components/routes/AdminProtectedRoute";
import { ClientProtectedRoute } from "@/components/routes/ClientProtectedRoute";
import { LoadingScreen } from "@/components/routes/LoadingScreen";

const AdminDashboardPage = lazy(() => import("@/pages/AdminDashboardPage").then((module) => ({ default: module.AdminDashboardPage })));
const AdminClientsPage = lazy(() => import("@/pages/AdminClientsPage").then((module) => ({ default: module.AdminClientsPage })));
const AdminClientDetailPage = lazy(() => import("@/pages/AdminClientDetailPage").then((module) => ({ default: module.AdminClientDetailPage })));
const AdminLoginPage = lazy(() => import("@/pages/AdminLoginPage").then((module) => ({ default: module.AdminLoginPage })));
const AdminMfaPage = lazy(() => import("@/pages/AdminMfaPage").then((module) => ({ default: module.AdminMfaPage })));
const ClientAccessPage = lazy(() => import("@/pages/ClientAccessPage").then((module) => ({ default: module.ClientAccessPage })));
const ClientDashboardPage = lazy(() => import("@/pages/ClientDashboardPage").then((module) => ({ default: module.ClientDashboardPage })));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage").then((module) => ({ default: module.NotFoundPage })));

export default function App() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        <Route path="/" element={<Navigate to="/admin/login" replace />} />
        <Route path="/c/:publicId" element={<ClientAccessPage />} />
        <Route element={<ClientProtectedRoute />}>
          <Route path="/c/:publicId/dashboard" element={<ClientDashboardPage />} />
        </Route>
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route path="/admin/mfa" element={<AdminMfaPage />} />
        <Route element={<AdminProtectedRoute />}>
          <Route path="/admin" element={<AdminDashboardPage />} />
          <Route path="/admin/clientes" element={<AdminClientsPage />} />
          <Route path="/admin/clientes/:clientId" element={<AdminClientDetailPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
