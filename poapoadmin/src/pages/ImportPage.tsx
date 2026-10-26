import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getToken } from "../lib/api";
import EmbeddingStatus from "../components/EmbeddingStatus";
import { useQuiz } from "../contexts/QuizContext";
import { catalogAxes, CatalogSelect, useCatalogSelection } from "../lib/catalogs";
import {
  PRODUCT_TARGETS, destinationKind, destinationLabel, duplicateTargets, exampleCsv,
  type FieldMapping, type ImportPreview, type ImportResult,
} from "../lib/importGuide";

/** « Pays d'origine » → « paysDOrigine » : nom d'attribut dérivé de la colonne CSV. */
function attributeKeyFromColumn(column: string): string {
  const words = column
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const key = words
    .map((word, index) => (index === 0 ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1).toLowerCase()))
    .join("")
    .replace(/^[0-9]+/, "");
  return (key || "attribut").slice(0, 40);
}

type Step = 1 | 2 | 3;
interface ParsedData {
  headers: string[];
  rows: Record<string, string>[];
  suggestedMapping: FieldMapping[];
  total: number;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;



// ─── Component ────────────────────────────────────────────────────────────────
export default function ImportPage() {
  const navigate = useNavigate();
  const { quizzes } = useQuiz();
  const { catalogs, catalog, catalogId, setCatalogId, loading: catalogsLoading } = useCatalogSelection({ allowAll: false });
  const axes = useMemo(() => catalogAxes(quizzes, catalogId), [quizzes, catalogId]);
  const industries = useMemo(
    () => [...new Set(quizzes.filter((q) => q.catalogId === catalogId && q.industry).map((q) => q.industry))],
    [quizzes, catalogId],
  );
  const catalogPath = catalogId ? `/catalog?catalogId=${encodeURIComponent(catalogId)}` : "/catalog";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importKey = useRef(crypto.randomUUID());

  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [parsedData, setParsedData] = useState<ParsedData | null>(null);
  const [mapping, setMapping] = useState<FieldMapping[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const authHeaders = { Authorization: `Bearer ${getToken() ?? ""}` };
  const duplicates = useMemo(() => duplicateTargets(mapping), [mapping]);
  const hasNameField = mapping.some((m) => m.targetField === "name");
  const ignoredColumns = mapping.filter((m) => !m.targetField);
  const unmappedAxes = axes.filter((axis) => !mapping.some((m) => m.targetField === `attribute.${axis.key}`));
  const mappingValid = hasNameField && duplicates.size === 0;

  const chooseFile = (candidate: File | undefined) => {
    if (!candidate) return;
    setParsedData(null);
    setPreview(null);
    if (!candidate.name.toLowerCase().endsWith(".csv") && candidate.type !== "text/csv") {
      setFile(null);
      setError("Format non accepté : sélectionnez un fichier .csv (exportez un fichier Excel en CSV).");
      return;
    }
    if (candidate.size === 0) {
      setFile(null);
      setError("Le fichier est vide.");
      return;
    }
    if (candidate.size > MAX_FILE_BYTES) {
      setFile(null);
      setError("Le fichier dépasse 5 Mo.");
      return;
    }
    setError("");
    setFile(candidate);
  };

  // Étape 1 : analyse du fichier (lecture seule côté serveur).
  const handleParse = async () => {
    if (!file) return;
    setIsLoading(true);
    setError("");
    const formData = new FormData();
    formData.append("file", file);
    if (catalogId) formData.append("catalogId", catalogId);
    try {
      const res = await fetch("/api/catalog/import/parse", { method: "POST", headers: authHeaders, body: formData });
      const data = (await res.json()) as ParsedData & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
      if (data.total === 0) throw new Error("Le fichier ne contient aucune ligne de données sous l'en-tête.");
      setParsedData(data);
      setMapping(data.suggestedMapping);
      setPreview(null);
    } catch (err) {
      setParsedData(null);
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const setTargetField = (col: string, target: string | null) => {
    setPreview(null);
    setMapping((prev) => prev.map((m) => (m.sourceColumn === col ? { ...m, targetField: target || null, auto: false } : m)));
  };

  // Étape 3 : validation côté serveur, sans aucune écriture.
  const goToPreview = async () => {
    if (!parsedData || !mappingValid) return;
    setIsLoading(true);
    setError("");
    try {
      const res = await fetch("/api/catalog/import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ mapping, rows: parsedData.rows, catalogId }),
      });
      const data = (await res.json()) as ImportPreview & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
      importKey.current = crypto.randomUUID();
      setPreview(data);
      setStep(3);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  // Seule action qui écrit : déclenchée par le bouton de confirmation.
  // La clé d'idempotence est liée à la prévisualisation : un rejeu (double clic, coupure réseau) ne recrée rien.
  const handleExecute = async (allowDuplicate = false) => {
    if (!parsedData || !preview?.canImport) return;
    if (allowDuplicate) importKey.current = crypto.randomUUID();
    setIsLoading(true);
    setError("");
    try {
      const res = await fetch("/api/catalog/import/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": importKey.current, ...authHeaders },
        body: JSON.stringify({ mapping, rows: parsedData.rows, catalogId, allowDuplicate }),
      });
      const data = (await res.json()) as ImportResult & { error?: string; code?: string };
      if (res.status === 409 && data.code === "duplicate_import") {
        setIsLoading(false);
        if (window.confirm("Ce fichier a déjà été importé dans ce catalogue. Importer à nouveau crée des doublons. Continuer ?")) {
          await handleExecute(true);
        }
        return;
      }
      if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const downloadExample = () => {
    const url = URL.createObjectURL(new Blob([exampleCsv(axes)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "exemple-import-poapo.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const STEP_LABELS = ["Fichier", "Colonnes", "Vérifier et importer"] as const;
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Import catalogue</h1>
          <p className="page-subtitle">Importez vos produits depuis un fichier CSV en trois étapes</p>
        </div>
        <button type="button" className="btn-ghost" onClick={() => navigate(catalogPath)}>
          Annuler
        </button>
      </div>

      <div className="import-steps">
        {STEP_LABELS.map((label, i) => (
          <div key={label} className={`import-step${step === i + 1 ? " active" : step > i + 1 || result ? " done" : ""}`}>
            <span className="import-step-num">{step > i + 1 || result ? "✓" : i + 1}</span>
            <span className="import-step-label">{label}</span>
          </div>
        ))}
      </div>

      {error && <div className="form-error" role="alert">{error}</div>}

      {step === 1 ? (
        <CatalogSelect catalogs={catalogs} value={catalogId} onChange={(id) => { setCatalogId(id); setParsedData(null); setPreview(null); }} id="import-catalog" label="Catalogue de destination" disabled={catalogsLoading || isLoading} />
      ) : (
        <div className="catalog-banner">
          Catalogue de destination : <strong>{catalog?.name ?? "—"}</strong>
        </div>
      )}

      {/* ── Étape 1 : fichier ── */}
      {step === 1 && (
        <section className="form-section">
          <h2 className="section-title">1. Sélectionner un fichier CSV</h2>
          <p className="section-hint">
            Format accepté : fichier <strong>.csv</strong> (5 Mo et 5 000 lignes maximum), avec une ligne d'en-tête et une colonne « Nom » obligatoire.
            Pour un fichier Excel, exportez-le d'abord en CSV. Rien n'est enregistré avant votre confirmation à l'étape 3.
          </p>
          <div className="import-example">
            <button type="button" className="btn-ghost" onClick={downloadExample}>Télécharger un exemple CSV</button>
            <span className="section-hint">
              {axes.length > 0
                ? `Adapté à ce catalogue${industries.length ? ` (${industries.join(", ")})` : ""} : une colonne par axe de recommandation (${axes.map((a) => a.label).join(", ")}), valeurs entre 0 et 1.`
                : "Ce catalogue n'a pas encore d'axe de recommandation : l'exemple ne contient que les champs produit."}
            </span>
          </div>

          <div
            className={`drop-zone${isDragging ? " dragging" : ""}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragging(false); chooseFile(e.dataTransfer.files[0]); }}
          >
            <input ref={fileInputRef} type="file" accept=".csv,text/csv" aria-label="Fichier CSV" style={{ display: "none" }} onChange={(e) => chooseFile(e.target.files?.[0])} />
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

          {parsedData && (
            <div className="import-summary">
              <strong>{plural(parsedData.total, "ligne")}</strong> détectée{parsedData.total > 1 ? "s" : ""} · <strong>{plural(parsedData.headers.length, "colonne")}</strong> :{" "}
              {parsedData.headers.map((h) => <code key={h} className="import-col">{h}</code>)}
            </div>
          )}

          <div className="form-actions">
            {parsedData ? (
              <button type="button" className="btn-primary" onClick={() => setStep(2)}>Associer les colonnes →</button>
            ) : (
              <button type="button" className="btn-primary" disabled={!file || isLoading || !catalogId} onClick={handleParse}>
                {isLoading ? "Analyse en cours..." : "Analyser le fichier"}
              </button>
            )}
          </div>
        </section>
      )}

      {/* ── Étape 2 : correspondance des colonnes ── */}
      {step === 2 && parsedData && (
        <section className="form-section">
          <div className="section-header-row">
            <div>
              <h2 className="section-title">2. Associer les colonnes</h2>
              <p className="section-hint">
                {plural(parsedData.total, "ligne")} · les correspondances marquées « auto » sont des suggestions évidentes, modifiables. Aucun axe ni aucune valeur n'est inventé.
              </p>
            </div>
            <button type="button" className="btn-ghost" onClick={() => setStep(1)}>← Retour</button>
          </div>

          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="table">
              <thead>
                <tr><th>Colonne du fichier</th><th>Destination POAPO</th><th>Exemple de valeur</th></tr>
              </thead>
              <tbody>
                {mapping.map(({ sourceColumn, targetField, auto }) => {
                  const kind = destinationKind(targetField, axes);
                  const example = parsedData.rows.find((row) => (row[sourceColumn] ?? "").trim())?.[sourceColumn] ?? "—";
                  const free = `attribute.${attributeKeyFromColumn(sourceColumn)}`;
                  const freeOptions = [...new Set([free, ...(kind === "attribute" && targetField ? [targetField] : [])])]
                    .filter((value) => !axes.some((axis) => `attribute.${axis.key}` === value));
                  return (
                    <tr key={sourceColumn} className={targetField && duplicates.has(targetField) ? "import-row-conflict" : kind === "ignored" ? "import-row-ignored" : undefined}>
                      <td><code style={{ fontSize: 12 }}>{sourceColumn}</code></td>
                      <td>
                        <select
                          className="field-select"
                          aria-label={`Destination de la colonne ${sourceColumn}`}
                          value={targetField ?? ""}
                          onChange={(e) => setTargetField(sourceColumn, e.target.value || null)}
                          style={{ width: "100%" }}
                        >
                          <option value="">— Ignorer cette colonne —</option>
                          <optgroup label="Champs produit">
                            {PRODUCT_TARGETS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                          </optgroup>
                          {axes.length > 0 && (
                            <optgroup label="Axes de recommandation (valeur entre 0 et 1)">
                              {axes.map((axis) => <option key={axis.key} value={`attribute.${axis.key}`}>Axe : {axis.label}</option>)}
                            </optgroup>
                          )}
                          <optgroup label="Attributs sectoriels (informations libres)">
                            {freeOptions.map((value) => <option key={value} value={value}>Attribut « {value.slice("attribute.".length)} »</option>)}
                          </optgroup>
                        </select>
                        <div className="import-dest-note">
                          {kind === "ignored" && <span className="import-warn">⚠ Colonne ignorée : ses valeurs ne seront pas importées.</span>}
                          {targetField && duplicates.has(targetField) && <span className="import-error">Destination déjà utilisée par une autre colonne.</span>}
                          {kind === "axis" && <span className="import-tag">Axe de recommandation</span>}
                          {kind === "attribute" && <span className="import-tag">Attribut sectoriel</span>}
                          {kind === "product" && <span className="import-tag">Champ produit</span>}
                          {auto && <span className="import-tag import-tag-auto">auto</span>}
                        </div>
                      </td>
                      <td className="table-preview-cell">{example}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!hasNameField && <p className="form-error" style={{ marginTop: 8 }}>Associez une colonne au « Nom » (obligatoire).</p>}
          {duplicates.size > 0 && <p className="form-error" style={{ marginTop: 8 }}>Chaque destination ne peut être utilisée que par une colonne.</p>}
          {ignoredColumns.length > 0 && (
            <p className="import-warn">⚠ {plural(ignoredColumns.length, "colonne ignorée", "colonnes ignorées")} : {ignoredColumns.map((m) => `« ${m.sourceColumn} »`).join(", ")}.</p>
          )}
          {unmappedAxes.length > 0 && (
            <p className="import-warn">⚠ Axes sans colonne : {unmappedAxes.map((a) => a.label).join(", ")}. Les produits importés seront moins bien classés sur ces axes.</p>
          )}

          <div className="form-actions">
            <button type="button" className="btn-primary" disabled={!mappingValid || isLoading} onClick={goToPreview}>
              {isLoading ? "Vérification..." : "Vérifier les données →"}
            </button>
          </div>
        </section>
      )}

      {/* ── Étape 3 : prévisualisation et confirmation ── */}
      {step === 3 && parsedData && preview && !result && (
        <section className="form-section">
          <div className="section-header-row">
            <div>
              <h2 className="section-title">3. Vérifier et importer</h2>
              <p className="section-hint">Aucune donnée n'a été enregistrée pour l'instant. L'import ne démarre qu'après votre confirmation.</p>
            </div>
            <button type="button" className="btn-ghost" onClick={() => setStep(2)}>← Modifier les colonnes</button>
          </div>

          <div className="import-result">
            <div className="import-result-stat"><span className="import-result-num import-result-ok">{preview.valid}</span><span>{preview.valid > 1 ? "produits valides" : "produit valide"}</span></div>
            <div className="import-result-stat"><span className="import-result-num import-result-skip">{preview.invalid}</span><span>{preview.invalid > 1 ? "lignes en erreur (non importées)" : "ligne en erreur (non importée)"}</span></div>
            <div className="import-result-stat"><span className="import-result-num">{preview.warningRows}</span><span>{preview.warningRows > 1 ? "lignes avec avertissement" : "ligne avec avertissement"}</span></div>
          </div>

          {preview.mappingIssues.filter((i) => i.severity === "error").map((i) => <p key={i.message} className="import-error">⛔ {i.message}</p>)}
          {preview.mappingIssues.filter((i) => i.severity === "warning").map((i) => <p key={i.message} className="import-warn">⚠ {i.message}</p>)}

          {preview.sample.length > 0 && (
            <>
              <h3 className="section-title" style={{ fontSize: 14, marginTop: 16 }}>Aperçu des {plural(preview.sample.length, "premier produit valide", "premiers produits valides")}</h3>
              <div className="table-wrap" style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead><tr><th>Ligne</th><th>Nom</th><th>Prix</th><th>Caractéristiques / axes</th></tr></thead>
                  <tbody>
                    {preview.sample.map(({ line, product }) => (
                      <tr key={line}>
                        <td>{line}</td>
                        <td>{String(product.name ?? "")}</td>
                        <td>{typeof product.price === "number" ? product.price : "—"}</td>
                        <td className="table-preview-cell">
                          {Object.entries((product.attributes as Record<string, unknown> | undefined) ?? {})
                            .map(([k, v]) => `${destinationLabel(`attribute.${k}`, axes).replace(/^(Axe|Attribut) : /, "")} = ${String(v)}`).join(" · ") || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {preview.issues.length > 0 && (
            <>
              <h3 className="section-title" style={{ fontSize: 14, marginTop: 16 }}>Détail ligne par ligne</h3>
              <ul className="import-issues">
                {preview.issues.map((issue, i) => (
                  <li key={i} className={issue.severity === "error" ? "import-error" : "import-warn"}>
                    <strong>{issue.severity === "error" ? "Erreur bloquante" : "Avertissement"} · ligne {issue.line}</strong> — {issue.message}
                  </li>
                ))}
              </ul>
              {preview.issuesTruncated && <p className="section-hint">Seuls les premiers problèmes sont affichés ; corrigez-les puis relancez la vérification.</p>}
              {preview.invalid > 0 && <p className="section-hint">Les lignes en erreur seront ignorées ; vous pouvez aussi corriger le fichier et le réimporter.</p>}
            </>
          )}

          <div className="form-actions">
            <button type="button" className="btn-ghost" disabled={isLoading} onClick={() => navigate(catalogPath)}>Annuler sans importer</button>
            <button type="button" className="btn-primary" disabled={isLoading || !preview.canImport} onClick={() => handleExecute()}>
              {isLoading ? "Import en cours..." : `Confirmer l'import de ${plural(preview.valid, "produit")}`}
            </button>
          </div>
        </section>
      )}

      {/* ── Résultat ── */}
      {result && (
        <section className="form-section">
          <h2 className="section-title">Import terminé</h2>
          <div className="import-result">
            <div className="import-result-stat">
              <span className="import-result-num import-result-ok">{result.created}</span>
              <span>{result.created > 1 ? "produits importés" : "produit importé"}</span>
            </div>
            {result.skipped > 0 && (
              <div className="import-result-stat">
                <span className="import-result-num import-result-skip">{result.skipped}</span>
                <span>{result.skipped > 1 ? "lignes ignorées" : "ligne ignorée"}</span>
              </div>
            )}
          </div>
          {result.embeddings === "queued" && catalogId && <EmbeddingStatus catalogId={catalogId} />}
          {result.embeddings === "unavailable" && (
            <p className="import-warn">⚠ Le service de préparation des recommandations n'est pas configuré : les produits importés restent en attente et seront classés uniquement sur leurs axes tant qu'il n'est pas disponible.</p>
          )}
          {result.errors.length > 0 && (
            <div className="form-error" style={{ marginTop: 12 }}>
              <strong>Lignes non importées :</strong>
              <ul style={{ marginTop: 4, paddingLeft: 20 }}>{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </div>
          )}
          <div className="form-actions">
            <button type="button" className="btn-primary" onClick={() => navigate(catalogPath)}>Voir les produits du catalogue</button>
          </div>
        </section>
      )}
    </div>
  );
}
