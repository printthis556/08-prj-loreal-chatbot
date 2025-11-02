/* DOM elements */
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const chatWindow = document.getElementById("chatWindow");
// Use the deployed Cloudflare Worker as a proxy to keep the OpenAI API key server-side
const WORKER_URL = "https://loreal-chatbot-worker.mhess0308.workers.dev";
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
  // If the role is user and we have a stored name, show it instead of "You"
  const storedName =
    localStorage.getItem("chat_user_name") || chatUserName || "";
  label.textContent =
    role === "user" ? (storedName ? storedName : "You") : "L'Oréal Advisor";

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
let conversation = [];
const MAX_HISTORY_MESSAGES = 12; // keeps the last 12 messages (adjust as needed)

function getMessagesForAPI() {
  // Trim conversation to most recent MAX_HISTORY_MESSAGES
  const start = Math.max(0, conversation.length - MAX_HISTORY_MESSAGES);
  const recent = conversation.slice(start);
  // Always include the system prompt first
  const userName = localStorage.getItem("chat_user_name");
  const userMeta = userName
    ? [{ role: "system", content: `User name: ${userName}` }]
    : [];
  return [{ role: "system", content: SYSTEM_PROMPT }, ...userMeta, ...recent];
}

function saveConversation() {
  try {
    localStorage.setItem("chat_conversation", JSON.stringify(conversation));
  } catch (err) {
    console.warn("Could not save conversation", err);
  }
}

function loadConversation() {
  try {
    const raw = localStorage.getItem("chat_conversation");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn("Could not load conversation", err);
    return null;
  }
}

// Prompt for user name once (if not known) to personalize the chat.
let chatUserName = localStorage.getItem("chat_user_name") || "";
// Track stored user name and whether we're currently awaiting the name via chat
let awaitingName = false;
const prior = loadConversation();
if (prior && Array.isArray(prior) && prior.length) {
  conversation = prior;
  // render messages
  chatWindow.innerHTML = "";
  for (const msg of conversation) {
    appendMessage(msg.role === "assistant" ? "assistant" : "user", msg.content);
    // After rendering past messages, update user labels to show stored name if any
    updateUserLabels();
  }
  // If we have no stored name yet, ask for it in-chat
  if (!chatUserName) {
    const ask =
      "Before we continue — may I ask your name? (optional, type it here)";
    appendMessage("assistant", ask);
    conversation.push({ role: "assistant", content: ask });
    saveConversation();
    awaitingName = true;
  }
} else {
  // initial assistant greeting — if we don't know name, ask for it conversationally
  if (!chatUserName) {
    const greet =
      "👋 Hi — I'm the L'Oréal Advisor. What's your name? (optional — type it here)";
    appendMessage("assistant", greet);
    conversation.push({ role: "assistant", content: greet });
    awaitingName = true;
  } else {
    const greet =
      "👋 Hi — I can help with L’Oréal product advice, routines, and recommendations. Ask me about products, ingredients, or routine steps.";
    appendMessage("assistant", greet);
    conversation.push({ role: "assistant", content: greet });
  }
  saveConversation();
}

// (prior conversation already handled above)

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

// Update existing user role labels in the DOM to show the stored name (if any)
function updateUserLabels() {
  const name = localStorage.getItem("chat_user_name") || chatUserName || "";
  const labels = chatWindow.querySelectorAll(".message.user .role-label");
  labels.forEach((el) => {
    el.textContent = name ? name : "You";
  });
}

// (initial greeting handled during load)

