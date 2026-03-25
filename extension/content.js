// content.js — ATS form detector and auto-filler
// Supports: Greenhouse, Lever, Workday

// ─── Utility: set value and trigger React/Angular change events ──────────────
function setFieldValue(el, value) {
  if (!el || !value) return false;

  const tag = el.tagName.toLowerCase();

  if (tag === "select") {
    // Find best matching option
    const options = Array.from(el.options);
    const match = options.find(o =>
      o.text.toLowerCase().includes(value.toLowerCase()) ||
      o.value.toLowerCase().includes(value.toLowerCase())
    );
    if (match) {
      el.value = match.value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    return false;
  }

  if (tag === "textarea" || (tag === "input" && ["text", "email", "tel", "url", "number"].includes(el.type))) {
    // Focus, clear, set value, trigger all events React/Angular listen to
    el.focus();
    el.value = value;

    // React uses a synthetic event system — we need to trigger the native setter
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      tag === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      "value"
    )?.set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value);
    }

    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
  }

  if (tag === "input" && el.type === "file") {
    // Can't programmatically set file inputs
    return false;
  }

  return false;
}

// ─── Field matcher: find form fields by label text or attributes ─────────────
function findFieldByLabel(labelText) {
  const labels = document.querySelectorAll("label");
  for (const label of labels) {
    if (label.textContent.trim().toLowerCase().includes(labelText.toLowerCase())) {
      // Check for 'for' attribute
      if (label.htmlFor) {
        const field = document.getElementById(label.htmlFor);
        if (field) return field;
      }
      // Check for nested input
      const nested = label.querySelector("input, textarea, select");
      if (nested) return nested;
      // Check sibling
      const sibling = label.nextElementSibling;
      if (sibling && ["INPUT", "TEXTAREA", "SELECT"].includes(sibling.tagName)) {
        return sibling;
      }
      // Check parent's next input
      const parent = label.closest(".field, .form-group, [class*='field'], [class*='form']");
      if (parent) {
        const input = parent.querySelector("input, textarea, select");
        if (input) return input;
      }
    }
  }

  // Fallback: search by placeholder, name, id, or aria-label
  const allInputs = document.querySelectorAll("input, textarea, select");
  for (const input of allInputs) {
    const placeholder = (input.placeholder || "").toLowerCase();
    const name = (input.name || "").toLowerCase();
    const id = (input.id || "").toLowerCase();
    const ariaLabel = (input.getAttribute("aria-label") || "").toLowerCase();
    const searchTerm = labelText.toLowerCase();

    if (placeholder.includes(searchTerm) || name.includes(searchTerm) ||
        id.includes(searchTerm) || ariaLabel.includes(searchTerm)) {
      return input;
    }
  }

  return null;
}

// ─── Greenhouse form filler ──────────────────────────────────────────────────
function fillGreenhouse(pack, profile) {
  const results = [];

  // Standard Greenhouse fields
  const fieldMap = [
    { name: "First Name", selectors: ["#first_name", "[name='first_name']"], value: profile.firstName },
    { name: "Last Name", selectors: ["#last_name", "[name='last_name']"], value: profile.lastName },
    { name: "Email", selectors: ["#email", "[name='email']", "[type='email']"], value: profile.email },
    { name: "Phone", selectors: ["#phone", "[name='phone']", "[type='tel']"], value: profile.phone },
    { name: "Location", selectors: ["#location", "[name='location']"], value: profile.location },
    { name: "LinkedIn", selectors: ["[name*='linkedin'], [id*='linkedin'], [placeholder*='linkedin']"], value: profile.linkedin },
    { name: "Website", selectors: ["[name*='website'], [id*='website'], [name*='portfolio']"], value: profile.website },
  ];

  for (const field of fieldMap) {
    if (!field.value) {
      results.push({ name: field.name, filled: false });
      continue;
    }
    let el = null;
    for (const sel of field.selectors) {
      el = document.querySelector(sel);
      if (el) break;
    }
    if (!el) el = findFieldByLabel(field.name);
    const filled = setFieldValue(el, field.value);
    results.push({ name: field.name, filled });
  }

  // Cover letter — look for a textarea that's for cover letter
  const coverLetterField = findFieldByLabel("cover letter") ||
    document.querySelector("[name*='cover_letter'], [id*='cover_letter'], textarea[name*='letter']");
  if (coverLetterField && pack.cover_letter) {
    const filled = setFieldValue(coverLetterField, pack.cover_letter);
    results.push({ name: "Cover Letter", filled });
  }

  // "Why are you interested" or similar open-ended questions
  const textareas = document.querySelectorAll("textarea");
  for (const ta of textareas) {
    const label = ta.closest(".field, .form-group")?.querySelector("label")?.textContent || "";
    const lowerLabel = label.toLowerCase();

    if (lowerLabel.includes("why") && (lowerLabel.includes("company") || lowerLabel.includes("role") || lowerLabel.includes("interested"))) {
      const answer = pack.common_answers?.why_this_company || pack.common_answers?.why_this_role || pack.why_good_fit || "";
      if (answer && !ta.value) {
        setFieldValue(ta, answer);
        results.push({ name: label.trim().slice(0, 40), filled: true });
      }
    }
  }

  return results;
}

