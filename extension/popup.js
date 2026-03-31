// popup.js — JobAgent Auto-Fill Extension v2.1

const DEFAULT_URL = "http://localhost:3000";

async function getServerUrl() {
  const result = await chrome.storage.local.get("serverUrl");
  return result.serverUrl || DEFAULT_URL;
}

async function getApplyPacks() {
  const result = await chrome.storage.local.get("applyPacks");
  return result.applyPacks || [];
}

// Inject content script into a tab if not already present
async function ensureContentScript(tabId) {
  try {
    // Try pinging the content script
    await chrome.tabs.sendMessage(tabId, { action: "detect_ats" });
    return true; // Already injected
  } catch {
    // Not injected — inject now
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      await chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] });
      // Wait for script to initialize
      await new Promise(r => setTimeout(r, 500));
      return true;
    } catch (err) {
      console.error("Failed to inject content script:", err);
      return false;
    }
  }
}

async function init() {
  const statusEl = document.getElementById("status");
  const atsInfo = document.getElementById("ats-info");
  const atsName = document.getElementById("ats-name");
  const packSection = document.getElementById("pack-section");
  const packList = document.getElementById("pack-list");
  const fillBtn = document.getElementById("fill-btn");
  const uploadBtn = document.getElementById("upload-btn");
  const fillResults = document.getElementById("fill-results");
  const fieldResults = document.getElementById("field-results");
  const openAgent = document.getElementById("open-agent");
  const serverUrlInput = document.getElementById("server-url");

  // Load saved server URL
  const serverUrl = await getServerUrl();
  serverUrlInput.value = serverUrl;

  serverUrlInput.addEventListener("change", () => {
    chrome.storage.local.set({ serverUrl: serverUrlInput.value.trim() || DEFAULT_URL });
  });

  // Sync button — also syncs resume blob
  const syncBtn = document.getElementById("sync-btn");
  syncBtn.addEventListener("click", async () => {
    syncBtn.textContent = "Syncing...";
    syncBtn.disabled = true;
    try {
      const url = serverUrlInput.value.trim() || DEFAULT_URL;
      const { sessionId } = await chrome.storage.local.get("sessionId");
      const syncUrl = sessionId
        ? `${url}/api/extension/sync?sessionId=${sessionId}`
        : `${url}/api/extension/sync`;

      const res = await fetch(syncUrl);
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }
      const data = await res.json();

      if (data.source === "error") {
        syncBtn.textContent = "Sync error — check server logs";
        console.error("Sync returned error source:", data);
        return;
      }

      // Store packs (replace, not merge)
      await chrome.storage.local.set({ applyPacks: data.packs || [] });

      // Store profile (parsed resume data for form filling)
      if (data.profile && Object.keys(data.profile).length > 0) {
        await chrome.storage.local.set({ userProfile: data.profile });
      }

      // Store resume blob for file upload
      if (data.resumeFileUrl) {
        await chrome.storage.local.set({
          resumeBlob: data.resumeFileUrl,
          resumeFileName: "resume.pdf",
          resumeType: "application/pdf",
        });
        syncBtn.textContent = `Synced ${data.packs?.length || 0} packs + resume`;
      } else if (data.needsReupload) {
        syncBtn.textContent = `Synced ${data.packs?.length || 0} packs — RE-UPLOAD resume in Dashboard!`;
      } else {
        syncBtn.textContent = `Synced ${data.packs?.length || 0} packs (no resume found)`;
      }
      setTimeout(() => location.reload(), 1500);
    } catch (err) {
      syncBtn.textContent = "Sync failed — check URL";
      console.error("Sync error:", err);
    }
    setTimeout(() => {
      syncBtn.textContent = "Sync Packs";
      syncBtn.disabled = false;
    }, 4000);
  });

  // Open dashboard
  openAgent.addEventListener("click", () => {
    chrome.tabs.create({ url: `${serverUrlInput.value || DEFAULT_URL}/dashboard/agent` });
  });

  // Check current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || "";

  // Detect ATS
  let detectedATS = null;
  if (/boards\.greenhouse\.io|jobs\.greenhouse\.io/i.test(url)) detectedATS = "Greenhouse";
  else if (/jobs\.lever\.co/i.test(url)) detectedATS = "Lever";
  else if (/myworkdayjobs\.com|myworkday\.com/i.test(url)) detectedATS = "Workday";
  else if (/linkedin\.com\/jobs/i.test(url)) detectedATS = "LinkedIn";
  else if (/indeed\.com/i.test(url)) detectedATS = "Indeed";
  else if (/apply\.workable\.com/i.test(url)) detectedATS = "Workable";
  else if (/smartrecruiters\.com/i.test(url)) detectedATS = "SmartRecruiters";
  else if (/bamboohr\.com/i.test(url)) detectedATS = "BambooHR";
  else if (/ashbyhq\.com/i.test(url)) detectedATS = "Ashby";
  else if (/icims\.com/i.test(url)) detectedATS = "iCIMS";
  else if (/taleo\.net/i.test(url)) detectedATS = "Taleo";

  // Check if it looks like a career/jobs page even if not a known ATS
  if (!detectedATS && (
    /career|jobs|apply|hiring|position|openings|opportunities|application/i.test(url) ||
    /career|jobs|apply|hiring/i.test(tab?.title || "")
  )) {
    detectedATS = "Generic";
  }

  // Check what data the extension has
  const storageData = await chrome.storage.local.get(["resumeBlob", "userProfile"]);
  const hasResume = !!storageData.resumeBlob;
  const hasProfile = !!(storageData.userProfile?.firstName || storageData.userProfile?.email);

  if (detectedATS) {
    atsInfo.style.display = "block";
    atsName.textContent = detectedATS === "Generic"
      ? "Career page detected (generic fill)"
      : `${detectedATS} application detected`;
    statusEl.className = "status connected";
    if (hasProfile && hasResume) {
      statusEl.textContent = "Ready to auto-fill + upload resume";
    } else if (hasProfile) {
      statusEl.textContent = "Ready to auto-fill (no PDF for upload)";
    } else {
      statusEl.textContent = "Detected! Click Sync Packs to load your data.";
    }
  } else {
    statusEl.className = "status disconnected";
    statusEl.textContent = "Not on a job page, but you can still try filling.";
  }

  // Load packs
  const packs = await getApplyPacks();

  if (packs.length > 0) {
    packSection.style.display = "block";
    packList.innerHTML = "";
    packs.forEach((pack, i) => {
      const div = document.createElement("div");
      div.className = "pack-item";
      div.innerHTML = `
        <div class="pack-company">${pack.company || "Unknown"}</div>
        <div class="pack-title">${pack.title || pack.job_title || "—"}</div>
      `;
      div.style.cursor = "pointer";
      div.style.border = i === 0 ? "1px solid #818cf8" : "1px solid #333";
      div.addEventListener("click", () => {
        document.querySelectorAll(".pack-item").forEach(el => el.style.border = "1px solid #333");
        div.style.border = "1px solid #818cf8";
        chrome.storage.local.set({ selectedPackIndex: i });
      });
      packList.appendChild(div);
    });
    chrome.storage.local.set({ selectedPackIndex: 0 });
  } else {
    packSection.style.display = "block";
    packList.innerHTML = '<div class="pack-item"><div class="pack-title">No apply packs found. Generate one from the Agent first, then click "Sync Packs".</div></div>';
  }

  // ─── Fill button ───────────────────────────────────────────────────────────
  fillBtn.disabled = packs.length === 0;

  fillBtn.addEventListener("click", async () => {
    fillBtn.disabled = true;
    fillBtn.textContent = "Injecting...";

    const { selectedPackIndex } = await chrome.storage.local.get("selectedPackIndex");
    const pack = packs[selectedPackIndex || 0];
    if (!pack) {
      fillBtn.textContent = "No pack selected";
      setTimeout(() => { fillBtn.textContent = "Auto-Fill Application"; fillBtn.disabled = false; }, 2000);
      return;
    }

    const { userProfile } = await chrome.storage.local.get("userProfile");

    // Ensure content script is injected
    const injected = await ensureContentScript(tab.id);
    if (!injected) {
      fillBtn.textContent = "Cannot inject — try refreshing page";
      setTimeout(() => { fillBtn.textContent = "Auto-Fill Application"; fillBtn.disabled = false; }, 3000);
      return;
    }

    fillBtn.textContent = "Filling...";

    try {
      const results = await chrome.tabs.sendMessage(tab.id, {
        action: "fill_application",
        pack,
        profile: userProfile || {},
        ats: detectedATS || "Generic",
      });

      fillResults.style.display = "block";
      fieldResults.innerHTML = "";
      if (results?.fields) {
        results.fields.forEach(field => {
          const li = document.createElement("li");
          li.className = field.filled ? "filled" : "missed";
          li.textContent = `${field.filled ? "✓" : "○"} ${field.name}: ${field.filled ? "Filled" : "Not found"}`;
          fieldResults.appendChild(li);
        });
      }
      fillBtn.textContent = `Filled ${results?.filledCount || 0} fields`;
    } catch (err) {
      fillBtn.textContent = "Fill failed — " + (err.message || "unknown error");
      console.error("Fill error:", err);
    }

    setTimeout(() => { fillBtn.textContent = "Auto-Fill Application"; fillBtn.disabled = false; }, 3000);
  });

  // ─── Fill & Submit button (does everything: fill + upload + submit) ────────
  const submitBtn = document.getElementById("submit-btn");
  submitBtn.disabled = packs.length === 0;

  submitBtn.addEventListener("click", async () => {
    submitBtn.disabled = true;
    submitBtn.textContent = "Injecting...";

    const { selectedPackIndex } = await chrome.storage.local.get("selectedPackIndex");
    const pack = packs[selectedPackIndex || 0];
    if (!pack) {
      submitBtn.textContent = "No pack selected";
      setTimeout(() => { submitBtn.textContent = "Fill, Upload & Submit"; submitBtn.disabled = false; }, 2000);
      return;
    }

    const { userProfile } = await chrome.storage.local.get("userProfile");

    const injected = await ensureContentScript(tab.id);
    if (!injected) {
      submitBtn.textContent = "Cannot inject — refresh page";
      setTimeout(() => { submitBtn.textContent = "Fill, Upload & Submit"; submitBtn.disabled = false; }, 3000);
      return;
    }

    submitBtn.textContent = "Filling + Submitting...";

    try {
      const results = await chrome.tabs.sendMessage(tab.id, {
        action: "fill_and_submit",
        pack,
        profile: userProfile || {},
        ats: detectedATS || "Generic",
      });

      fillResults.style.display = "block";
      fieldResults.innerHTML = "";

      if (results?.fields) {
        results.fields.forEach(field => {
          const li = document.createElement("li");
          li.className = field.filled ? "filled" : "missed";
          li.textContent = `${field.filled ? "✓" : "○"} ${field.name}`;
          fieldResults.appendChild(li);
        });
      }

      // Show submit status
      const submitLi = document.createElement("li");
      if (results?.submitted) {
        submitLi.className = "filled";
        submitLi.textContent = `✓ Form submitted! (${results.submitReason})`;
        submitBtn.textContent = "Submitted!";
        submitBtn.style.background = "#22c55e";
      } else {
        submitLi.className = "missed";
        submitLi.textContent = `○ Submit: ${results?.submitReason || "No submit button found"}`;
        submitBtn.textContent = "Filled (submit manually)";
        submitBtn.style.background = "#f59e0b";
      }
      fieldResults.appendChild(submitLi);

      if (results?.report?.message) {
        const reportLi = document.createElement("li");
        reportLi.className = "filled";
        reportLi.textContent = `✓ ${results.report.message}`;
        fieldResults.appendChild(reportLi);
      }
    } catch (err) {
      submitBtn.textContent = "Failed — " + (err.message || "error");
    }

    setTimeout(() => {
      submitBtn.textContent = "Fill, Upload & Submit";
      submitBtn.style.background = "#22c55e";
      submitBtn.disabled = false;
    }, 5000);
  });

  // ─── Upload resume button ─────────────────────────────────────────────────
  uploadBtn.disabled = !hasResume;
  if (!hasResume) {
    uploadBtn.textContent = "No PDF attached — Attach in Dashboard";
  }

  uploadBtn.addEventListener("click", async () => {
    if (!hasResume) {
      uploadBtn.textContent = "Sync packs first to get resume";
      setTimeout(() => { uploadBtn.textContent = "No Resume (Sync First)"; }, 2000);
      return;
    }

    uploadBtn.disabled = true;
    uploadBtn.textContent = "Injecting...";

    const injected = await ensureContentScript(tab.id);
    if (!injected) {
      uploadBtn.textContent = "Cannot inject — try refreshing";
      setTimeout(() => { uploadBtn.textContent = "Upload Resume PDF"; uploadBtn.disabled = false; }, 3000);
      return;
    }

    uploadBtn.textContent = "Uploading...";

    try {
      const results = await chrome.tabs.sendMessage(tab.id, { action: "upload_resume" });

      if (results?.uploaded) {
        uploadBtn.textContent = "Resume Uploaded!";
        uploadBtn.style.borderColor = "#22c55e";
        uploadBtn.style.color = "#22c55e";
      } else {
        uploadBtn.textContent = results?.reason || "No file input found on page";
        uploadBtn.style.borderColor = "#f59e0b";
        uploadBtn.style.color = "#f59e0b";
      }
    } catch (err) {
      uploadBtn.textContent = "Upload failed — " + (err.message || "error");
      console.error("Upload error:", err);
    }

    setTimeout(() => {
      uploadBtn.textContent = "Upload Resume PDF";
      uploadBtn.disabled = false;
      uploadBtn.style.borderColor = "";
      uploadBtn.style.color = "";
    }, 3000);
  });

  // Listen for background events
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "sync_complete" || message.action === "packs_updated") {
      const badge = document.getElementById("sync-badge");
      if (badge) badge.textContent = `Updated: ${message.count || message.newPacks || 0} packs`;
    }
  });
}

init();
