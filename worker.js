/**
 * Cloudflare Worker for travel-advisories.hyltons.us
 * Serves optimized static assets with tactical security headers and caching.
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === "/api/health") {
      return new Response(
        JSON.stringify({
          status: "OPERATIONAL",
          service: "travel-advisories",
          classification: "UNCLASSIFIED",
          endpoint: "travel-advisories.hyltons.us"
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        }
      );
    }

    // Static assets
    const response = await env.ASSETS.fetch(request);

    // Tactical security & cache headers
    const headers = new Headers(response.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Frame-Options", "SAMEORIGIN");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

    if (url.pathname.includes("/data/")) {
      headers.set("Cache-Control", "public, max-age=1800, stale-while-revalidate=86400");
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: headers
    });
  }
};