// ─── Lever form filler ───────────────────────────────────────────────────────
function fillLever(pack, profile) {
  const results = [];

  // Lever uses a simpler form structure
  const fieldMap = [
    { name: "Full Name", selectors: ["[name='name']", "#name"], value: `${profile.firstName || ""} ${profile.lastName || ""}`.trim() },
    { name: "Email", selectors: ["[name='email']", "#email"], value: profile.email },
    { name: "Phone", selectors: ["[name='phone']", "#phone"], value: profile.phone },
    { name: "Current Company", selectors: ["[name='org']", "#org", "[name='current_company']"], value: profile.currentCompany },
    { name: "LinkedIn", selectors: ["[name*='linkedin']", "[name='urls[LinkedIn]']"], value: profile.linkedin },
    { name: "Website", selectors: ["[name*='website']", "[name*='portfolio']", "[name='urls[Portfolio]']"], value: profile.website },
  ];

  for (const field of fieldMap) {
    if (!field.value) {
      results.push({ name: field.name, filled: false });
      continue;
    }
    let el = null;
    for (const sel of field.selectors) {
      el = document.querySelector(sel);
      if (el) break;
    }
    if (!el) el = findFieldByLabel(field.name);
    const filled = setFieldValue(el, field.value);
    results.push({ name: field.name, filled });
  }

  // Lever has "additional information" textarea
  const additionalField = findFieldByLabel("additional") ||
    document.querySelector("textarea[name*='comments'], textarea[name*='additional']");
  if (additionalField && pack.cover_letter && !additionalField.value) {
    setFieldValue(additionalField, pack.cover_letter);
    results.push({ name: "Additional Info (Cover Letter)", filled: true });
  }

  return results;
}

// ─── Workday form filler ─────────────────────────────────────────────────────
function fillWorkday(pack, profile) {
  const results = [];

  // Workday uses data-automation-id attributes
  const fieldMap = [
    { name: "First Name", selectors: ["[data-automation-id='legalNameSection_firstName'] input", "[data-automation-id='firstName'] input"], value: profile.firstName },
    { name: "Last Name", selectors: ["[data-automation-id='legalNameSection_lastName'] input", "[data-automation-id='lastName'] input"], value: profile.lastName },
    { name: "Email", selectors: ["[data-automation-id='email'] input", "[type='email']"], value: profile.email },
    { name: "Phone", selectors: ["[data-automation-id='phone'] input", "[type='tel']"], value: profile.phone },
    { name: "Address", selectors: ["[data-automation-id='addressSection_addressLine1'] input"], value: profile.address },
    { name: "City", selectors: ["[data-automation-id='addressSection_city'] input"], value: profile.city },
  ];

  for (const field of fieldMap) {
    if (!field.value) {
      results.push({ name: field.name, filled: false });
      continue;
    }
    let el = null;
    for (const sel of field.selectors) {
      el = document.querySelector(sel);
      if (el) break;
    }
    if (!el) el = findFieldByLabel(field.name);
    const filled = setFieldValue(el, field.value);
    results.push({ name: field.name, filled });
  }

  return results;
}

// ─── Main message handler ────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "fill_application") {
    const { pack, profile, ats } = message;
    let fields = [];

    switch (ats) {
      case "Greenhouse":
        fields = fillGreenhouse(pack, profile);
        break;
      case "Lever":
        fields = fillLever(pack, profile);
        break;
      case "Workday":
        fields = fillWorkday(pack, profile);
        break;
    }

    const filledCount = fields.filter(f => f.filled).length;
    sendResponse({ fields, filledCount, ats });
  }

  return true; // Keep message channel open for async response
});

