import { Navigate, Route, Routes } from "react-router-dom";
import "./App.css";
import { TenantProvider } from "./contexts/TenantContext";
import DashboardPage from "./pages/DashboardPage";
import QuizPage from "./pages/QuizPage";

function App() {
  return (
    <TenantProvider>
      <Routes>
        <Route path="/" element={<QuizPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </TenantProvider>
  );
}

export default App;
