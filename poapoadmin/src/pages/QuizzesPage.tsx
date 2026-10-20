import { Link } from "react-router-dom";
import { useQuiz } from "../contexts/QuizContext";

export default function QuizzesPage() {
  const { quizzes, loading, error } = useQuiz();
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Mes quiz</h1>
          <p className="page-subtitle">Des campagnes indépendantes, un catalogue partagé.</p>
        </div>
        <Link className="btn-primary" to="/quizzes/new">Nouveau quiz</Link>
      </div>
      {loading && <div className="loading-block">Chargement...</div>}
      {error && <div className="form-error">{error}</div>}
      <div className="step-table-wrap">
        <table className="table">
          <thead><tr><th>Quiz</th><th>Secteur</th><th>État</th><th>Actions</th></tr></thead>
          <tbody>
            {quizzes.map((quiz) => (
              <tr key={quiz.id}>
                <td>{quiz.name}{quiz.isDefault ? " (par défaut)" : ""}</td>
                <td>{({ perfume: "Parfum", coffee: "Café", fashion: "Mode", food: "Alimentaire", custom: "Autre" })[quiz.industry]}</td>
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
