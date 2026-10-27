import { useRef, useState } from "react";
import { SECTORS, recommend, type Sector } from "./sectors";
import LandingIcon from "./LandingIcon";

/** Démonstration jouable : une question à la fois, la recommandation fictive se met à jour à chaque réponse. */
export default function DemoCard({ sector, onSector, onSignup }: { sector: Sector; onSector: (id: Sector["id"]) => void; onSignup: () => void }) {
  const [picks, setPicks] = useState<(number | undefined)[]>([]);
  const [step, setStep] = useState(0);
  const title = useRef<HTMLParagraphElement>(null);
  const done = step >= sector.questions.length;
  const question = sector.questions[Math.min(step, sector.questions.length - 1)];
  const product = recommend(sector, picks);
  const reset = (id: Sector["id"]) => { setPicks([]); setStep(0); onSector(id); };
  const choose = (i: number) => {
    setPicks((p) => { const next = [...p]; next[step] = i; return next; });
    setTimeout(() => { setStep((s) => s + 1); requestAnimationFrame(() => title.current?.focus()); }, 280);
  };
  const photo = product.photo ?? sector.photo;

  return (
    <div className="lp-demo" role="group" aria-label={`Démonstration interactive, univers ${sector.label}, données fictives`}>
      <div role="tablist" aria-label="Univers de démonstration" className="lp-pilltabs">
        {SECTORS.map((s) => (
          <button key={s.id} type="button" role="tab" id={`demo-tab-${s.id}`} aria-selected={sector.id === s.id} tabIndex={sector.id === s.id ? 0 : -1}
            className={`lp-pilltab${sector.id === s.id ? " on" : ""}`} onClick={() => reset(s.id)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              const i = SECTORS.findIndex((x) => x.id === sector.id);
              const next = SECTORS[(i + (e.key === "ArrowRight" ? 1 : SECTORS.length - 1)) % SECTORS.length];
              reset(next.id);
              requestAnimationFrame(() => document.getElementById(`demo-tab-${next.id}`)?.focus());
            }}>{s.label}</button>
        ))}
      </div>
      <div className="lp-demo-card" role="tabpanel" aria-labelledby={`demo-tab-${sector.id}`}>
        <img className="lp-demo-photo" src={sector.photo} alt="" width="640" height="560" loading="lazy" decoding="async" />
        <div className="lp-demo-q">
          <p className="lp-demo-count">{done ? "Terminé" : `Question ${step + 1} sur ${sector.questions.length}`}</p>
          <div className="lp-progress" aria-hidden="true"><i style={{ width: `${Math.round(((done ? sector.questions.length : step) / sector.questions.length) * 100)}%` }} /></div>
          {done ? (
            <div className="lp-demo-done">
              <p ref={title} tabIndex={-1} className="lp-demo-title">Voici votre sélection !</p>
              <button type="button" className="lp-btn lp-btn-primary" onClick={onSignup}>Créer mon compte <LandingIcon name="arrow" size={16} /></button>
              <button type="button" className="lp-link" onClick={() => { setPicks([]); setStep(0); }}>Recommencer la démo</button>
            </div>
          ) : (
            <div key={`${sector.id}-${step}`} className="lp-fade">
              <p ref={title} tabIndex={-1} className="lp-demo-title">{question.text}</p>
              <div className="lp-opts" role="radiogroup" aria-label={question.text}>
                {question.options.map((o, i) => (
                  <button key={o.label} type="button" role="radio" aria-checked={picks[step] === i} className={`lp-opt${picks[step] === i ? " on" : ""}`} onClick={() => choose(i)}>
                    <span className="lp-radio" aria-hidden="true">{picks[step] === i && <LandingIcon name="check" size={12} />}</span>{o.label}
                  </button>
                ))}
              </div>
              {step > 0 && <button type="button" className="lp-link" onClick={() => setStep(step - 1)}>← Question précédente</button>}
            </div>
          )}
        </div>
        <div className="lp-demo-reco" aria-live="polite">
          <p className="lp-reco-label">{sector.idealLabel}</p>
          <div className="lp-reco-card">
            <img src={photo} alt="" width="120" height="120" loading="lazy" decoding="async" />
            <div><b>{product.name}</b><p>{product.blurb}</p></div>
          </div>
          <div className="lp-tags">{product.tags.map((t) => <span key={t}>{t}</span>)}</div>
          <small>Exemple fictif · calcul de démonstration</small>
        </div>
      </div>
    </div>
  );
}
