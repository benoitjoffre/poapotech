import { Navigate, NavLink, Outlet, Route, Routes, useLocation, useMatch } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import LoginPage from "./pages/LoginPage";
import CatalogPage from "./pages/CatalogPage";
import CatalogsPage from "./pages/CatalogsPage";
import ProductFormPage from "./pages/ProductFormPage";
import SettingsPage from "./pages/SettingsPage";
import SidebarPlan from "./components/SidebarPlan";
import SubscriptionPage from "./pages/SubscriptionPage";
import ImportPage from "./pages/ImportPage";
import QuizBuilderPage from "./pages/QuizBuilderPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import TenantsAdminPage from "./pages/TenantsAdminPage";
import QuizzesPage from "./pages/QuizzesPage";
import QuizFormPage from "./pages/QuizFormPage";
import ExperienceCreatePage from "./pages/ExperienceCreatePage";
import ExpressCreationPage from "./pages/ExpressCreationPage";
import CampaignsPage from "./pages/CampaignsPage";
import CampaignFormPage from "./pages/CampaignFormPage";
import CampaignDetailPage from "./pages/CampaignDetailPage";
import CampaignQuizGeneratorPage from "./pages/CampaignQuizGeneratorPage";
import ExperienceEditorPage, { ExperienceSetupPage } from "./pages/ExperienceEditorPage";
import CampaignQuizEditorPage from "./pages/CampaignQuizEditorPage";
import ProductEnrichmentPage from "./pages/ProductEnrichmentPage";
import HelpCenterPage from "./pages/HelpCenterPage";
import HelpArticlePage from "./pages/HelpArticlePage";
import HomePage from "./pages/HomePage";
import OnboardingPage from "./pages/OnboardingPage";
import LandingPage from "./landing/LandingPage";
import Icon from "./components/Icon";
import { QuizProvider } from "./contexts/QuizContext";
import { TourProvider } from "./tour/TourContext";

function ProtectedRoute() {
  const { token, user, loading } = useAuth();
  const { pathname } = useLocation();
  if (loading) return <div className="loading-screen">Chargement...</div>;
  if (token && user?.onboardingRequired) return <Navigate to="/onboarding" replace />;
  // Visiteur non connecté sur la racine : landing publique (les autres pages restent privées).
  if (!token && pathname === "/") return <LandingPage />;
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
  const campaignEditor = useMatch("/campaigns/:campaignId/quiz-editor");
  const experienceEditor = useMatch("/experiences/*");
  const tourUserId = user && !user.isSuperAdmin ? user.tenantId : null;
  const link = ({ isActive }: { isActive: boolean }) => `admin-side-link${isActive ? " active" : ""}`;
  return (
    <TourProvider userId={tourUserId} suppressOffer={!!campaignEditor || !!experienceEditor}>
    <div className={`admin-layout${user?.isSuperAdmin ? "" : " merchant-layout"}${campaignEditor ? " campaign-editor-layout" : ""}`}>
      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand">
          <span className="admin-nav-logo">POAPO</span>
          <span className="admin-nav-label">{user?.isSuperAdmin ? "Administration" : "Votre espace commerçant"}</span>
        </div>
        <nav className="admin-side-nav" aria-label="Navigation principale">
          {user?.isSuperAdmin ? (
            <NavLink className={link} to="/admin/tenants"><Icon name="users" />Administration des comptes</NavLink>
          ) : <>
            <NavLink className={link} data-tour="nav-home" to="/" end><Icon name="home" />Accueil</NavLink>
            <NavLink className={link} data-tour="nav-products" to="/catalog"><Icon name="box" />Mes produits</NavLink>
            <NavLink className={({ isActive }) => link({ isActive: isActive || !!experienceEditor })} data-tour="nav-experiences" to="/quizzes"><Icon name="quiz" />Mes expériences</NavLink>
            <NavLink className={link} to="/campaigns"><Icon name="megaphone" />Campagnes</NavLink>
            <NavLink className={link} data-tour="nav-results" to="/analytics"><Icon name="chart" />Résultats</NavLink>
            <NavLink className={link} to="/settings"><Icon name="gear" />Paramètres</NavLink>
            <NavLink className={link} to="/help"><Icon name="help" />Centre d'aide</NavLink>
          </>}
        </nav>
        {user && !user.isSuperAdmin && <SidebarPlan />}
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
    </TourProvider>
  );
}

function App() {
  const HomeRoute = () => {
    const { user } = useAuth();
    return user?.isSuperAdmin ? <Navigate to="/admin/tenants" replace /> : <HomePage />;
  };

  return (
    <AuthProvider>
      <Routes>
        <Route path="/welcome" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<HomeRoute />} />
            <Route path="/catalogs" element={<CatalogsPage />} />
            <Route path="/catalog" element={<CatalogPage />} />
            <Route path="/catalog/new" element={<ProductFormPage />} />
            <Route path="/catalog/import" element={<ImportPage />} />
            <Route path="/catalog/:id/edit" element={<ProductFormPage />} />
            <Route path="/enrichment" element={<ProductEnrichmentPage />} />
            <Route path="/quiz-builder" element={<QuizBuilderPage />} />
            <Route path="/quizzes" element={<QuizzesPage />} />
            <Route path="/quizzes/new" element={<QuizFormPage />} />
            <Route path="/quizzes/:quizId" element={<QuizFormPage />} />
            <Route path="/experiences/new" element={<ExperienceCreatePage />} />
            <Route path="/experiences/new/express" element={<ExpressCreationPage />} />
            <Route path="/experiences/:quizId/setup" element={<ExperienceSetupPage />} />
            <Route path="/experiences/:quizId/edit" element={<ExperienceEditorPage />} />
            <Route path="/campaigns" element={<CampaignsPage />} />
            <Route path="/campaigns/new" element={<CampaignFormPage />} />
            <Route path="/campaigns/:campaignId" element={<CampaignDetailPage />} />
            <Route path="/campaigns/:campaignId/edit" element={<CampaignFormPage />} />
            <Route path="/campaigns/:campaignId/generate-quiz" element={<CampaignQuizGeneratorPage />} />
            <Route path="/campaigns/:campaignId/quiz-editor" element={<CampaignQuizEditorPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route element={<SuperAdminRoute />}>
              <Route path="/admin/tenants" element={<TenantsAdminPage />} />
            </Route>
            <Route path="/help" element={<HelpCenterPage />} />
            <Route path="/help/:slug" element={<HelpArticlePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/subscription" element={<SubscriptionPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/catalog" replace />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;