// ─── Inject floating "Auto-Fill" button on detected ATS pages ────────────────
function injectFloatingButton() {
  if (document.getElementById("jobagent-autofill-btn")) return;

  const btn = document.createElement("div");
  btn.id = "jobagent-autofill-btn";
  btn.innerHTML = `
    <button id="jobagent-fill-trigger" style="
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 99999;
      padding: 12px 20px;
      background: #818cf8;
      color: white;
      border: none;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(129,140,248,0.4);
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    ">
      <span style="font-size: 18px;">&#9889;</span>
      JobAgent Auto-Fill
    </button>
  `;
  document.body.appendChild(btn);

  document.getElementById("jobagent-fill-trigger").addEventListener("click", () => {
    // Open the extension popup
    // Since we can't open popup programmatically, show an inline panel instead
    showInlinePanel();
  });
}

function showInlinePanel() {
  let panel = document.getElementById("jobagent-panel");
  if (panel) {
    panel.style.display = panel.style.display === "none" ? "block" : "none";
    return;
  }

  panel = document.createElement("div");
  panel.id = "jobagent-panel";
  panel.innerHTML = `
    <div style="
      position: fixed; bottom: 70px; right: 20px; z-index: 99999;
      width: 320px; background: #0a0a0a; border: 1px solid #333;
      border-radius: 12px; padding: 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #e5e5e5;
    ">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <span style="font-weight:700; font-size:14px;">JobAgent Auto-Fill</span>
        <button id="jobagent-panel-close" style="background:none; border:none; color:#888; cursor:pointer; font-size:18px;">&times;</button>
      </div>
      <p style="font-size:12px; color:#888; margin-bottom:12px;">
        Click "Fill Now" to auto-fill this application with your apply pack materials.
      </p>
      <button id="jobagent-panel-fill" style="
        width:100%; padding:10px; background:#818cf8; color:#0a0a0a;
        border:none; border-radius:8px; font-weight:600; font-size:13px; cursor:pointer;
      ">Fill Now</button>
      <div id="jobagent-panel-status" style="margin-top:8px; font-size:11px; color:#888;"></div>
    </div>
  `;
  document.body.appendChild(panel);

  document.getElementById("jobagent-panel-close").addEventListener("click", () => {
    panel.style.display = "none";
  });

  document.getElementById("jobagent-panel-fill").addEventListener("click", async () => {
    const statusEl = document.getElementById("jobagent-panel-status");
    statusEl.textContent = "Loading apply pack...";

    // Get pack from extension storage
    const result = await chrome.storage.local.get(["applyPacks", "selectedPackIndex", "userProfile"]);
    const packs = result.applyPacks || [];
    const pack = packs[result.selectedPackIndex || 0];
    const profile = result.userProfile || {};

    if (!pack) {
      statusEl.innerHTML = "No apply pack found. <br>Generate one from <a href='http://localhost:3000/dashboard/agent' target='_blank' style='color:#818cf8;'>JobAgent</a> first.";
      return;
    }

    // Detect ATS
    const url = window.location.href;
    let ats = null;
    if (/greenhouse/i.test(url)) ats = "Greenhouse";
    else if (/lever/i.test(url)) ats = "Lever";
    else if (/workday/i.test(url)) ats = "Workday";

    if (!ats) {
      statusEl.textContent = "Could not detect ATS platform on this page.";
      return;
    }

    let fields = [];
    switch (ats) {
      case "Greenhouse": fields = fillGreenhouse(pack, profile); break;
      case "Lever": fields = fillLever(pack, profile); break;
      case "Workday": fields = fillWorkday(pack, profile); break;
    }

    const filled = fields.filter(f => f.filled).length;
    statusEl.innerHTML = `<span style="color:#22c55e;">Filled ${filled}/${fields.length} fields</span><br>` +
      fields.map(f => `<span style="color:${f.filled ? '#22c55e' : '#f59e0b'};">${f.filled ? '✓' : '○'} ${f.name}</span>`).join("<br>");
  });
}

// Inject button when page loads
injectFloatingButton();
