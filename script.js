/* DOM elements */
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const chatWindow = document.getElementById("chatWindow");
// System prompt: strictly enforce scope to L'Oréal and beauty-related topics.
// When recommending a product, include a full product URL or a markdown-style link like: [Product Name](https://...)
// If a question is outside that scope, politely refuse and offer a related alternative.
const SYSTEM_PROMPT = `You are a highly-focused assistant that ONLY answers questions about L'Oréal products, skincare and haircare routines, product recommendations, ingredients used in L'Oréal products, and how to use them. You MUST refuse any request that is not directly about L'Oréal or beauty-related advice. If the user asks about topics outside this scope (for example other brands, medical diagnoses, legal advice, political content, or unrelated general knowledge), respond with a brief, polite refusal such as: "I'm sorry — I can only help with questions about L'Oréal products, routines, and beauty-related recommendations. I can help with product suggestions, routine steps, or ingredient information. Would you like recommendations for [skin/hair concern]?" Always keep refusals short, do not provide the requested out-of-scope content, and offer a helpful L'Oréal-related alternative or ask a clarifying question.`;

/* helper: append message to chat window */
function appendMessage(role, text) {
  const wrapper = document.createElement("div");
  wrapper.className = `message ${role}`; // 'message user' or 'message assistant'

  // role label (e.g. "You" or "L'Oréal Advisor")
  const label = document.createElement("div");
  label.className = "role-label";
  label.textContent = role === "user" ? "You" : "L'Oréal Advisor";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  // render content (convert markdown links and raw URLs to anchors)
  renderTextWithLinks(bubble, text);

  wrapper.appendChild(label);
  wrapper.appendChild(bubble);
  chatWindow.appendChild(wrapper);

  // scroll to bottom
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

// Conversation memory (keeps user+assistant messages). We send the system prompt
// separately with every API call so it's always applied. To avoid hitting token
// limits we trim to the last N messages (user+assistant entries).
const conversation = [];
const MAX_HISTORY_MESSAGES = 12; // keeps the last 12 messages (adjust as needed)

function getMessagesForAPI() {
  // Trim conversation to most recent MAX_HISTORY_MESSAGES
  const start = Math.max(0, conversation.length - MAX_HISTORY_MESSAGES);
  const recent = conversation.slice(start);
  // Always include the system prompt first
  return [{ role: "system", content: SYSTEM_PROMPT }, ...recent];
}

// Render text into a bubble element, converting markdown links and raw URLs to safe anchors.
function renderTextWithLinks(bubble, text) {
  // Helper: create text and link nodes from the string.
  const fragment = document.createDocumentFragment();

  // Regex matches either markdown links [text](url) or raw URLs
  const regex = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|https?:\/\/[^\s)]+/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const index = match.index;
    // append text before match
    if (index > lastIndex) {
      fragment.appendChild(
        document.createTextNode(text.slice(lastIndex, index))
      );
    }

    if (match[1] && match[2]) {
      // markdown link
      const a = document.createElement("a");
      a.href = match[2];
      a.textContent = match[1];
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      fragment.appendChild(a);
    } else {
      // raw URL (match[0])
      const url = match[0];
      const a = document.createElement("a");
      a.href = url;
      a.textContent = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      fragment.appendChild(a);
    }

    lastIndex = regex.lastIndex;
  }

  // append remaining text
  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  // clear and append
  bubble.innerHTML = "";
  bubble.appendChild(fragment);
}

// If the assistant's text doesn't contain any URLs or markdown links, attempt to
// replace known product names with markdown links using the `productLinks` map.
function autoLinkProducts(text) {
  // quick check: if text already contains a url or markdown link, don't modify
  if (
    /https?:\/\/[^\s)]+/.test(text) ||
    /\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(text)
  ) {
    return text;
  }

  if (typeof productLinks !== "object") return text;

  // sort product names by length desc so longer names match first
  const names = Object.keys(productLinks).sort((a, b) => b.length - a.length);
  let newText = text;

  for (const name of names) {
    // word boundary safe replace (case-insensitive)
    const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, "ig");
    if (re.test(newText)) {
      const url = productLinks[name];
      // replace first occurrence only to avoid over-linking
      newText = newText.replace(re, `[${name}](${url})`);
      // continue to allow multiple different products to be linked
    }
  }

  return newText;
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
}

/* initial assistant greeting */
appendMessage(
  "assistant",
  "👋 Hi — I can help with L’Oréal product advice, routines, and recommendations. Ask me about products, ingredients, or routine steps."
);

// store the initial assistant greeting in conversation memory
conversation.push({
  role: "assistant",
  content:
    "👋 Hi — I can help with L’Oréal product advice, routines, and recommendations. Ask me about products, ingredients, or routine steps.",
});

/* Handle form submit */
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const text = userInput.value.trim();
  if (!text) return;

  // store and show user message
  conversation.push({ role: "user", content: text });
  appendMessage("user", text);
  userInput.value = "";

  // show loading indicator
  const loadingId = "loading-" + Date.now();
  appendMessage("assistant", "…thinking");
  const loadingElem = chatWindow.querySelector(
    ".message.assistant:last-child .bubble"
  );

  // disable input while waiting
  userInput.disabled = true;
  const sendBtn = document.getElementById("sendBtn");
  if (sendBtn) sendBtn.disabled = true;

  try {
    // Build messages array including recent conversation history and the system prompt
    const messages = getMessagesForAPI();

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages,
        temperature: 0.2,
        max_tokens: 800,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`API error: ${res.status} ${errText}`);
    }

    const data = await res.json();

    // Cloudflare and Chat Completions responses place assistant text at data.choices[0].message.content
    let assistantText =
      data?.choices?.[0]?.message?.content ||
      "Sorry, I did not receive a response.";

    // If assistant didn't include a URL or markdown link, try auto-linking known product names
    assistantText = autoLinkProducts(assistantText);

    // add assistant reply to conversation memory
    conversation.push({ role: "assistant", content: assistantText });

    // replace loading text with actual assistant message (rendering will convert links)
    if (loadingElem) renderTextWithLinks(loadingElem, assistantText);
    else appendMessage("assistant", assistantText);
  } catch (err) {
    console.error("Chat error", err);
    const message =
      "Sorry — something went wrong while contacting the API. Please try again.";
    if (loadingElem) loadingElem.textContent = message;
    else appendMessage("assistant", message);
  } finally {
    // re-enable input
    userInput.disabled = false;
    if (sendBtn) sendBtn.disabled = false;
    userInput.focus();
  }
});

// Intercept clicks on links inside chat bubbles and open a Google site search
// for the link text to avoid landing on stale/broken product pages that return 404.
chatWindow.addEventListener("click", async (e) => {
  const a = e.target.closest("a");
  if (!a) return;
  e.preventDefault();

  const query = `${a.textContent}`.trim();

  // Try resolver endpoint first (assumes Cloudflare Worker deployed at same origin)
  try {
    const resolverUrl = `/resolve?product=${encodeURIComponent(query)}`;
    const res = await fetch(resolverUrl, { method: "GET" });
    if (res.ok) {
      const data = await res.json();
      const target = data?.url;
      if (target) {
        window.open(target, "_blank", "noopener");
        return;
      }
    }
  } catch (err) {
    console.warn("Resolver failed, falling back to Google search", err);
  }

  // Fallback: open a Google search restricted to L'Oréal domains
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(
    `site:lorealparis.com OR site:loreal.com ${query}`
  )}`;
  window.open(searchUrl, "_blank", "noopener");
});
