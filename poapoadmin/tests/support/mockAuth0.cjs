// Faux fournisseur Auth0 pour les recettes : Authorization Code + PKCE, refresh token, JWKS, logout, session silencieuse.
// Aucun secret réel ; clé RSA éphémère. Les identités se choisissent sur la page /authorize.
const http = require("node:http");
const crypto = require("node:crypto");
const path = require("node:path");
const { SignJWT, exportJWK, generateKeyPair } = require(path.resolve(__dirname, "../../../node_modules/jose"));

const NS = "https://poapo.app/";

async function startMockAuth0({ port, audience, users }) {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "mock", alg: "RS256", use: "sig" };
  const issuer = `http://localhost:${port}/`;
  const codes = new Map();
  const refresh = new Map();
  let session = null; // utilisateur connecté chez le fournisseur (cookie de session simulé)
  const sign = (claims, aud, ttl) => new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "mock" })
    .setIssuer(issuer).setAudience(aud).setIssuedAt().setExpirationTime(ttl).sign(privateKey);

  async function tokens(entry) {
    const u = users[entry.user];
    const access = await sign({ sub: u.sub, [`${NS}email`]: u.email, [`${NS}email_verified`]: u.verified }, audience, process.env.MOCK_AUTH0_TTL || "1h");
    const id = await sign({ sub: u.sub, email: u.email, email_verified: u.verified, nonce: entry.nonce }, entry.clientId, "1h");
    const rt = crypto.randomUUID();
    refresh.set(rt, entry);
    return { access_token: access, id_token: id, refresh_token: rt, token_type: "Bearer", expires_in: Number(process.env.MOCK_AUTH0_EXPIRES || 3600), scope: "openid profile email" };
  }
  const issueCode = (q, user) => { const code = crypto.randomUUID(); codes.set(code, { user, nonce: q.get("nonce"), challenge: q.get("code_challenge"), clientId: q.get("client_id") }); return code; };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, issuer);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
    const json = (body, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body)); };
    if (url.pathname === "/.well-known/jwks.json") return json({ keys: [jwk] });
    if (url.pathname === "/authorize") {
      const q = url.searchParams;
      const redirect = new URL(q.get("redirect_uri"));
      if (q.get("prompt") === "none") { // renouvellement silencieux (iframe)
        const body = session ? { type: "authorization_response", response: { code: issueCode(q, session), state: q.get("state") } }
          : { type: "authorization_response", response: { error: "login_required", state: q.get("state") } };
        res.writeHead(200, { "Content-Type": "text/html" }).end(`<script>parent.postMessage(${JSON.stringify(body)}, ${JSON.stringify(redirect.origin)})</script>`);
        return;
      }
      const user = q.get("as");
      if (user && users[user]) {
        session = user;
        redirect.searchParams.set("code", issueCode(q, user)); redirect.searchParams.set("state", q.get("state"));
        res.writeHead(302, { Location: redirect.toString() }).end();
        return;
      }
      const links = Object.keys(users).map((name) => { const n = new URL(url); n.searchParams.set("as", name); return `<p><a id="as-${name}" href="${n.pathname}${n.search}">${name}</a></p>`; }).join("");
      res.writeHead(200, { "Content-Type": "text/html" }).end(`<h1>Mock Auth0${q.get("screen_hint") === "signup" ? " (inscription)" : ""}</h1>${links}`);
      return;
    }
    if (url.pathname === "/oauth/token" && req.method === "POST") {
      let raw = ""; for await (const c of req) raw += c;
      const body = req.headers["content-type"]?.includes("json") ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
      if (body.grant_type === "authorization_code") {
        const entry = codes.get(body.code); codes.delete(body.code);
        const challenge = crypto.createHash("sha256").update(body.code_verifier ?? "").digest("base64url");
        if (!entry || challenge !== entry.challenge) return json({ error: "invalid_grant" }, 403);
        return json(await tokens(entry));
      }
      if (body.grant_type === "refresh_token") {
        const entry = refresh.get(body.refresh_token);
        if (!entry || !session) return json({ error: "invalid_grant" }, 403);
        return json(await tokens(entry));
      }
      return json({ error: "unsupported_grant_type" }, 400);
    }
    if (url.pathname === "/v2/logout") {
      session = null; refresh.clear();
      res.writeHead(302, { Location: url.searchParams.get("returnTo") || "/" }).end();
      return;
    }
    json({ error: "not_found" }, 404);
  });
  await new Promise((resolve) => server.listen(port, resolve));
  return { issuer, audience, stop: () => server.close(), expireSession: () => { refresh.clear(); } };
}

module.exports = { startMockAuth0 };
