import { Link } from "react-router-dom";
import { useQuiz } from "../contexts/QuizContext";
import { CatalogSelect, useCatalogSelection } from "../lib/catalogs";

export default function QuizzesPage() {
  const { quizzes, loading, error } = useQuiz();
  const { catalogs, catalog, catalogId, setCatalogId } = useCatalogSelection({ allowAll: true });
  const catalogNames = new Map(catalogs.map((item) => [item.id, item.name]));
  const visible = catalogId ? quizzes.filter((quiz) => quiz.catalogId === catalogId) : quizzes;
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Mes quiz</h1>
          <p className="page-subtitle">Chaque quiz recommande les produits de son catalogue{catalog ? ` · ${catalog.name}` : ""}.</p>
        </div>
        <Link className="btn-primary" to={catalogId ? `/quizzes/new?catalogId=${encodeURIComponent(catalogId)}` : "/quizzes/new"}>Nouveau quiz</Link>
      </div>
      <div className="toolbar">
        <CatalogSelect catalogs={catalogs} value={catalogId} onChange={setCatalogId} allowAll />
      </div>
      {loading && <div className="loading-block">Chargement...</div>}
      {error && <div className="form-error">{error}</div>}
      <div className="step-table-wrap">
        <table className="table">
          <thead><tr><th>Quiz</th><th>Catalogue</th><th>Activité</th><th>Axes</th><th>État</th><th>Actions</th></tr></thead>
          <tbody>
            {!loading && visible.length === 0 && <tr><td colSpan={6}>Aucun quiz dans ce catalogue.</td></tr>}
            {visible.map((quiz) => (
              <tr key={quiz.id}>
                <td>{quiz.name}{quiz.isDefault ? " (par défaut)" : ""}</td>
                <td>{catalogNames.get(quiz.catalogId) ?? "—"}</td>
                <td>{quiz.industry || "—"}</td>
                <td>{quiz.axes.length > 0 ? quiz.axes.map((axis) => axis.label).join(", ") : "—"}</td>
                <td>{quiz.active ? "Actif" : "Désactivé"}</td>
                <td>
                  <Link className="btn-ghost" to={`/quizzes/${quiz.id}`}>Configurer / intégrer</Link>
                  <Link className="btn-ghost" to={`/quiz-builder?quizId=${encodeURIComponent(quiz.id)}`}>Questions</Link>
                  <Link className="btn-ghost" to={`/analytics?quizId=${encodeURIComponent(quiz.id)}`}>Statistiques</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
