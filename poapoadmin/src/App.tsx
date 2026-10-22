import { Navigate, NavLink, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import LoginPage from "./pages/LoginPage";
import CatalogPage from "./pages/CatalogPage";
import CatalogsPage from "./pages/CatalogsPage";
import ProductFormPage from "./pages/ProductFormPage";
import SettingsPage from "./pages/SettingsPage";
import ImportPage from "./pages/ImportPage";
import QuizBuilderPage from "./pages/QuizBuilderPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import TenantsAdminPage from "./pages/TenantsAdminPage";
import QuizzesPage from "./pages/QuizzesPage";
import QuizFormPage from "./pages/QuizFormPage";
import CampaignsPage from "./pages/CampaignsPage";
import CampaignFormPage from "./pages/CampaignFormPage";
import CampaignDetailPage from "./pages/CampaignDetailPage";
import CampaignQuizGeneratorPage from "./pages/CampaignQuizGeneratorPage";
import Icon from "./components/Icon";
import { QuizProvider, useQuiz } from "./contexts/QuizContext";

function ProtectedRoute() {
  const { token, loading } = useAuth();
  if (loading) return <div className="loading-screen">Chargement...</div>;
  return token ? <QuizProvider><Outlet /></QuizProvider> : <Navigate to="/login" replace />;
}

function SuperAdminRoute() {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-screen">Chargement...</div>;
  if (!user?.isSuperAdmin) return <Navigate to="/catalog" replace />;
  return <Outlet />;
}

function AppLayout() {
  const { user, logout } = useAuth();
  const { quiz } = useQuiz();
  const quizQuery = quiz ? `?quizId=${encodeURIComponent(quiz.id)}` : "";
  const link = ({ isActive }: { isActive: boolean }) => `admin-side-link${isActive ? " active" : ""}`;
  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand">
          <span className="admin-nav-logo">POAPO</span>
          <span className="admin-nav-label">Back-office</span>
        </div>
        <nav className="admin-side-nav" aria-label="Navigation principale">
          <NavLink className={link} to="/catalogs"><Icon name="box" />Catalogues</NavLink>
          <NavLink className={link} to="/catalog" reloadDocument><Icon name="box" />Produits</NavLink>
          <NavLink className={link} to="/quizzes"><Icon name="quiz" />Quiz</NavLink>
          <NavLink className={link} to={`/quiz-builder${quizQuery}`}><Icon name="builder" />Quiz Builder</NavLink>
          <NavLink className={link} to="/campaigns"><Icon name="megaphone" />Campagnes</NavLink>
          <NavLink className={link} to={`/analytics${quizQuery}`}><Icon name="chart" />Analytics</NavLink>
          {user?.isSuperAdmin && <NavLink className={link} to="/admin/tenants" reloadDocument><Icon name="users" />Tenants</NavLink>}
          <NavLink className={link} to="/settings" reloadDocument><Icon name="gear" />Paramètres</NavLink>
        </nav>
        <div className="admin-sidebar-user">
          <span className="admin-nav-email" title={user?.email}>{user?.email}</span>
          <button type="button" className="btn-ghost btn-sm" onClick={logout}>
            <Icon name="logout" size={16} />
            Déconnexion
          </button>
        </div>
      </aside>
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
            <Route path="/catalogs" element={<CatalogsPage />} />
            <Route path="/catalog" element={<CatalogPage />} />
            <Route path="/catalog/new" element={<ProductFormPage />} />
            <Route path="/catalog/import" element={<ImportPage />} />
            <Route path="/catalog/:id/edit" element={<ProductFormPage />} />
            <Route path="/quiz-builder" element={<QuizBuilderPage />} />
            <Route path="/quizzes" element={<QuizzesPage />} />
            <Route path="/quizzes/new" element={<QuizFormPage />} />
            <Route path="/quizzes/:quizId" element={<QuizFormPage />} />
            <Route path="/campaigns" element={<CampaignsPage />} />
            <Route path="/campaigns/new" element={<CampaignFormPage />} />
            <Route path="/campaigns/:campaignId" element={<CampaignDetailPage />} />
            <Route path="/campaigns/:campaignId/edit" element={<CampaignFormPage />} />
            <Route path="/campaigns/:campaignId/generate-quiz" element={<CampaignQuizGeneratorPage />} />
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
