// Talks to the public Traction Beast server. Auth is via the user's
// session cookie (credentials: "include" below) — no secret in the bundle.
const API_BASE = "https://tractionbeast.com";
const IMPORT_URL = `${API_BASE}/api/v1/serp/import`;
const ME_URL = `${API_BASE}/api/v1/me/`;
const LOGIN_URL = `${API_BASE}/accounts/login/`;

const statusEl = document.getElementById("status");
const captureBtn = document.getElementById("capture");
const signinBtn = document.getElementById("signin");

function showSignin(message) {
  statusEl.textContent = message;
  statusEl.className = "error";
  captureBtn.classList.add("hidden");
  signinBtn.classList.remove("hidden");
}

function grabPage() {
  const query =
    document.querySelector('textarea[name="q"]')?.value ||
    document.querySelector('input[name="q"]')?.value ||
    "";

  // Collect all links with their surrounding text context
  const searchDiv =
    document.getElementById("search") || document.getElementById("main") || document.body;
  const entries = [];

  searchDiv.querySelectorAll("a[href]").forEach((a) => {
    const href = a.href;
    if (!href || !href.startsWith("http")) return;

    // Skip google internal links
    try {
      const host = new URL(href).hostname;
      if (host.includes("google.") || host.includes("googleapis.") || host.includes("gstatic."))
        return;
    } catch {
      return;
    }

    // Get the title (h3 inside or near the link)
    const h3 = a.querySelector("h3") || a.closest("div")?.querySelector("h3");
    if (!h3) return; // No h3 = not an organic result

    // Get snippet from sibling/parent text
    const container =
      a.closest("div[data-hveid]") ||
      a.closest("div.g") ||
      a.parentElement?.parentElement?.parentElement;
    let snippet = "";
    if (container) {
      const texts = container.innerText
        .split("\n")
        .filter((l) => l.length > 40 && !l.includes(h3.textContent));
      snippet = texts[0] || "";
    }

    entries.push({
      title: h3.textContent.trim(),
      url: href,
      snippet: snippet.trim().slice(0, 300),
    });
  });

  return { query, entries, html: document.documentElement.outerHTML };
}

// Check auth and the current tab.
(async function init() {
  // Probe auth. A 401 means the user isn't signed in to Traction Beast in
  // this browser — flip the UI to a sign-in CTA.
  let me;
  try {
    const resp = await fetch(ME_URL, { credentials: "include" });
    if (resp.status === 401) {
      showSignin("Sign in to Traction Beast to capture SERPs.");
      return;
    }
    if (!resp.ok) {
      statusEl.textContent = `Server error: HTTP ${resp.status}`;
      statusEl.className = "error";
      return;
    }
    me = await resp.json();
  } catch (err) {
    statusEl.textContent = `Can't reach ${API_BASE}: ${err.message}`;
    statusEl.className = "error";
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.url?.includes("google.com/search")) {
      statusEl.textContent = "Not a Google search page.";
      statusEl.className = "error";
      return;
    }
    statusEl.textContent = `Signed in as ${me.email}. Ready to capture.`;
    captureBtn.disabled = false;
  });
})();

signinBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: LOGIN_URL });
  window.close();
});

captureBtn.addEventListener("click", async () => {
  captureBtn.disabled = true;
  captureBtn.textContent = "Capturing...";
  statusEl.textContent = "";
  statusEl.className = "";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [{ result: data }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: grabPage,
    });

    const entries = data.entries || [];
    statusEl.textContent = `Found ${entries.length} results, sending...`;

    const resp = await fetch(IMPORT_URL, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: data.query,
        results: entries.map((e, i) => ({ position: i + 1, ...e })),
        html: data.html,
      }),
    });

    let json;
    try {
      json = await resp.json();
    } catch {
      json = { error: `HTTP ${resp.status}` };
    }

    if (resp.ok && json.status === "ok") {
      statusEl.textContent = `Saved ${json.result_count} results for "${data.query}"`;
      statusEl.className = "success";
      captureBtn.textContent = "Done!";
    } else if (resp.status === 401) {
      showSignin("Your session expired. Sign in again.");
      captureBtn.textContent = "Capture SERP";
    } else {
      const msg = json.error || `HTTP ${resp.status}`;
      statusEl.textContent = `Error: ${msg}`;
      statusEl.className = "error";
      captureBtn.textContent = "Capture SERP";
      captureBtn.disabled = false;
    }
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    statusEl.className = "error";
    captureBtn.textContent = "Capture SERP";
    captureBtn.disabled = false;
  }
});
