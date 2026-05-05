const https = require("https");

const fetchHtml = (url, redirectCount = 0) =>
  new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
          "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        },
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirectCount < 5
        ) {
          const nextUrl = new URL(res.headers.location, url).toString();
          res.resume();
          resolve(fetchHtml(nextUrl, redirectCount + 1));
          return;
        }

        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
          if (data.length > 2_000_000) {
            req.destroy(new Error("Response too large"));
          }
        });
        res.on("end", () => resolve(data));
      }
    );

    req.on("error", reject);
    req.setTimeout(8000, () => req.destroy(new Error("Request timeout")));
  });

const extractProductUrl = (html, regexes, baseUrl, isProductUrl) => {
  for (const regex of regexes) {
    const matches = html.matchAll(regex);
    for (const match of matches) {
      const raw = match[1];
      if (!raw) continue;
      const url = raw.startsWith("http") ? raw : new URL(raw, baseUrl).toString();
      if (!isProductUrl || isProductUrl(url)) return url;
    }
  }
  return null;
};

const isNocibeProductUrl = (url) => /\/p\/|\/p-|-p-/.test(url);

const findDirectNocibeUrl = async (perfumeName) => {
  const searchUrl = `https://www.nocibe.fr/search?q=${encodeURIComponent(
    perfumeName
  )}`;
  const html = await fetchHtml(searchUrl);
  const url = extractProductUrl(
    html,
    [
      /"url"\s*:\s*"(https:\/\/www\.nocibe\.fr\/[^"]+)"/g,
      /href="(https:\/\/www\.nocibe\.fr\/[^"]+)"/g,
      /href="(\/[^"]+)"/g,
    ],
    "https://www.nocibe.fr",
    isNocibeProductUrl
  );
  return { url, searchUrl };
};

// Genere des liens d'achat directs (avec fallback search si echec).
const buildPurchaseLinks = async (perfume) => {
  const nocibe = await findDirectNocibeUrl(perfume.name);
  return [
    {
      retailer: "Nocibe",
      url: nocibe.url || nocibe.searchUrl,
      isFallback: !nocibe.url,
    },
  ];
};

module.exports = { buildPurchaseLinks };
