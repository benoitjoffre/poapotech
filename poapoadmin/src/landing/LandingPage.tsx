import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { BENEFITS, FAQ, STEPS } from "./data";
import { SECTORS, type Sector } from "./sectors";
import DemoCard from "./DemoCard";
import LandingIcon from "./LandingIcon";
import heroBeans from "./assets/hero-beans.webp";
import recoBag from "./assets/reco-bag.webp";
import "./landing.css";

/** true dès que l'élément entre dans l'écran (ou en l'absence d'IntersectionObserver). */
function useSeen(margin = "0px 0px -8% 0px") {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [seen, margin]);
  return [ref, seen] as const;
}

function Reveal({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const [ref, seen] = useSeen();
  return <div ref={ref} className={`lp-reveal${seen ? " in" : ""} ${className}`} style={{ transitionDelay: `${delay}ms` }}>{children}</div>;
}

function Wordmark() {
  return <Link to="/welcome" className="lp-logo" aria-label="POAPO, accueil"><span aria-hidden="true">●</span>poapo</Link>;
}

const NOTE_ARROWS = (
  <svg className="lp-note-arrows" viewBox="0 0 60 70" fill="none" stroke="#6C47FF" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
    <path d="M52 8C34 6 22 14 18 30" /><path d="M14 24l4 7 7-4" /><path d="M16 62c14 4 28-2 36-16" /><path d="M46 44l7 2-1-8" />
  </svg>
);

export default function LandingPage() {
  const { token, auth0, signIn, loading } = useAuth();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const [sectorId, setSectorId] = useState<Sector["id"]>("cafe");
  const sector = SECTORS.find((s) => s.id === sectorId)!;

  useEffect(() => {
    const previous = document.title;
    document.title = "POAPO — Moins de choix au hasard. Plus de coups de cœur.";
    return () => { document.title = previous; };
  }, []);

  // Un seul système d'authentification : Auth0 quand il est configuré, sinon l'écran de connexion existant.
  const signup = () => (auth0 ? void signIn(true) : navigate("/login"));
  const login = () => (auth0 ? void signIn(false) : navigate("/login"));
  const close = () => setMenu(false);
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scrollTo = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    close();
    document.getElementById(id)?.scrollIntoView({ behavior: reduced() ? "auto" : "smooth" });
  };
  const pickSector = (id: Sector["id"]) => { setSectorId(id); document.getElementById("demo")?.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "center" }); };
  const hide = loading ? ({ visibility: "hidden" } as const) : undefined;
  const Cta = ({ light = false }: { light?: boolean }) => token
    ? <Link className={`lp-btn ${light ? "lp-btn-light" : "lp-btn-primary"} lp-btn-lg`} to="/">Accéder à mon espace <LandingIcon name="arrow" size={18} /></Link>
    : <button type="button" className={`lp-btn ${light ? "lp-btn-light" : "lp-btn-primary"} lp-btn-lg`} onClick={signup}>Créer mon compte <LandingIcon name="arrow" size={18} /></button>;

  return (
    <div className="lp">
      <a className="lp-skip" href="#contenu">Aller au contenu</a>
      <header className="lp-header">
        <div className="lp-wrap lp-nav">
          <Wordmark />
          <button type="button" className="lp-burger" aria-expanded={menu} aria-controls="lp-menu" onClick={() => setMenu(!menu)}>
            <span className="lp-sr">Menu</span><i aria-hidden="true" /><i aria-hidden="true" />
          </button>
          <nav id="lp-menu" className={`lp-menu${menu ? " open" : ""}`} aria-label="Navigation publique">
            <span className="lp-links">
              <a href="#produit" onClick={scrollTo("produit")}>Produit</a>
              <a href="#fonctionnement" onClick={scrollTo("fonctionnement")}>Comment ça marche</a>
              <a href="#faq" onClick={scrollTo("faq")}>Ressources</a>
            </span>
            <span className="lp-menu-cta" style={hide} aria-hidden={loading || undefined}>
              {token ? <Link className="lp-btn lp-btn-primary" to="/" onClick={close}>Accéder à mon espace</Link> : (<>
                <button type="button" className="lp-btn lp-btn-ghost" onClick={login}>Connexion</button>
                <button type="button" className="lp-btn lp-btn-primary" onClick={signup}>Créer mon compte</button>
              </>)}
            </span>
          </nav>
        </div>
      </header>

      <main id="contenu">
        <section id="produit" className="lp-hero" aria-labelledby="lp-h1">
          <div className="lp-wrap lp-hero-grid">
            <div className="lp-hero-copy">
              <p className="lp-pill-eyebrow">Recommandation personnalisée pour commerçants</p>
              <h1 id="lp-h1">Moins de choix au hasard. <em>Plus de coups de cœur.</em></h1>
              <p className="lp-lead">Créez des expériences interactives qui comprennent vos clients et les guident vers les produits, services ou expériences qui leur correspondent.</p>
              <div className="lp-cta-row" style={hide}>
                <Cta />
                <a className="lp-btn lp-btn-outline lp-btn-lg" href="#demo" onClick={scrollTo("demo")}><LandingIcon name="play" size={14} /> Voir une démo</a>
              </div>
              <ul className="lp-checks">
                <li><LandingIcon name="check" size={14} />Sans engagement</li>
                <li><LandingIcon name="check" size={14} />Mise en place rapide</li>
                <li><LandingIcon name="check" size={14} />Adapté à tous les secteurs</li>
              </ul>
            </div>
            <div className="lp-hero-art" aria-hidden="true">
              <div className="lp-blob" />
              <img className="lp-hero-photo" src={heroBeans} width="1100" height="780" alt="" fetchPriority="high" decoding="async" />
              <div className="lp-fcard lp-quizcard">
                <b>Quel café est fait pour vous ?</b>
                <div className="lp-prog"><i /><span>2/5</span></div>
                {["Plutôt doux et chocolaté", "Vif et fruité", "Épicé et boisé", "Équilibré et rond"].map((t, i) => (
                  <div key={t} className={`lp-qopt${i === 0 ? " on" : ""}`}><span className={`lp-thumb t${i}`} />{t}<span className="lp-radio">{i === 0 && <LandingIcon name="check" size={11} />}</span></div>
                ))}
              </div>
              <div className="lp-fcard lp-recocard">
                <small>Votre recommandation</small>
                <img src={recoBag} width="560" height="400" alt="" decoding="async" />
                <b>Café Aube Fruitée</b>
                <div className="lp-tags"><span>Fruité</span><span>Léger</span><span>Équilibré</span></div>
                <p>Un café aux notes de fruits rouges et d'agrumes, parfait pour un réveil en douceur.</p>
                <span className="lp-btn lp-btn-primary lp-btn-sm">Voir le produit <LandingIcon name="arrow" size={13} /></span>
              </div>
              <p className="lp-handnote">Une expérience qui s'adapte à votre univers{NOTE_ARROWS}</p>
              <span className="lp-demo-badge">Exemple illustratif · données fictives</span>
            </div>
          </div>
        </section>

        <section className="lp-benefits" aria-label="Bénéfices">
          <ul className="lp-wrap lp-benefit-list">
            {BENEFITS.map((b, i) => (
              <li key={b.title}><Reveal delay={i * 70}><span className="lp-bicon"><LandingIcon name={b.icon} size={26} /></span><span><b>{b.title}</b><small>{b.text}</small></span></Reveal></li>
            ))}
          </ul>
        </section>

        <section id="demo" className="lp-demo-section" aria-labelledby="lp-demo-h">
          <div className="lp-wrap lp-demo-grid">
            <Reveal className="lp-demo-copy">
              <p className="lp-eyebrow">Essayez dès maintenant</p>
              <h2 id="lp-demo-h">Découvrez la puissance de POAPO en 30 secondes.</h2>
              <p className="lp-lead">Testez une expérience de recommandation complète avec des données de démonstration.</p>
            </Reveal>
            <Reveal><DemoCard sector={sector} onSector={setSectorId} onSignup={signup} /></Reveal>
          </div>
        </section>

        <section className="lp-sectors-section" aria-labelledby="lp-sectors-h">
          <div className="lp-wrap lp-sectors-grid">
            <Reveal className="lp-sectors-copy">
              <p className="lp-eyebrow">Un moteur, mille possibilités</p>
              <h2 id="lp-sectors-h">POAPO s'adapte à tous les univers.</h2>
              <p className="lp-lead">Le même moteur de recommandation, pour tous vos produits, services ou expériences.</p>
            </Reveal>
            <ul className="lp-sector-cards">
              {SECTORS.map((s, i) => (
                <li key={s.id}>
                  <Reveal delay={i * 80}>
                    <button type="button" className={`lp-scard${s.id === sectorId ? " on" : ""}`} onClick={() => pickSector(s.id)} aria-label={`Essayer l'univers ${s.label}`}>
                      <img src={s.photo} alt="" width="640" height="560" loading="lazy" decoding="async" />
                      <span className="lp-scard-body"><b>{s.label}</b><small>{s.tagline}</small><span className="lp-circle"><LandingIcon name="arrow" size={15} /></span></span>
                    </button>
                  </Reveal>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="fonctionnement" className="lp-how" aria-labelledby="lp-how-h">
          <div className="lp-wrap">
            <Reveal><p className="lp-eyebrow">Comment ça marche</p><h2 id="lp-how-h">De votre catalogue à vos recommandations.</h2></Reveal>
            <ol className="lp-steps">
              {STEPS.map((s, i) => (
                <li key={s.title}><Reveal delay={i * 80}>
                  <span className="lp-step-head"><span className="lp-step-n">{i + 1}</span><LandingIcon name={s.icon} size={22} /><b>{s.title}</b></span>
                  <p>{s.text}</p>
                </Reveal></li>
              ))}
            </ol>
          </div>
        </section>

        <section className="lp-panels" aria-label="Widget et résultats">
          <div className="lp-wrap lp-panels-grid">
            <Reveal className="lp-panel-box">
              <div className="lp-panel-copy">
                <p className="lp-eyebrow">Widget embarqué</p>
                <h2>Sur votre site, sans le reconstruire.</h2>
                <p>Une simple balise script ajoute un bouton flottant. Le quiz s'ouvre dans un panneau, aux couleurs de votre marque.</p>
                <pre className="lp-code" aria-label="Exemple de balise d'intégration"><code>{`<script src="…/poapo-widget.js"\n  data-client-id="votre-boutique"></script>`}</code></pre>
              </div>
              <div className="lp-shopmock" role="img" aria-label="Illustration : un site de boutique avec le widget POAPO ouvert">
                <div className="lp-shopbar"><i /><i /><span>ma-boutique.exemple</span></div>
                <div className="lp-shopgrid"><i /><i /><i /><i /><i /><i /></div>
                <div className="lp-shopwidget">
                  <img src={recoBag} width="280" height="200" alt="" loading="lazy" decoding="async" />
                  <b>Trouvez le produit fait pour vous</b>
                  <span className="lp-btn lp-btn-primary lp-btn-sm">Commencer</span>
                  <small>Par poapo</small>
                </div>
                <span className="lp-fab" aria-hidden="true"><LandingIcon name="sparkle" size={18} /></span>
              </div>
            </Reveal>
            <Reveal className="lp-panel-box lp-panel-stats" delay={90}>
              <div className="lp-panel-copy">
                <p className="lp-eyebrow">Vos résultats</p>
                <h2>Comprenez ce que vos clients aiment vraiment.</h2>
                <p>Suivez les parcours, les réponses et les produits recommandés pour affiner vos questions et votre catalogue.</p>
              </div>
              <div className="lp-stats" role="img" aria-label="Illustration d'un tableau de résultats avec des données fictives : 1 240 parcours démarrés, 870 terminés, 310 clics produits">
                <span className="lp-fictive">Données fictives</span>
                <div className="lp-kpis"><div><small>Parcours démarrés</small><b>1 240</b></div><div><small>Parcours terminés</small><b>870</b></div><div><small>Clics produits</small><b>310</b></div></div>
                <div className="lp-bars">{[28, 40, 34, 52, 60, 48, 70, 64, 86, 78].map((h, i) => <i key={i} style={{ height: `${h}%`, transitionDelay: `${i * 40}ms` }} />)}</div>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="lp-final" aria-labelledby="lp-final-h">
          <svg className="lp-swirl" viewBox="0 0 200 120" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M5 100C30 40 60 110 90 60S150 20 195 70" /><path d="M5 80C40 20 70 90 100 40" /></svg>
          <div className="lp-wrap lp-final-grid">
            <div>
              <p className="lp-eyebrow">Prêt à créer votre première expérience ?</p>
              <h2 id="lp-final-h">Offrez à vos clients le bon produit, au bon moment.</h2>
              <p>Rejoignez POAPO et créez votre première expérience en quelques minutes.</p>
            </div>
            <div style={hide}><Cta light /></div>
          </div>
        </section>

        <section id="faq" className="lp-faq-section" aria-labelledby="lp-faq-h">
          <div className="lp-wrap lp-faq-grid">
            <Reveal><p className="lp-eyebrow">Questions fréquentes</p><h2 id="lp-faq-h">Vous avez une question ?</h2></Reveal>
            <Reveal>{FAQ.map((f) => <details key={f.q} className="lp-faq"><summary>{f.q}</summary><p>{f.a}</p></details>)}</Reveal>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-grid">
          <Wordmark />
          <nav aria-label="Pied de page">
            <a href="#produit" onClick={scrollTo("produit")}>Produit</a>
            <a href="#fonctionnement" onClick={scrollTo("fonctionnement")}>Comment ça marche</a>
            <a href="#faq" onClick={scrollTo("faq")}>Ressources</a>
          </nav>
          <p>© {new Date().getFullYear()} POAPO. Données et exemples de cette page : fictifs. Photographies : <a href="https://unsplash.com" rel="noopener noreferrer">Unsplash</a>.</p>
        </div>
      </footer>
    </div>
  );
}
