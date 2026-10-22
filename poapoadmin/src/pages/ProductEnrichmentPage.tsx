import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type {
  AxisEstimate,
  EnrichmentProduct,
  ProductEnrichmentApplyInput,
  ProductEnrichmentApplyResponse,
  ProductEnrichmentContext,
  ProductEnrichmentEstimateInput,
  ProductEnrichmentEstimateResponse,
  ProductEnrichmentResult,
  QuizAxis,
} from "@poapo/types";
import { apiFetch } from "../lib/api";
import { CatalogSelect, useCatalogSelection } from "../lib/catalogs";
import {
  buildUpdates,
  chunk,
  CONFIDENCE_LABELS,
  defaultDecision,
  formatPercent,
  hasExistingValue,
  type ProductDecisions,
  summarizeUpdates,
} from "../lib/productEnrichment";
import AxisSlider from "../components/AxisSlider";
import { useLeaveGuard } from "../hooks/useLeaveGuard";

const LEAVE_MESSAGE = "Des estimations n'ont pas été enregistrées. Quitter la page et les perdre ?";

interface FailedBatch {
  productIds: string[];
  error: string;
}

export default function ProductEnrichmentPage() {
  const { catalogs, catalogId, setCatalogId, loading: catalogsLoading, error: catalogsError } = useCatalogSelection({ allowAll: false });
  const [params, setParams] = useSearchParams();
  const requestedQuizId = params.get("quizId") ?? "";

  const [context, setContext] = useState<ProductEnrichmentContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [axisKeys, setAxisKeys] = useState<string[]>([]);
  const [missingOnly, setMissingOnly] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [failed, setFailed] = useState<FailedBatch[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [results, setResults] = useState<ProductEnrichmentResult[]>([]);
  const [decisions, setDecisions] = useState<Record<string, ProductDecisions>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState("");
  const cancelRef = useRef(false);

  const quiz = context?.quiz ?? null;
  const productById = useMemo(() => new Map((context?.products ?? []).map((product) => [product.id, product])), [context]);
  const axisByKey = useMemo(() => new Map((quiz?.axes ?? []).map((axis) => [axis.key, axis])), [quiz]);
  const locked = running || results.length > 0;
  useLeaveGuard(locked, LEAVE_MESSAGE);

  const loadContext = useCallback(async () => {
    if (!catalogId) return;
    setLoading(true);
    setError("");
    try {
      const query = requestedQuizId ? `?quizId=${encodeURIComponent(requestedQuizId)}` : "";
      const next = await apiFetch<ProductEnrichmentContext>(`/api/catalogs/${catalogId}/enrichment/context${query}`);
      setContext(next);
      setAxisKeys(next.quiz?.axes.map((axis) => axis.key) ?? []);
      setRemaining(next.limits.remaining);
      setSelected(new Set());
    } catch (err) {
      setContext(null);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [catalogId, requestedQuizId]);

  useEffect(() => {
    if (!catalogsLoading) void loadContext();
  }, [catalogsLoading, loadContext]);

  const selectQuiz = (quizId: string) => {
    setParams((previous) => {
      const updated = new URLSearchParams(previous);
      updated.set("quizId", quizId);
      return updated;
    }, { replace: true });
  };

  const changeCatalog = (next: string) => {
    setParams((previous) => {
      const updated = new URLSearchParams(previous);
      updated.delete("quizId");
      return updated;
    }, { replace: true });
    setCatalogId(next);
  };

  const isMissing = (product: EnrichmentProduct) =>
    axisKeys.some((key) => product.axisValues[key] === null || product.invalidAxes.includes(key));
  const visibleProducts = (context?.products ?? []).filter((product) => !missingOnly || isMissing(product));
  const selectedProducts = [...selected].map((id) => productById.get(id)).filter((product): product is EnrichmentProduct => !!product);
  const aiProducts = selectedProducts.filter((product) => product.hasData).length;
  const batchSize = context?.limits.batchSize ?? 10;
  const aiBatches = Math.ceil(aiProducts / batchSize);

  const toggleProduct = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAxis = (key: string) => {
    setAxisKeys((previous) => (previous.includes(key) ? previous.filter((item) => item !== key) : [...previous, key]));
  };

  const mergeResults = (incoming: ProductEnrichmentResult[]) => {
    setResults((previous) => {
      const ids = new Set(incoming.map((result) => result.productId));
      return [...previous.filter((result) => !ids.has(result.productId)), ...incoming];
    });
    setDecisions((previous) => {
      const next = { ...previous };
      for (const result of incoming) {
        next[result.productId] = Object.fromEntries(result.estimates.map((estimate) => [
          estimate.axis,
          defaultDecision(estimate, hasExistingValue(productById.get(result.productId), result, estimate.axis)),
        ]));
      }
      return next;
    });
  };

  const runBatches = async (batches: string[][]) => {
    if (!context?.quiz || !batches.length) return;
    cancelRef.current = false;
    setRunning(true);
    setSaved("");
    setSaveError("");
    setProgress({ done: 0, total: batches.length });
    const failures: FailedBatch[] = [];
    for (const [index, productIds] of batches.entries()) {
      if (cancelRef.current) {
        failures.push(...batches.slice(index).map((ids) => ({ productIds: ids, error: "Lot annulé" })));
        break;
      }
      const input: ProductEnrichmentEstimateInput = { quizId: context.quiz.id, axisKeys, productIds };
      try {
        const response = await apiFetch<ProductEnrichmentEstimateResponse>(`/api/catalogs/${context.catalog.id}/enrichment/estimate`, {
          method: "POST",
          body: JSON.stringify(input),
        });
        mergeResults(response.results);
        setRemaining(response.remaining);
        if (response.warnings.length) setWarnings((previous) => [...previous, ...response.warnings]);
      } catch (err) {
        failures.push({ productIds, error: (err as Error).message });
      }
      setProgress({ done: index + 1, total: batches.length });
    }
    setFailed(failures);
    setRunning(false);
  };

  const startEstimation = () => {
    setWarnings([]);
    setFailed([]);
    void runBatches(chunk([...selected], batchSize));
  };

  const retryFailed = () => {
    const batches = failed.map((batch) => batch.productIds);
    setFailed([]);
    void runBatches(batches);
  };

  const discardResults = () => {
    if (!window.confirm("Abandonner toutes les estimations non enregistrées ?")) return;
    setResults([]);
    setDecisions({});
    setFailed([]);
    setWarnings([]);
    setSaveError("");
  };

  const setDecision = (productId: string, axis: string, patch: Partial<ProductDecisions[string]>) => {
    setDecisions((previous) => ({
      ...previous,
      [productId]: { ...previous[productId], [axis]: { ...previous[productId][axis], ...patch } },
    }));
  };

  const acceptConfidentMissing = () => {
    setDecisions((previous) => {
      const next = { ...previous };
      for (const result of results) {
        for (const estimate of result.estimates) {
          if (estimate.status !== "estimated" || estimate.confidence !== "high") continue;
          if (hasExistingValue(productById.get(result.productId), result, estimate.axis)) continue;
          next[result.productId] = { ...next[result.productId], [estimate.axis]: { ...next[result.productId][estimate.axis], accepted: true } };
        }
      }
      return next;
    });
  };

  const updates = useMemo(() => buildUpdates(results, decisions, productById), [results, decisions, productById]);
  const summary = summarizeUpdates(updates);

  const save = async () => {
    if (!context?.quiz || !updates.length) return;
    const replaceText = summary.replaced ? `\n${summary.replaced} valeur(s) existante(s) seront remplacées.` : "";
    if (!window.confirm(`Enregistrer ${summary.added + summary.replaced} valeur(s) sur ${summary.products} produit(s) ?${replaceText}`)) return;
    setSaving(true);
    setSaveError("");
    try {
      const input: ProductEnrichmentApplyInput = { quizId: context.quiz.id, updates };
      const response = await apiFetch<ProductEnrichmentApplyResponse>(`/api/catalogs/${context.catalog.id}/enrichment/apply`, {
        method: "POST",
        body: JSON.stringify(input),
      });
      setResults([]);
      setDecisions({});
      setFailed([]);
      setWarnings([]);
      setSaved(`${response.added} valeur(s) ajoutée(s) et ${response.replaced} remplacée(s) sur ${response.updatedProducts} produit(s).`);
      await loadContext();
    } catch (err) {
      setSaveError(`${(err as Error).message.replace(/\.?$/, ".")} Relancez l'estimation des produits concernés si leurs valeurs ont changé.`);
    } finally {
      setSaving(false);
    }
  };

  const noAxisQuiz = context && !quiz;

  return (
    <div className="page enrichment-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Enrichissement IA des produits</h1>
          <p className="page-subtitle">
            L'IA propose des valeurs pour les axes d'un quiz à partir des fiches produits. Rien n'est enregistré sans votre validation.
          </p>
        </div>
      </div>

      <section className="form-section">
        <div className="form-grid">
          <CatalogSelect catalogs={catalogs} value={catalogId} onChange={changeCatalog} disabled={locked} />
          <div className="field-group">
            <label className="field-label" htmlFor="enrichment-quiz">Quiz (axes à estimer)</label>
            <select
              id="enrichment-quiz"
              className="field-select"
              value={quiz?.id ?? ""}
              disabled={locked || !context?.quizzes.length}
              onChange={(event) => selectQuiz(event.target.value)}
            >
              {!quiz && <option value="">Aucun quiz avec axes</option>}
              {context?.quizzes.map((item) => (
                <option key={item.id} value={item.id} disabled={!item.axes.length}>
                  {item.name}{item.active ? "" : " (inactif)"}{item.axes.length ? ` — ${item.axes.length} axe(s)` : " — sans axes"}
                </option>
              ))}
            </select>
          </div>
        </div>

        {quiz && (
          <div className="field-group">
            <span className="field-label">Axes à estimer</span>
            <div className="gen-row">
              {quiz.axes.map((axis) => (
                <label key={axis.key} className="checkbox-label">
                  <input type="checkbox" checked={axisKeys.includes(axis.key)} disabled={locked} onChange={() => toggleAxis(axis.key)} />
                  {axis.label} <span className="field-hint">({axis.key})</span>
                </label>
              ))}
            </div>
            {axisKeys.some((key) => context?.sharedAxes[key]?.length) && (
              <p className="field-hint">
                Valeurs partagées : {axisKeys.filter((key) => context?.sharedAxes[key]?.length).map((key) =>
                  `« ${key} » est aussi utilisé par ${context!.sharedAxes[key].join(", ")}`).join(" ; ")}.
              </p>
            )}
          </div>
        )}
      </section>

      {(catalogsLoading || loading) && <div className="loading-block">Chargement...</div>}
      {(catalogsError || error) && <div className="form-error" role="alert">{catalogsError || error}</div>}
      {noAxisQuiz && (
        <div className="gen-warnings">
          Aucun quiz de ce catalogue ne définit d'axes de recommandation. <Link to={`/quizzes?catalogId=${encodeURIComponent(catalogId)}`}>Configurer un quiz</Link>
        </div>
      )}

      {quiz && context && !loading && (
        <section className="form-section">
          <div className="gen-row-between">
            <h2 className="section-title">Produits du catalogue « {context.catalog.name} »</h2>
            <div className="gen-row">
              <label className="checkbox-label">
                <input type="checkbox" checked={missingOnly} onChange={(event) => setMissingOnly(event.target.checked)} />
                Seulement les valeurs manquantes
              </label>
              <button type="button" className="btn-ghost btn-sm" disabled={locked || !visibleProducts.length}
                onClick={() => setSelected(new Set(visibleProducts.map((product) => product.id)))}>
                Tout sélectionner ({visibleProducts.length})
              </button>
              <button type="button" className="btn-ghost btn-sm" disabled={locked || !selected.size} onClick={() => setSelected(new Set())}>
                Désélectionner
              </button>
            </div>
          </div>

          {visibleProducts.length === 0 ? (
            <p className="text-muted">{missingOnly ? "Tous les produits ont une valeur sur les axes choisis." : "Aucun produit dans ce catalogue."}</p>
          ) : (
            <div className="step-table-wrap enrichment-table-wrap">
              <table className="table enrichment-table">
                <thead>
                  <tr>
                    <th aria-label="Sélection" />
                    <th>Produit</th>
                    {axisKeys.map((key) => <th key={key}>{axisByKey.get(key)?.label ?? key}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {visibleProducts.map((product) => (
                    <tr key={product.id}>
                      <td>
                        <input type="checkbox" aria-label={`Sélectionner ${product.name}`} checked={selected.has(product.id)}
                          disabled={locked} onChange={() => toggleProduct(product.id)} />
                      </td>
                      <td>
                        <strong>{product.name}</strong>
                        {!product.active && <span className="badge badge-inactive">Inactif</span>}
                        {!product.hasData && <span className="badge enrichment-badge-nodata" title="Ni description, ni tags, ni caractéristiques">Fiche incomplète</span>}
                      </td>
                      {axisKeys.map((key) => (
                        <td key={key} className={product.axisValues[key] === null ? "text-muted" : undefined}>
                          {product.invalidAxes.includes(key) ? <span className="gen-blocking">invalide</span> : formatPercent(product.axisValues[key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="gen-banner">
            <span>
              {selected.size} produit(s) sélectionné(s) : {aiProducts} envoyé(s) à l'IA en {aiBatches} appel(s) de {batchSize} maximum
              {selected.size > aiProducts && `, ${selected.size - aiProducts} fiche(s) incomplète(s) traitée(s) sans IA`}.
              {" "}Quota restant : {remaining ?? "—"} / {context.limits.hourlyProducts} produits par heure.
              {remaining !== null && aiProducts > remaining && <strong className="gen-blocking"> Sélection supérieure au quota restant.</strong>}
            </span>
            <div className="gen-banner-actions">
              {running ? (
                <button type="button" className="btn-ghost" onClick={() => { cancelRef.current = true; }}>Arrêter après ce lot</button>
              ) : (
                <button type="button" className="btn-primary" disabled={!selected.size || !axisKeys.length || results.length > 0} onClick={startEstimation}>
                  Estimer les valeurs
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {running && (
        <div className="enrichment-progress" role="status">
          <span>Estimation en cours : lot {Math.min(progress.done + 1, progress.total)} sur {progress.total}</span>
          <progress max={progress.total} value={progress.done} />
        </div>
      )}

      {failed.length > 0 && !running && (
        <div className="form-error" role="alert">
          <div className="gen-row-between">
            <span>{failed.length} lot(s) non traité(s) : {[...new Set(failed.map((batch) => batch.error))].join(" ; ")}</span>
            <button type="button" className="btn-ghost btn-sm" onClick={retryFailed}>Relancer ces lots</button>
          </div>
        </div>
      )}

      {saved && <div className="enrichment-success" role="status">{saved} Les embeddings sont recalculés en arrière-plan.</div>}

      {results.length > 0 && (
        <section className="form-section">
          <div className="gen-savebar">
            <div className="gen-savebar-text">
              <strong>{results.length} produit(s) estimé(s) — rien n'est encore enregistré</strong>
              <span>
                Validé : {summary.added} valeur(s) à ajouter, {summary.replaced} à remplacer, sur {summary.products} produit(s).
              </span>
            </div>
            <div className="gen-row">
              <button type="button" className="btn-ghost btn-sm" disabled={running || saving} onClick={acceptConfidentMissing}>
                Valider les valeurs manquantes à confiance élevée
              </button>
              <button type="button" className="btn-ghost btn-sm" disabled={running || saving} onClick={discardResults}>Abandonner</button>
              <button type="button" className="btn-primary" disabled={running || saving || !updates.length} onClick={save}>
                {saving ? "Enregistrement..." : "Enregistrer les valeurs validées"}
              </button>
            </div>
          </div>
          {saveError && <div className="form-error" role="alert">{saveError}</div>}
          {warnings.length > 0 && (
            <ul className="gen-warnings">{[...new Set(warnings)].map((warning) => <li key={warning}>{warning}</li>)}</ul>
          )}

          {results.map((result) => {
            const product = productById.get(result.productId);
            return (
              <article key={result.productId} className="gen-question enrichment-card">
                <h3 className="section-title">{product?.name ?? result.productId}</h3>
                {result.estimates.map((estimate) => (
                  <EstimateRow
                    key={estimate.axis}
                    productId={result.productId}
                    axis={axisByKey.get(estimate.axis) ?? { key: estimate.axis, label: estimate.axis }}
                    estimate={estimate}
                    current={result.currentValues[estimate.axis]}
                    invalid={!!product?.invalidAxes.includes(estimate.axis)}
                    decision={decisions[result.productId]?.[estimate.axis]}
                    disabled={saving}
                    onChange={(patch) => setDecision(result.productId, estimate.axis, patch)}
                  />
                ))}
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}

function EstimateRow({ productId, axis, estimate, current, invalid, decision, disabled, onChange }: {
  productId: string;
  axis: QuizAxis;
  estimate: AxisEstimate;
  current: number | null;
  invalid: boolean;
  decision: ProductDecisions[string] | undefined;
  disabled: boolean;
  onChange: (patch: Partial<ProductDecisions[string]>) => void;
}) {
  if (!decision) return null;
  const existing = current !== null || invalid;
  const id = `estimate-${productId}-${axis.key}`;
  const acceptLabel = existing
    ? `Remplacer la valeur existante (${invalid ? "invalide" : formatPercent(current)})`
    : "Valider cette valeur";
  return (
    <div className={`enrichment-row${decision.accepted ? " accepted" : ""}`}>
      <div className="enrichment-row-slider">
        <AxisSlider
          id={id}
          axis={axis}
          value={decision.value}
          disabled={disabled}
          clearable={false}
          onChange={(value) => onChange({ value, accepted: existing ? decision.accepted : true })}
          hint={
            estimate.status === "estimated" && estimate.confidence
              ? <span className={`badge enrichment-confidence enrichment-confidence--${estimate.confidence}`}>{CONFIDENCE_LABELS[estimate.confidence]}</span>
              : <span className="badge enrichment-confidence enrichment-confidence--none">Données insuffisantes</span>
          }
        />
      </div>
      <div className="enrichment-row-detail">
        <p>{estimate.rationale}</p>
        {estimate.evidence.length > 0 && (
          <p className="field-hint">Extraits : {estimate.evidence.map((quote) => `« ${quote} »`).join(", ")}</p>
        )}
        <p className="field-hint">
          Valeur actuelle : {invalid ? "invalide" : formatPercent(current)}
          {estimate.value !== null && ` · Proposition IA : ${formatPercent(estimate.value)}`}
        </p>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={decision.accepted}
            disabled={disabled || decision.value === ""}
            onChange={(event) => onChange({ accepted: event.target.checked })}
          />
          {decision.value === "" ? "Déplacez le curseur pour saisir une valeur" : acceptLabel}
        </label>
      </div>
    </div>
  );
}
