import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import LoginPage from "./pages/LoginPage";
import CatalogPage from "./pages/CatalogPage";
import ProductFormPage from "./pages/ProductFormPage";
import SettingsPage from "./pages/SettingsPage";
import ImportPage from "./pages/ImportPage";
import QuizBuilderPage from "./pages/QuizBuilderPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import TenantsAdminPage from "./pages/TenantsAdminPage";

function ProtectedRoute() {
  const { token, loading } = useAuth();
  if (loading) return <div className="loading-screen">Chargement...</div>;
  return token ? <Outlet /> : <Navigate to="/login" replace />;
}

function SuperAdminRoute() {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-screen">Chargement...</div>;
  if (!user?.isSuperAdmin) return <Navigate to="/catalog" replace />;
  return <Outlet />;
}

function AppLayout() {
  const { user, logout } = useAuth();
  return (
    <div className="admin-layout">
      <nav className="admin-nav">
        <div className="admin-nav-brand">
          <span className="admin-nav-logo">poapo</span>
          <span className="admin-nav-label">Back-office</span>
        </div>
        <div className="admin-nav-links">
          <a href="/catalog">Catalogue</a>
          <a href="/quiz-builder">Quiz Builder</a>
          <a href="/analytics">Analytics</a>
          {user?.isSuperAdmin && <a href="/admin/tenants">Tenants</a>}
          <a href="/settings">Paramètres</a>
        </div>
        <div className="admin-nav-user">
          <span className="admin-nav-email">{user?.email}</span>
          <button type="button" className="btn-ghost" onClick={logout}>
            Déconnexion
          </button>
        </div>
      </nav>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}

function App() {
  const HomeRoute = () => {
    const { user } = useAuth();
    return <Navigate to={user?.isSuperAdmin ? "/admin/tenants" : "/catalog"} replace />;
  };

  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<HomeRoute />} />
            <Route path="/catalog" element={<CatalogPage />} />
            <Route path="/catalog/new" element={<ProductFormPage />} />
            <Route path="/catalog/import" element={<ImportPage />} />
            <Route path="/catalog/:id/edit" element={<ProductFormPage />} />
            <Route path="/quiz-builder" element={<QuizBuilderPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route element={<SuperAdminRoute />}>
              <Route path="/admin/tenants" element={<TenantsAdminPage />} />
            </Route>
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/catalog" replace />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;
