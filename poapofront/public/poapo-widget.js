(function () {
  "use strict";

  var script = document.currentScript;
  var clientId = script ? script.getAttribute("data-client-id") : null;
  var quizId = script ? script.getAttribute("data-quiz-id") : null;
  var widgetUrl = script ? script.getAttribute("data-url") : null;
  var buttonLabel = script ? script.getAttribute("data-label") : null;
  var buttonColor = script ? script.getAttribute("data-color") : null;

  if (!clientId) {
    console.warn("[Poapo] data-client-id manquant sur la balise <script>.");
    return;
  }

  // Sans data-url, le widget est servi par le même site que ce script.
  if (!widgetUrl && script && script.src) {
    widgetUrl = new URL(script.src, window.location.href).origin;
  }
  if (!widgetUrl) {
    console.warn("[Poapo] data-url manquant et origine du script introuvable.");
    return;
  }
  widgetUrl = widgetUrl.replace(/\/$/, "");

  var iframeSrc = widgetUrl + "/?clientId=" + encodeURIComponent(clientId);
  if (quizId) iframeSrc += "&quizId=" + encodeURIComponent(quizId);
  var accentColor = buttonColor || "#6C47FF";
  var label = buttonLabel || "Découvrir mes recommandations";

  // ── Inject styles ──────────────────────────────────────────────
  var style = document.createElement("style");
  style.textContent = [
    "#poapo-fab{",
    "position:fixed;bottom:24px;right:24px;z-index:2147483646;",
    "display:flex;align-items:center;gap:10px;",
    "padding:12px 20px 12px 14px;",
    "border-radius:999px;border:none;cursor:pointer;",
    "background:" + accentColor + ";",
    "color:#fff;font-size:14px;font-weight:700;",
    "font-family:system-ui,sans-serif;",
    "box-shadow:0 8px 24px rgba(0,0,0,0.22);",
    "transition:transform .2s ease,box-shadow .2s ease,opacity .2s ease;",
    "line-height:1;",
    "}",
    "#poapo-fab:hover{transform:translateY(-2px);box-shadow:0 12px 32px rgba(0,0,0,0.28);}",
    "#poapo-fab svg{flex-shrink:0;}",
    "#poapo-overlay{",
    "display:none;position:fixed;inset:0;z-index:2147483645;",
    "background:rgba(0,0,0,0.35);backdrop-filter:blur(2px);",
    "transition:opacity .25s ease;opacity:0;",
    "}",
    "#poapo-overlay.open{display:block;}",
    "#poapo-overlay.visible{opacity:1;}",
    "#poapo-panel{",
    "position:fixed;top:0;right:0;bottom:0;z-index:2147483646;",
    "width:420px;max-width:100vw;",
    "background:#fff;",
    "box-shadow:-8px 0 40px rgba(0,0,0,0.18);",
    "transform:translateX(100%);",
    "transition:transform .32s cubic-bezier(.4,0,.2,1);",
    "display:flex;flex-direction:column;",
    "}",
    "#poapo-panel.open{transform:translateX(0);}",
    "#poapo-panel-header{",
    "display:flex;align-items:center;justify-content:space-between;",
    "padding:14px 16px 12px;",
    "border-bottom:1px solid rgba(0,0,0,0.08);",
    "flex-shrink:0;",
    "}",
    "#poapo-panel-title{",
    "font-family:system-ui,sans-serif;font-size:13px;font-weight:600;",
    "color:#1d1b22;letter-spacing:.3px;",
    "}",
    "#poapo-close{",
    "width:28px;height:28px;border-radius:999px;border:none;",
    "background:rgba(0,0,0,0.06);cursor:pointer;",
    "display:flex;align-items:center;justify-content:center;",
    "color:#555;transition:background .15s ease;flex-shrink:0;",
    "}",
    "#poapo-close:hover{background:rgba(0,0,0,0.12);}",
    "#poapo-iframe-wrap{flex:1;overflow:hidden;}",
    "#poapo-iframe-wrap iframe{width:100%;height:100%;border:none;display:block;}",
    "@media(max-width:480px){",
    "#poapo-panel{width:100vw;}",
    "#poapo-fab span{display:none;}",
    "#poapo-fab{padding:14px;}",
    "}",
  ].join("");
  document.head.appendChild(style);

  // ── FAB button ─────────────────────────────────────────────────
  var fab = document.createElement("button");
  fab.id = "poapo-fab";
  fab.setAttribute("aria-label", "Ouvrir le quiz Poapo");
  fab.innerHTML = [
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">',
    '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>',
    '<path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    "</svg>",
    "<span>" + label + "</span>",
  ].join("");
  document.body.appendChild(fab);

  // ── Overlay ────────────────────────────────────────────────────
  var overlay = document.createElement("div");
  overlay.id = "poapo-overlay";
  document.body.appendChild(overlay);

  // ── Panel ──────────────────────────────────────────────────────
  var panel = document.createElement("div");
  panel.id = "poapo-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "Quiz Poapo");
  panel.innerHTML = [
    '<div id="poapo-panel-header">',
    '<span id="poapo-panel-title">✦ Votre sélection</span>',
    '<button id="poapo-close" aria-label="Fermer">',
    '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">',
    '<line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/>',
    "</svg>",
    "</button>",
    "</div>",
    '<div id="poapo-iframe-wrap">',
    '<iframe src="" title="Quiz Poapo" allow="clipboard-write" loading="lazy"></iframe>',
    "</div>",
  ].join("");
  document.body.appendChild(panel);

  var iframe = panel.querySelector("iframe");
  var closeBtn = panel.querySelector("#poapo-close");
  var iframeLoaded = false;

  // ── Open / Close helpers ──────────────────────────────────────
  function open() {
    if (!iframeLoaded) {
      iframe.src = iframeSrc;
      iframeLoaded = true;
    }
    overlay.style.display = "block";
    requestAnimationFrame(function () {
      overlay.classList.add("open", "visible");
      panel.classList.add("open");
      fab.style.opacity = "0";
      fab.style.pointerEvents = "none";
      document.body.style.overflow = "hidden";
    });
  }

  function close() {
    overlay.classList.remove("visible");
    panel.classList.remove("open");
    fab.style.opacity = "1";
    fab.style.pointerEvents = "";
    document.body.style.overflow = "";
    setTimeout(function () {
      overlay.classList.remove("open");
      overlay.style.display = "none";
    }, 280);
  }

  // ── Event listeners ────────────────────────────────────────────
  fab.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", close);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") close();
  });
})();
