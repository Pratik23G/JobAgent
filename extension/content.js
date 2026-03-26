// content.js — ATS form detector and auto-filler
// Supports: Greenhouse, Lever, Workday, LinkedIn, Indeed, Workable, SmartRecruiters, BambooHR

// ─── Utility: set value and trigger React/Angular change events ──────────────
function setFieldValue(el, value) {
  if (!el || !value) return false;

  const tag = el.tagName.toLowerCase();

  if (tag === "select") {
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
    el.focus();
    el.value = value;

    // React uses a synthetic event system — trigger the native setter
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

  // ContentEditable divs (used by some modern ATS)
  if (el.isContentEditable) {
    el.focus();
    el.textContent = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  return false;
}

// ─── File upload via DataTransfer API ─────────────────────────────────────────
async function uploadFileToInput(fileInput, fileData, fileName, mimeType) {
  if (!fileInput || fileInput.type !== "file") return false;

  try {
    // Convert base64 data to blob
    let blob;
    if (typeof fileData === "string" && fileData.startsWith("data:")) {
      const res = await fetch(fileData);
      blob = await res.blob();
    } else if (typeof fileData === "string") {
      // base64 string without data URI prefix
      const binary = atob(fileData);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      blob = new Blob([bytes], { type: mimeType || "application/pdf" });
    } else {
      return false;
    }

    const file = new File([blob], fileName || "resume.pdf", {
      type: mimeType || "application/pdf",
    });

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    fileInput.files = dataTransfer.files;

    // Trigger events so the ATS picks up the file
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    fileInput.dispatchEvent(new Event("input", { bubbles: true }));

    return true;
  } catch (err) {
    console.warn("[JobAgent] File upload failed:", err);
    return false;
  }
}

// Find file input for resume uploads — searches visible AND hidden inputs
function findResumeFileInput() {
  // First, try visible file inputs
  const fileInputs = document.querySelectorAll('input[type="file"]');
  for (const input of fileInputs) {
    const accept = (input.accept || "").toLowerCase();
    const name = (input.name || "").toLowerCase();
    const id = (input.id || "").toLowerCase();
    const ariaLabel = (input.getAttribute("aria-label") || "").toLowerCase();

    const label = input.closest("label") ||
      (input.id && document.querySelector(`label[for="${input.id}"]`));
    const labelText = (label?.textContent || "").toLowerCase();

    // Also check surrounding text (parent containers)
    const parentText = (input.closest("[class*='upload'], [class*='drop'], [class*='file'], [class*='resume']")?.textContent || "").toLowerCase();

    if (accept.includes("pdf") || accept.includes("doc") ||
        name.includes("resume") || name.includes("cv") || name.includes("file") ||
        id.includes("resume") || id.includes("cv") ||
        ariaLabel.includes("resume") || ariaLabel.includes("cv") ||
        labelText.includes("resume") || labelText.includes("cv") ||
        labelText.includes("upload") ||
        parentText.includes("resume") || parentText.includes("cv") ||
        parentText.includes("upload") || parentText.includes("attach")) {
      return input;
    }
  }

  // Fallback: return the first file input
  if (fileInputs.length === 1) return fileInputs[0];

  // Some ATS (Ashby, etc.) hide the file input. Look for hidden ones inside dropzone areas.
  const hiddenInputs = document.querySelectorAll('input[type="file"][style*="display: none"], input[type="file"][style*="opacity: 0"], input[type="file"][hidden], input[type="file"][class*="hidden"]');
  if (hiddenInputs.length > 0) return hiddenInputs[0];

  // Last resort: look for any file input at all, even deeply nested
  const allFileInputs = document.querySelectorAll('input[type="file"]');
  if (allFileInputs.length > 0) return allFileInputs[0];

  return null;
}

// ─── Field matcher: find form fields by label text or attributes ─────────────
function findFieldByLabel(labelText) {
  const labels = document.querySelectorAll("label");
  for (const label of labels) {
    if (label.textContent.trim().toLowerCase().includes(labelText.toLowerCase())) {
      if (label.htmlFor) {
        const field = document.getElementById(label.htmlFor);
        if (field) return field;
      }
      const nested = label.querySelector("input, textarea, select");
      if (nested) return nested;
      const sibling = label.nextElementSibling;
      if (sibling && ["INPUT", "TEXTAREA", "SELECT"].includes(sibling.tagName)) {
        return sibling;
      }
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

// ─── Generic field filler (works across most ATS) ────────────────────────────
function fillGenericFields(pack, profile) {
  const results = [];

  // Common field patterns across all ATS platforms
  const fieldMap = [
    { name: "First Name", labels: ["first name", "first_name", "firstname", "given name"], value: profile.firstName },
    { name: "Last Name", labels: ["last name", "last_name", "lastname", "surname", "family name"], value: profile.lastName },
    { name: "Full Name", labels: ["full name", "name", "your name"], value: `${profile.firstName || ""} ${profile.lastName || ""}`.trim() },
    { name: "Email", labels: ["email", "e-mail", "email address"], value: profile.email },
    { name: "Phone", labels: ["phone", "telephone", "mobile", "phone number"], value: profile.phone },
    { name: "Location", labels: ["location", "city", "address"], value: profile.location },
    { name: "LinkedIn", labels: ["linkedin", "linkedin url", "linkedin profile"], value: profile.linkedin },
    { name: "Website", labels: ["website", "portfolio", "personal website", "github"], value: profile.website },
    { name: "Current Company", labels: ["current company", "company", "current employer", "organization"], value: profile.currentCompany },
    { name: "Current Title", labels: ["current title", "job title", "current role", "current position"], value: profile.currentTitle },
  ];

  for (const field of fieldMap) {
    if (!field.value) continue;
    let el = null;
    for (const label of field.labels) {
      el = findFieldByLabel(label);
      if (el) break;
    }
    if (el && !el.value) {
      const filled = setFieldValue(el, field.value);
      results.push({ name: field.name, filled });
    }
  }

  // Cover letter / additional info
  if (pack.cover_letter) {
    const coverField = findFieldByLabel("cover letter") ||
      findFieldByLabel("additional information") ||
      findFieldByLabel("additional") ||
      findFieldByLabel("comments");
    if (coverField && !coverField.value) {
      setFieldValue(coverField, pack.cover_letter);
      results.push({ name: "Cover Letter", filled: true });
    }
  }

  // "Why" questions
  const textareas = document.querySelectorAll("textarea");
  for (const ta of textareas) {
    if (ta.value) continue; // Skip if already filled
    const label = ta.closest(".field, .form-group, [class*='field']")?.querySelector("label")?.textContent || "";
    const placeholder = ta.placeholder || "";
    const combined = (label + " " + placeholder).toLowerCase();

    if (combined.includes("why") && (combined.includes("company") || combined.includes("role") || combined.includes("interested") || combined.includes("position"))) {
      const answer = pack.common_answers?.why_this_company || pack.common_answers?.why_this_role || pack.why_good_fit || "";
      if (answer) {
        setFieldValue(ta, answer);
        results.push({ name: label.trim().slice(0, 40) || "Why Question", filled: true });
      }
    }
  }

  return results;
}

// ─── ATS-specific fillers ───────────────────────────────────────────────────

function fillGreenhouse(pack, profile) {
  const results = [];

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
    if (!field.value) continue;
    let el = null;
    for (const sel of field.selectors) {
      el = document.querySelector(sel);
      if (el) break;
    }
    if (!el) el = findFieldByLabel(field.name);
    if (el && !el.value) {
      const filled = setFieldValue(el, field.value);
      results.push({ name: field.name, filled });
    }
  }

  // Cover letter
  const coverLetterField = findFieldByLabel("cover letter") ||
    document.querySelector("[name*='cover_letter'], [id*='cover_letter'], textarea[name*='letter']");
  if (coverLetterField && pack.cover_letter && !coverLetterField.value) {
    setFieldValue(coverLetterField, pack.cover_letter);
    results.push({ name: "Cover Letter", filled: true });
  }

  // "Why" questions
  const textareas = document.querySelectorAll("textarea");
  for (const ta of textareas) {
    if (ta.value) continue;
    const label = ta.closest(".field, .form-group")?.querySelector("label")?.textContent || "";
    const lowerLabel = label.toLowerCase();

    if (lowerLabel.includes("why") && (lowerLabel.includes("company") || lowerLabel.includes("role") || lowerLabel.includes("interested"))) {
      const answer = pack.common_answers?.why_this_company || pack.common_answers?.why_this_role || pack.why_good_fit || "";
      if (answer) {
        setFieldValue(ta, answer);
        results.push({ name: label.trim().slice(0, 40), filled: true });
      }
    }
  }

  return results;
}

function fillLever(pack, profile) {
  const results = [];

  const fieldMap = [
    { name: "Full Name", selectors: ["[name='name']", "#name"], value: `${profile.firstName || ""} ${profile.lastName || ""}`.trim() },
    { name: "Email", selectors: ["[name='email']", "#email"], value: profile.email },
    { name: "Phone", selectors: ["[name='phone']", "#phone"], value: profile.phone },
    { name: "Current Company", selectors: ["[name='org']", "#org", "[name='current_company']"], value: profile.currentCompany },
    { name: "LinkedIn", selectors: ["[name*='linkedin']", "[name='urls[LinkedIn]']"], value: profile.linkedin },
    { name: "Website", selectors: ["[name*='website']", "[name*='portfolio']", "[name='urls[Portfolio]']"], value: profile.website },
  ];

  for (const field of fieldMap) {
    if (!field.value) continue;
    let el = null;
    for (const sel of field.selectors) {
      el = document.querySelector(sel);
      if (el) break;
    }
    if (!el) el = findFieldByLabel(field.name);
    if (el && !el.value) {
      const filled = setFieldValue(el, field.value);
      results.push({ name: field.name, filled });
    }
  }

  const additionalField = findFieldByLabel("additional") ||
    document.querySelector("textarea[name*='comments'], textarea[name*='additional']");
  if (additionalField && pack.cover_letter && !additionalField.value) {
    setFieldValue(additionalField, pack.cover_letter);
    results.push({ name: "Additional Info (Cover Letter)", filled: true });
  }

  return results;
}

function fillWorkday(pack, profile) {
  const results = [];

  const fieldMap = [
    { name: "First Name", selectors: ["[data-automation-id='legalNameSection_firstName'] input", "[data-automation-id='firstName'] input"], value: profile.firstName },
    { name: "Last Name", selectors: ["[data-automation-id='legalNameSection_lastName'] input", "[data-automation-id='lastName'] input"], value: profile.lastName },
    { name: "Email", selectors: ["[data-automation-id='email'] input", "[type='email']"], value: profile.email },
    { name: "Phone", selectors: ["[data-automation-id='phone'] input", "[type='tel']"], value: profile.phone },
    { name: "Address", selectors: ["[data-automation-id='addressSection_addressLine1'] input"], value: profile.address },
    { name: "City", selectors: ["[data-automation-id='addressSection_city'] input"], value: profile.city },
  ];

  for (const field of fieldMap) {
    if (!field.value) continue;
    let el = null;
    for (const sel of field.selectors) {
      el = document.querySelector(sel);
      if (el) break;
    }
    if (!el) el = findFieldByLabel(field.name);
    if (el && !el.value) {
      const filled = setFieldValue(el, field.value);
      results.push({ name: field.name, filled });
    }
  }

  return results;
}

function fillLinkedIn(pack, profile) {
  // LinkedIn Easy Apply pre-fills most fields, but we can help with:
  const results = [];

  // Additional questions in Easy Apply modals
  const additionalFields = document.querySelectorAll(".jobs-easy-apply-form-section__grouping input, .jobs-easy-apply-form-section__grouping textarea, .jobs-easy-apply-form-section__grouping select");

  for (const field of additionalFields) {
    if (field.value) continue;
    const label = field.closest(".jobs-easy-apply-form-element")?.querySelector("label")?.textContent?.trim() || "";
    const lowerLabel = label.toLowerCase();

    // Phone
    if (lowerLabel.includes("phone") && profile.phone) {
      setFieldValue(field, profile.phone);
      results.push({ name: "Phone", filled: true });
    }
    // Website/LinkedIn fields
    else if ((lowerLabel.includes("website") || lowerLabel.includes("portfolio")) && profile.website) {
      setFieldValue(field, profile.website);
      results.push({ name: "Website", filled: true });
    }
  }

  // Cover letter textarea in Easy Apply
  const coverField = document.querySelector("textarea[name*='coverLetter'], .jobs-easy-apply-form-section__grouping textarea");
  if (coverField && pack.cover_letter && !coverField.value) {
    setFieldValue(coverField, pack.cover_letter);
    results.push({ name: "Cover Letter", filled: true });
  }

  return results;
}

// ─── Detect ATS from URL ────────────────────────────────────────────────────
function detectATS() {
  const url = window.location.href;
  if (/boards\.greenhouse\.io|jobs\.greenhouse\.io/i.test(url)) return "Greenhouse";
  if (/jobs\.lever\.co/i.test(url)) return "Lever";
  if (/myworkdayjobs\.com|myworkday\.com/i.test(url)) return "Workday";
  if (/linkedin\.com\/jobs/i.test(url)) return "LinkedIn";
  if (/indeed\.com/i.test(url)) return "Indeed";
  if (/apply\.workable\.com/i.test(url)) return "Workable";
  if (/smartrecruiters\.com/i.test(url)) return "SmartRecruiters";
  if (/bamboohr\.com/i.test(url)) return "BambooHR";
  if (/ashbyhq\.com/i.test(url)) return "Ashby";
  if (/icims\.com/i.test(url)) return "iCIMS";
  if (/taleo\.net/i.test(url)) return "Taleo";
  // Detect by page content — if there are form fields, treat as generic
  if (document.querySelectorAll('input[type="text"], input[type="email"], textarea').length >= 2) {
    return "Generic";
  }
  return null;
}

// ─── Ashby form filler ──────────────────────────────────────────────────────
function fillAshby(pack, profile) {
  const results = [];

  // Ashby uses standard HTML form inputs with labels
  // The application form at ashbyhq.com has: name, email, phone, linkedin, resume upload, etc.
  const fieldMap = [
    { name: "First Name", labels: ["first name", "first_name", "given name"], value: profile.firstName },
    { name: "Last Name", labels: ["last name", "last_name", "family name", "surname"], value: profile.lastName },
    { name: "Full Name", labels: ["full name", "name"], value: `${profile.firstName || ""} ${profile.lastName || ""}`.trim() },
    { name: "Email", labels: ["email", "e-mail"], value: profile.email },
    { name: "Phone", labels: ["phone", "mobile", "telephone"], value: profile.phone },
    { name: "LinkedIn", labels: ["linkedin"], value: profile.linkedin },
    { name: "Website", labels: ["website", "portfolio", "github", "personal"], value: profile.website },
    { name: "Location", labels: ["location", "city", "address"], value: profile.location },
    { name: "Current Company", labels: ["current company", "company", "employer"], value: profile.currentCompany },
  ];

  for (const field of fieldMap) {
    if (!field.value) continue;
    let el = null;
    for (const label of field.labels) {
      el = findFieldByLabel(label);
      if (el) break;
    }
    if (el && !el.value) {
      const filled = setFieldValue(el, field.value);
      if (filled) results.push({ name: field.name, filled: true });
    }
  }

  // Ashby often has a "Cover Letter" or "Additional Information" textarea
  if (pack.cover_letter) {
    const coverField = findFieldByLabel("cover letter") ||
      findFieldByLabel("additional information") ||
      findFieldByLabel("anything else");
    if (coverField && !coverField.value) {
      setFieldValue(coverField, pack.cover_letter);
      results.push({ name: "Cover Letter", filled: true });
    }
  }

  // Handle "Why" questions
  const textareas = document.querySelectorAll("textarea");
  for (const ta of textareas) {
    if (ta.value) continue;
    const label = ta.closest("[class*='field'], [class*='form'], [class*='question']")?.querySelector("label, [class*='label']")?.textContent || "";
    const combined = (label + " " + (ta.placeholder || "")).toLowerCase();
    if (combined.includes("why") && (combined.includes("company") || combined.includes("role") || combined.includes("interested") || combined.includes("position"))) {
      const answer = pack.common_answers?.why_this_company || pack.common_answers?.why_this_role || pack.why_good_fit || "";
      if (answer) {
        setFieldValue(ta, answer);
        results.push({ name: label.trim().slice(0, 40) || "Why Question", filled: true });
      }
    }
  }

  return results;
}

// ─── Main fill dispatcher ───────────────────────────────────────────────────
function fillApplication(pack, profile, ats) {
  let fields = [];

  // ATS-specific fillers first, then generic fallback
  switch (ats) {
    case "Greenhouse": fields = fillGreenhouse(pack, profile); break;
    case "Lever": fields = fillLever(pack, profile); break;
    case "Workday": fields = fillWorkday(pack, profile); break;
    case "LinkedIn": fields = fillLinkedIn(pack, profile); break;
    case "Ashby": fields = fillAshby(pack, profile); break;
    default: fields = fillGenericFields(pack, profile); break;
  }

  // For platforms without specific fillers, also run generic to catch additional fields
  if (!["Greenhouse", "Lever", "Workday", "LinkedIn", "Ashby"].includes(ats)) {
    // Already using generic
  } else {
    // Supplement ATS-specific with generic for any missed fields
    const genericFields = fillGenericFields(pack, profile);
    const filledNames = new Set(fields.map(f => f.name));
    for (const gf of genericFields) {
      if (!filledNames.has(gf.name)) {
        fields.push(gf);
      }
    }
  }

  return fields;
}

// ─── Resume file upload ─────────────────────────────────────────────────────
async function attemptResumeUpload() {
  const fileInput = findResumeFileInput();
  if (!fileInput) return { uploaded: false, reason: "No resume file input found" };

  const result = await chrome.storage.local.get(["resumeBlob", "resumeFileName", "resumeType"]);
  if (!result.resumeBlob) return { uploaded: false, reason: "No resume stored. Upload your resume in JobAgent first." };

  const success = await uploadFileToInput(
    fileInput,
    result.resumeBlob,
    result.resumeFileName || "resume.pdf",
    result.resumeType || "application/pdf"
  );

  return { uploaded: success, reason: success ? "Resume uploaded" : "Upload failed" };
}

// ─── Message handler ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "fill_application") {
    const { pack, profile, ats } = message;
    const detectedAts = ats || detectATS();
    const fields = fillApplication(pack, profile, detectedAts);
    const filledCount = fields.filter(f => f.filled).length;

    // Also attempt resume upload
    attemptResumeUpload().then(uploadResult => {
      if (uploadResult.uploaded) {
        fields.push({ name: "Resume Upload", filled: true });
      }

      // Report results back to background
      chrome.runtime.sendMessage({
        action: "fill_complete",
        fields,
        filledCount: fields.filter(f => f.filled).length,
        ats: detectedAts,
        resumeUploaded: uploadResult.uploaded,
      }).catch(() => {});

      sendResponse({ fields, filledCount: fields.filter(f => f.filled).length, ats: detectedAts, resumeUploaded: uploadResult.uploaded });
    });

    return true; // Keep channel open for async
  }

  if (message.action === "upload_resume") {
    attemptResumeUpload().then(sendResponse);
    return true;
  }

  if (message.action === "detect_ats") {
    sendResponse({ ats: detectATS() });
    return true;
  }

  if (message.action === "get_form_fields") {
    // Return all visible form fields for the form_filler sub-agent
    const fields = [];
    const inputs = document.querySelectorAll("input, textarea, select");
    for (const input of inputs) {
      if (input.type === "hidden" || input.type === "submit") continue;
      const label = input.closest(".field, .form-group, [class*='field']")?.querySelector("label")?.textContent?.trim() ||
        input.getAttribute("aria-label") || input.placeholder || input.name || input.id || "";
      fields.push({
        tag: input.tagName.toLowerCase(),
        type: input.type || "",
        name: input.name || "",
        id: input.id || "",
        label: label.slice(0, 100),
        required: input.required,
        value: input.value ? "(has value)" : "",
      });
    }
    sendResponse({ fields, ats: detectATS() });
    return true;
  }

  return true;
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
      width: 340px; background: #0a0a0a; border: 1px solid #333;
      border-radius: 12px; padding: 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #e5e5e5;
      max-height: 500px; overflow-y: auto;
    ">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <span style="font-weight:700; font-size:14px;">JobAgent Auto-Fill</span>
        <button id="jobagent-panel-close" style="background:none; border:none; color:#888; cursor:pointer; font-size:18px;">&times;</button>
      </div>
      <p id="jobagent-panel-ats" style="font-size:11px; color:#818cf8; margin-bottom:8px;"></p>
      <p style="font-size:12px; color:#888; margin-bottom:12px;">
        Click "Fill Now" to auto-fill this application with your apply pack materials.
      </p>
      <button id="jobagent-panel-fill" style="
        width:100%; padding:10px; background:#818cf8; color:#0a0a0a;
        border:none; border-radius:8px; font-weight:600; font-size:13px; cursor:pointer;
        margin-bottom:6px;
      ">Fill Form Fields</button>
      <button id="jobagent-panel-upload" style="
        width:100%; padding:10px; background:#1a1a1a; color:#e5e5e5;
        border:1px solid #333; border-radius:8px; font-weight:600; font-size:13px; cursor:pointer;
      ">Upload Resume PDF</button>
      <div id="jobagent-panel-status" style="margin-top:8px; font-size:11px; color:#888;"></div>
    </div>
  `;
  document.body.appendChild(panel);

  // Show detected ATS
  const ats = detectATS();
  const atsEl = document.getElementById("jobagent-panel-ats");
  atsEl.textContent = ats ? `Detected: ${ats}` : "Platform not detected — using generic filler";

  document.getElementById("jobagent-panel-close").addEventListener("click", () => {
    panel.style.display = "none";
  });

  // Fill button
  document.getElementById("jobagent-panel-fill").addEventListener("click", async () => {
    const statusEl = document.getElementById("jobagent-panel-status");
    statusEl.textContent = "Loading apply pack...";

    const result = await chrome.storage.local.get(["applyPacks", "selectedPackIndex", "userProfile"]);
    const packs = result.applyPacks || [];
    const pack = packs[result.selectedPackIndex || 0];
    const profile = result.userProfile || {};

    if (!pack) {
      statusEl.innerHTML = "No apply pack found.<br>Generate one from <a href='http://localhost:3000/dashboard/agent' target='_blank' style='color:#818cf8;'>JobAgent</a> first, then sync.";
      return;
    }

    statusEl.textContent = "Filling fields...";
    const detectedAts = detectATS();
    const fields = fillApplication(pack, profile, detectedAts);
    const filled = fields.filter(f => f.filled).length;

    statusEl.innerHTML = `<span style="color:#22c55e;">Filled ${filled}/${fields.length} fields</span><br>` +
      fields.map(f => `<span style="color:${f.filled ? '#22c55e' : '#f59e0b'};">${f.filled ? '✓' : '○'} ${f.name}</span>`).join("<br>");
  });

  // Upload button
  document.getElementById("jobagent-panel-upload").addEventListener("click", async () => {
    const statusEl = document.getElementById("jobagent-panel-status");
    statusEl.textContent = "Uploading resume...";
    const result = await attemptResumeUpload();
    statusEl.innerHTML = result.uploaded
      ? '<span style="color:#22c55e;">✓ Resume uploaded successfully</span>'
      : `<span style="color:#f59e0b;">○ ${result.reason}</span>`;
  });
}

// ─── MutationObserver for dynamic forms (LinkedIn/Indeed multi-step) ─────────

let lastFillPack = null;
let lastFillProfile = null;
let observerActive = false;

function startFormObserver() {
  if (observerActive) return;
  observerActive = true;

  const ats = detectATS();
  if (!ats) return;

  // Debounce: don't re-fill within 1 second of last fill
  let lastFillTime = 0;

  const observer = new MutationObserver((mutations) => {
    // Only care about added nodes that contain form elements
    let hasNewFormElements = false;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const el = node;
        if (el.querySelector && (
          el.querySelector("input, textarea, select") ||
          el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT"
        )) {
          hasNewFormElements = true;
          break;
        }
      }
      if (hasNewFormElements) break;
    }

    if (!hasNewFormElements) return;

    // Debounce
    const now = Date.now();
    if (now - lastFillTime < 1000) return;
    lastFillTime = now;

    // If we have cached pack/profile from a previous fill, auto-fill new fields
    if (lastFillPack && lastFillProfile) {
      // Wait a short moment for the DOM to settle (React re-renders, etc.)
      setTimeout(() => {
        const fields = fillApplication(lastFillPack, lastFillProfile, ats);
        const filled = fields.filter(f => f.filled).length;
        if (filled > 0) {
          console.log(`[JobAgent] Auto-filled ${filled} new fields after DOM update`);
          // Update the panel status if visible
          const statusEl = document.getElementById("jobagent-panel-status");
          if (statusEl) {
            statusEl.innerHTML += `<br><span style="color:#818cf8;">Auto-filled ${filled} new field(s) on step change</span>`;
          }
        }
      }, 500);
    }
  });

  // Observe the entire document for added/removed nodes
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  console.log(`[JobAgent] MutationObserver active for ${ats}`);
}

// LinkedIn Easy Apply: also watch for the modal opening
function watchLinkedInEasyApply() {
  if (!window.location.href.includes("linkedin.com")) return;

  // LinkedIn loads Easy Apply in a modal. Watch for it.
  const observer = new MutationObserver(() => {
    const modal = document.querySelector(".jobs-easy-apply-modal, .jobs-apply-modal, [data-test-modal]");
    if (modal && !modal.dataset.jobagentObserved) {
      modal.dataset.jobagentObserved = "true";
      console.log("[JobAgent] LinkedIn Easy Apply modal detected");

      // Watch for step changes inside the modal
      const stepObserver = new MutationObserver(() => {
        if (lastFillPack && lastFillProfile) {
          setTimeout(() => {
            const fields = fillLinkedIn(lastFillPack, lastFillProfile);
            const filled = fields.filter(f => f.filled).length;
            if (filled > 0) {
              console.log(`[JobAgent] LinkedIn step change: filled ${filled} fields`);
            }
          }, 300);
        }
      });

      stepObserver.observe(modal, { childList: true, subtree: true });
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

// Indeed: handle iframe-based applications
function watchIndeedApplication() {
  if (!window.location.href.includes("indeed.com")) return;

  // Indeed sometimes loads the application in an iframe
  const checkIframe = () => {
    const iframes = document.querySelectorAll("iframe[src*='apply'], iframe[id*='apply']");
    for (const iframe of iframes) {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (iframeDoc && !iframe.dataset.jobagentObserved) {
          iframe.dataset.jobagentObserved = "true";
          console.log("[JobAgent] Indeed application iframe detected");
          // Note: cross-origin iframes will block access.
          // Same-origin iframes can be filled.
          if (lastFillPack && lastFillProfile) {
            const inputs = iframeDoc.querySelectorAll("input, textarea, select");
            if (inputs.length > 0) {
              console.log(`[JobAgent] Found ${inputs.length} fields in Indeed iframe`);
            }
          }
        }
      } catch {
        // Cross-origin — can't access. This is expected for many Indeed embeds.
      }
    }
  };

  // Check periodically since iframes load asynchronously
  const interval = setInterval(checkIframe, 2000);
  // Stop checking after 30 seconds
  setTimeout(() => clearInterval(interval), 30000);
}

// Override fillApplication to cache pack/profile for the observer
const _originalFillApplication = fillApplication;
// We can't reassign a function declaration, so we patch via the message handler instead.
// The message handler already calls fillApplication — we just save the args.

// Patch the message handler to cache pack/profile
const originalListener = chrome.runtime.onMessage.hasListeners;
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "fill_application") {
    lastFillPack = message.pack;
    lastFillProfile = message.profile;
  }
});

// Start observers
startFormObserver();
watchLinkedInEasyApply();
watchIndeedApplication();

// Inject button when page loads
injectFloatingButton();
