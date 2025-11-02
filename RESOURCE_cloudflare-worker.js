// Copy this code into your Cloudflare Worker script

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json",
    };

    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const pathname = url.pathname || "/";

    // Resolver endpoint: GET /resolve?product=...
    if (pathname === "/resolve") {
      try {
        const product = url.searchParams.get("product") || "";
        if (!product) {
          return new Response(
            JSON.stringify({ error: "product query param required" }),
            { status: 400, headers: corsHeaders }
          );
        }

        // Use DuckDuckGo HTML search (lightweight) to find the first L'Oréal product page
        // Query restricts to known L'Oréal domains
        const query = `site:lorealparis.com OR site:loreal.com ${product}`;
        const ddgUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(
          query
        )}`;

        const ddgResp = await fetch(ddgUrl, {
          method: "GET",
          headers: {
            "User-Agent": "loreal-chatbot-resolver/1.0",
          },
        });

        const body = await ddgResp.text();

        // Try to extract the first result link from DuckDuckGo HTML results
        // DuckDuckGo result links often have class="result__a" with direct href
        const linkMatch = body.match(
          /<a[^>]+class="result__a"[^>]+href="([^"]+)"/i
        );
        let targetUrl = null;
        if (linkMatch && linkMatch[1]) {
          targetUrl = linkMatch[1];
          // DuckDuckGo sometimes returns relative or redirect URLs; ensure absolute
          if (targetUrl.startsWith("/")) {
            targetUrl = "https://duckduckgo.com" + targetUrl;
          }
        }

        // Fallback: use a Google search results page (will show results) if no direct link found
        if (!targetUrl) {
          targetUrl = `https://www.google.com/search?q=${encodeURIComponent(
            query
          )}`;
        }

        return new Response(JSON.stringify({ url: targetUrl }), {
          headers: corsHeaders,
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
          status: 500,
          headers: corsHeaders,
        });
      }
    }

    // Default behavior: act as an OpenAI proxy for chat completions
    if (pathname === "/chat" && request.method === "POST") {
      const apiKey = env.OPENAI_API_KEY; // Make sure to name your secret OPENAI_API_KEY in the Cloudflare Workers dashboard
      const apiUrl = "https://api.openai.com/v1/chat/completions";
      const userInput = await request.json();

      const requestBody = {
        model: "gpt-4o",
        messages: userInput.messages,
        max_completion_tokens: 300,
      };

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();

      return new Response(JSON.stringify(data), { headers: corsHeaders });
    }

    // Unknown path
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: corsHeaders,
    });
  },
};
