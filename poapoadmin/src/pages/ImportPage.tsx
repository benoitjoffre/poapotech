import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getToken } from "../lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────
type Step = 1 | 2 | 3;

interface FieldMapping {
  sourceColumn: string;
  targetField: string | null;
}

interface ParsedData {
  headers: string[];
  rows: Record<string, string>[];
  suggestedMapping: FieldMapping[];
  total: number;
}

interface ImportResult {
  created: number;
  skipped: number;
  errors: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────
const TARGET_FIELDS = [
  { value: "name", label: "Nom (obligatoire)" },
  { value: "brand", label: "Marque" },
  { value: "description", label: "Description" },
  { value: "price", label: "Prix" },
  { value: "imageUrl", label: "URL image" },
  { value: "purchaseUrl", label: "URL achat" },
  { value: "concentration", label: "Concentration (EDT, EDP...)" },
  { value: "olfactoryFamily", label: "Famille olfactive" },
  { value: "subFamily", label: "Sous-famille" },
  { value: "genderTarget", label: "Genre  (male / female / unisex)" },
  { value: "priceTier", label: "Gamme (entry / mid / luxury / niche)" },
  { value: "topNotes", label: "Notes de tête (séparées par virgules)" },
  { value: "heartNotes", label: "Notes de cœur (séparées par virgules)" },
  { value: "baseNotes", label: "Notes de fond (séparées par virgules)" },
  { value: "tags", label: "Tags (séparés par virgules)" },
  { value: "freshness", label: "Fraîcheur [0 – 1]" },
  { value: "intensity", label: "Intensité [0 – 1]" },
  { value: "sweetness", label: "Douceur [0 – 1]" },
  { value: "seasons", label: "Saisons (virgules)" },
  { value: "occasions", label: "Occasions (virgules)" },
  { value: "timeOfDay", label: "Moment (virgules)" },
  { value: "active", label: "Actif (true / false)" },
  { value: "featured", label: "Mis en avant (true / false)" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function applyMappingToRow(row: Record<string, string>, mapping: FieldMapping[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const { sourceColumn, targetField } of mapping) {
    if (!targetField) continue;
    result[targetField] = row[sourceColumn] ?? "";
  }
  return result;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function ImportPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [parsedData, setParsedData] = useState<ParsedData | null>(null);
  const [mapping, setMapping] = useState<FieldMapping[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);

  // ── Step 1 : Upload & parse ──────────────────────────────────────────────
  const handleParse = async () => {
    if (!file) return;
    setIsLoading(true);
    setError("");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/catalog/import/parse", {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        body: formData,
      });
      const data = (await res.json()) as ParsedData & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
      setParsedData(data);
      setMapping(data.suggestedMapping);
      setStep(2);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  // ── Step 3 : Execute import ──────────────────────────────────────────────
  const handleExecute = async () => {
    if (!parsedData) return;
    setIsLoading(true);
    setError("");

    try {
      const res = await fetch("/api/catalog/import/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken() ?? ""}`,
        },
        body: JSON.stringify({ mapping, rows: parsedData.rows }),
      });
      const data = (await res.json()) as ImportResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const setTargetField = (col: string, target: string | null) => {
    setMapping((prev) => prev.map((m) => (m.sourceColumn === col ? { ...m, targetField: target || null } : m)));
  };

  const hasNameField = mapping.some((m) => m.targetField === "name");
  const mappedFields = mapping.filter((m) => m.targetField).map((m) => m.targetField as string);
  const previewRows = parsedData ? parsedData.rows.slice(0, 5).map((row) => applyMappingToRow(row, mapping)) : [];

  // ── Drag & drop ──────────────────────────────────────────────────────────
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  };

  const STEP_LABELS = ["Fichier", "Mapping", "Confirmer"] as const;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Import catalogue</h1>
          <p className="page-subtitle">Importez vos produits depuis un fichier CSV</p>
        </div>
        <button type="button" className="btn-ghost" onClick={() => navigate("/catalog")}>
          Annuler
        </button>
      </div>

      {/* Steps indicator */}
      <div className="import-steps">
        {STEP_LABELS.map((label, i) => (
          <div key={label} className={`import-step${step === i + 1 ? " active" : step > i + 1 ? " done" : ""}`}>
            <span className="import-step-num">{step > i + 1 ? "✓" : i + 1}</span>
            <span className="import-step-label">{label}</span>
          </div>
        ))}
      </div>

      {error && <div className="form-error">{error}</div>}

      {/* ── Step 1 : Upload ── */}
      {step === 1 && (
        <section className="form-section">
          <h2 className="section-title">Sélectionner un fichier CSV</h2>
          <p className="section-hint">
            Le fichier doit comporter une ligne d'en-tête. L'IA suggérera le mapping automatiquement si poapoai est actif. Pour un fichier Excel,
            exportez-le en CSV depuis votre logiciel avant l'import.
          </p>

          <div
            className={`drop-zone${isDragging ? " dragging" : ""}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setFile(f);
              }}
            />
            {file ? (
              <div className="drop-zone-content">
                <span className="drop-zone-icon">📄</span>
                <strong>{file.name}</strong>
                <span className="drop-zone-hint">{(file.size / 1024).toFixed(1)} Ko — cliquez pour changer</span>
              </div>
            ) : (
              <div className="drop-zone-content">
                <span className="drop-zone-icon">⬆</span>
                <span>Glisser-déposer ou cliquer pour sélectionner</span>
                <span className="drop-zone-hint">Fichier CSV, max 5 Mo</span>
              </div>
            )}
          </div>

          <div className="form-actions">
            <button type="button" className="btn-primary" disabled={!file || isLoading} onClick={handleParse}>
              {isLoading ? "Analyse en cours..." : "Analyser le fichier"}
            </button>
          </div>
        </section>
      )}

      {/* ── Step 2 : Mapping ── */}
      {step === 2 && parsedData && (
        <section className="form-section">
          <div className="section-header-row">
            <div>
              <h2 className="section-title">Configurer le mapping des colonnes</h2>
              <p className="section-hint">{parsedData.total} lignes détectées · associez chaque colonne source à un champ Poapo</p>
            </div>
            <button type="button" className="btn-ghost" onClick={() => setStep(1)}>
              ← Retour
            </button>
          </div>

          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Colonne source</th>
                  <th>Aperçu (1ère valeur)</th>
                  <th>Champ cible</th>
                </tr>
              </thead>
              <tbody>
                {mapping.map(({ sourceColumn, targetField }) => (
                  <tr key={sourceColumn}>
                    <td>
                      <code style={{ fontSize: 12 }}>{sourceColumn}</code>
                    </td>
                    <td className="table-preview-cell">{parsedData.rows[0]?.[sourceColumn] ?? "—"}</td>
                    <td>
                      <select
                        className="field-select"
                        value={targetField ?? ""}
                        onChange={(e) => setTargetField(sourceColumn, e.target.value || null)}
                        style={{ width: "100%" }}
                      >
                        <option value="">— Ignorer —</option>
                        {TARGET_FIELDS.map((f) => (
                          <option key={f.value} value={f.value}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!hasNameField && (
            <p className="form-error" style={{ marginTop: 8 }}>
              La colonne "Nom" est obligatoire pour importer.
            </p>
          )}

          <div className="form-actions">
            <button type="button" className="btn-primary" disabled={!hasNameField} onClick={() => setStep(3)}>
              Prévisualiser →
            </button>
          </div>
        </section>
      )}

      {/* ── Step 3 : Preview + Confirm ── */}
      {step === 3 && parsedData && !result && (
        <section className="form-section">
          <div className="section-header-row">
            <div>
              <h2 className="section-title">Aperçu (5 premières lignes)</h2>
              <p className="section-hint">
                {parsedData.total} produit{parsedData.total !== 1 ? "s" : ""} seront ajoutés à votre catalogue
              </p>
            </div>
            <button type="button" className="btn-ghost" onClick={() => setStep(2)}>
              ← Mapping
            </button>
          </div>

          <div className="table-wrap" style={{ marginTop: 12, overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  {mappedFields.map((f) => (
                    <th key={f}>{f}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, i) => (
                  <tr key={i}>
                    {mappedFields.map((f) => (
                      <td key={f} className="table-preview-cell">
                        {row[f] || "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="form-actions">
            <button type="button" className="btn-primary" disabled={isLoading} onClick={handleExecute}>
              {isLoading ? "Import en cours..." : `Importer ${parsedData.total} produit${parsedData.total !== 1 ? "s" : ""}`}
            </button>
          </div>
        </section>
      )}

      {/* ── Result ── */}
      {result && (
        <section className="form-section">
          <h2 className="section-title">Import terminé</h2>
          <div className="import-result">
            <div className="import-result-stat">
              <span className="import-result-num import-result-ok">{result.created}</span>
              <span>
                produit{result.created !== 1 ? "s" : ""} importé{result.created !== 1 ? "s" : ""}
              </span>
            </div>
            {result.skipped > 0 && (
              <div className="import-result-stat">
                <span className="import-result-num import-result-skip">{result.skipped}</span>
                <span>
                  ligne{result.skipped !== 1 ? "s" : ""} ignorée{result.skipped !== 1 ? "s" : ""} (sans nom ou erreur)
                </span>
              </div>
            )}
          </div>

          {result.errors.length > 0 && (
            <div className="form-error" style={{ marginTop: 12 }}>
              <strong>Erreurs :</strong>
              <ul style={{ marginTop: 4, paddingLeft: 20 }}>
                {result.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="form-actions">
            <button type="button" className="btn-primary" onClick={() => navigate("/catalog")}>
              Voir le catalogue
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
