import { adminOrigins } from "./cors";

/**
 * Contrôle du site intégrateur (embedDomain). Limites : l'API est appelée par l'iframe, donc `Origin` est celui du
 * widget, jamais du site parent. Le parent n'est connu que par ce que le widget déclare (`parentOrigin`, lu via
 * location.ancestorOrigins — fourni par le navigateur, non modifiable par la page parent — sinon document.referrer).
 * Un client non navigateur peut mentir : c'est un garde-fou de configuration, pas une barrière d'authentification.
 * Sans parentOrigin (Firefox sans referrer, ancien script) la requête passe pour ne pas casser les intégrations existantes.
 */
export function parseEmbedHosts(embedDomain: string): string[] {
  return embedDomain
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((value) => {
      const wildcard = value.startsWith("*.");
      try {
        const host = new URL((/^https?:\/\//.test(value) ? value : `https://${value}`).replace("*.", "")).hostname;
        return [wildcard ? `*.${host}` : host];
      } catch {
        return [];
      }
    });
}

function hostMatches(allowed: string, host: string): boolean {
  if (allowed.startsWith("*.")) return host.endsWith(allowed.slice(1));
  return host === allowed || host === `www.${allowed}` || `www.${host}` === allowed;
}

export function isEmbedParentAllowed(
  embedDomain: string | null,
  parentOrigin: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!embedDomain || !parentOrigin) return true;
  const hosts = parseEmbedHosts(embedDomain);
  if (hosts.length === 0) return true;
  let parent: URL;
  try { parent = new URL(parentOrigin); } catch { return false; }
  // L'administration (aperçu) et le widget hébergé en direct ne sont pas des sites intégrateurs.
  if (adminOrigins(env).includes(parent.origin)) return true;
  return hosts.some((allowed) => hostMatches(allowed, parent.hostname));
}
