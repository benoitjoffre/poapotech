// Application Auth0 « Single Page Application » (Authorization Code + PKCE) : aucun secret côté navigateur.
export const auth0Config = {
  domain: import.meta.env.VITE_AUTH0_DOMAIN as string | undefined,
  clientId: import.meta.env.VITE_AUTH0_CLIENT_ID as string | undefined,
  audience: import.meta.env.VITE_AUTH0_AUDIENCE as string | undefined,
};
export const auth0Configured = !!(auth0Config.domain && auth0Config.clientId && auth0Config.audience);