/* Handle form submit */
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const text = userInput.value.trim();
  if (!text) return;

  // Special command: //reset -> clear conversation and reset chat UI (keeps stored name)
  if (text === "//reset") {
    // clear in-memory and persisted conversation
    conversation = [];
    saveConversation();

    // Also clear stored user name (remove persistence)
    chatUserName = null;
    try {
      localStorage.removeItem("chat_user_name");
    } catch (e) {
      // ignore storage errors
    }
    if (typeof updateUserLabels === "function") updateUserLabels();

    // clear UI
    chatWindow.innerHTML = "";

    // re-initialize greeting depending on whether name is known
    if (chatUserName) {
      const greet = `👋 Hi ${chatUserName} — I can help with L’Oréal product advice, routines, and recommendations. Ask me about products, ingredients, or routine steps.`;
      appendMessage("assistant", greet);
      conversation.push({ role: "assistant", content: greet });
    } else {
      const greet =
        "👋 Hi — I'm the L'Oréal Advisor. What's your name? (optional — type it here)";
      appendMessage("assistant", greet);
      conversation.push({ role: "assistant", content: greet });
      awaitingName = true;
    }

    saveConversation();
    userInput.value = "";
    return;
  }

  // store and show user message
  conversation.push({ role: "user", content: text });
  appendMessage("user", text);
  // (latest-question UI removed) — user message is shown in chat window only
  userInput.value = "";
  const sendBtn = document.getElementById("sendBtn");

  // Allow the user to set/change their name at any time with phrases like "My name is Alice" or "I'm Bob"
  const generalNameMatch = text.match(/^(?:my name is|i am|i'm)\s+(.+)$/i);
  if (generalNameMatch) {
    const name = generalNameMatch[1].trim();
    if (name) {
      chatUserName = name.slice(0, 50);
      localStorage.setItem("chat_user_name", chatUserName);
      const confirm = `Nice to meet you, ${chatUserName}! How can I help you with L'Oréal products today?`;
      conversation.push({ role: "assistant", content: confirm });
      appendMessage("assistant", confirm);
      updateUserLabels();
      saveConversation();
      return; // don't send the name message to the API
    }
  }

  // If we're awaiting the user's name, treat this message as the name (or skip)
  if (awaitingName) {
    const candidate = text.trim();
    // allow user to skip
    if (/^(skip|no|no thanks|no thank you)$/i.test(candidate)) {
      awaitingName = false;
      saveConversation();
      userInput.disabled = false;
      if (sendBtn) sendBtn.disabled = false;
      userInput.focus();
      return;
    }

    // Extract name from phrases like "My name is Alice" or accept short inputs like "Alice"
    let name = "";
    const m = candidate.match(/^(?:my name is|i am|i'm)\s+(.+)$/i);
    if (m) name = m[1].trim();
    else {
      const parts = candidate.split(/\s+/);
      if (parts.length <= 3) name = candidate;
    }

    if (name) {
      chatUserName = name.slice(0, 50);
      localStorage.setItem("chat_user_name", chatUserName);
      const confirm = `Nice to meet you, ${chatUserName}! How can I help you with L'Oréal products today?`;
      conversation.push({ role: "assistant", content: confirm });
      appendMessage("assistant", confirm);
      updateUserLabels();
      awaitingName = false;
      saveConversation();
      // do not call API for the name-only message
      userInput.disabled = false;
      if (sendBtn) sendBtn.disabled = false;
      userInput.focus();
      return;
    }
    // else fall through and treat message as a normal query
  }

  // show loading indicator
  const loadingId = "loading-" + Date.now();
  appendMessage("assistant", "…thinking");
  const loadingElem = chatWindow.querySelector(
    ".message.assistant:last-child .bubble"
  );

  // disable input while waiting
  userInput.disabled = true;
  if (sendBtn) sendBtn.disabled = true;

  try {
    // Build messages array including recent conversation history and the system prompt
    const messages = getMessagesForAPI();

    // Send messages to the Cloudflare Worker which proxies requests to OpenAI with the secret key
    const res = await fetch(`${WORKER_URL}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messages }),
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
    saveConversation();

    // replace loading text with actual assistant message (rendering will convert links)
    if (loadingElem) renderTextWithLinks(loadingElem, assistantText);
    else appendMessage("assistant", assistantText);
    // clear latest question after assistant replies? (keep shown until next question)
    // we choose to keep the latest question visible until the next user input.
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
