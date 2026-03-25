// popup.js — JobAgent Auto-Fill Extension

const DEFAULT_URL = "http://localhost:3000";

async function getServerUrl() {
  const result = await chrome.storage.local.get("serverUrl");
  return result.serverUrl || DEFAULT_URL;
}

async function getApplyPacks() {
  // Get apply packs from localStorage of the JobAgent tab
  // We'll use a content script message to the active tab, or fall back to storage
  const result = await chrome.storage.local.get("applyPacks");
  return result.applyPacks || [];
}

async function init() {
  const statusEl = document.getElementById("status");
  const atsInfo = document.getElementById("ats-info");
  const atsName = document.getElementById("ats-name");
  const packSection = document.getElementById("pack-section");
  const packList = document.getElementById("pack-list");
  const fillBtn = document.getElementById("fill-btn");
  const fillResults = document.getElementById("fill-results");
  const fieldResults = document.getElementById("field-results");
  const openAgent = document.getElementById("open-agent");
  const serverUrlInput = document.getElementById("server-url");

  // Load saved server URL
  const serverUrl = await getServerUrl();
  serverUrlInput.value = serverUrl;

  // Save URL on change
  serverUrlInput.addEventListener("change", () => {
    chrome.storage.local.set({ serverUrl: serverUrlInput.value.trim() || DEFAULT_URL });
  });

  // Sync button
  const syncBtn = document.getElementById("sync-btn");
  syncBtn.addEventListener("click", async () => {
    syncBtn.textContent = "Syncing...";
    syncBtn.disabled = true;
    try {
      const url = serverUrlInput.value.trim() || DEFAULT_URL;
      const res = await fetch(`${url}/api/extension/sync`);
      const data = await res.json();
      if (data.packs) {
        await chrome.storage.local.set({ applyPacks: data.packs });
      }
      if (data.profile) {
        await chrome.storage.local.set({ userProfile: data.profile });
      }
      syncBtn.textContent = `Synced ${data.packs?.length || 0} packs`;
      // Refresh popup
      setTimeout(() => location.reload(), 1000);
    } catch (err) {
      syncBtn.textContent = "Sync failed — check URL";
    }
    setTimeout(() => {
      syncBtn.textContent = "Sync Apply Packs from JobAgent";
      syncBtn.disabled = false;
    }, 3000);
  });

  // Open dashboard
  openAgent.addEventListener("click", () => {
    chrome.tabs.create({ url: `${serverUrlInput.value || DEFAULT_URL}/dashboard/agent` });
  });

  // Check current tab for ATS detection
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || "";

  let detectedATS = null;
  if (/boards\.greenhouse\.io|jobs\.greenhouse\.io/i.test(url)) {
    detectedATS = "Greenhouse";
  } else if (/jobs\.lever\.co/i.test(url)) {
    detectedATS = "Lever";
  } else if (/myworkdayjobs\.com|myworkday\.com/i.test(url)) {
    detectedATS = "Workday";
  }

  if (detectedATS) {
    atsInfo.style.display = "block";
    atsName.textContent = `${detectedATS} application detected`;
    statusEl.className = "status connected";
    statusEl.textContent = "Ready to auto-fill";
  } else {
    statusEl.className = "status disconnected";
    statusEl.textContent = "Navigate to a job application page (Greenhouse, Lever, or Workday) to auto-fill";
  }

  // Load apply packs from extension storage
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
        // Select this pack
        document.querySelectorAll(".pack-item").forEach(el => el.style.border = "1px solid #333");
        div.style.border = "1px solid #818cf8";
        chrome.storage.local.set({ selectedPackIndex: i });
      });
      packList.appendChild(div);
    });
    chrome.storage.local.set({ selectedPackIndex: 0 });
  } else {
    packSection.style.display = "block";
    packList.innerHTML = '<div class="pack-item"><div class="pack-title">No apply packs found. Generate one from the Agent first, then click "Sync Packs" below.</div></div>';
  }

  // Fill button
  fillBtn.disabled = !detectedATS || packs.length === 0;

  fillBtn.addEventListener("click", async () => {
    fillBtn.disabled = true;
    fillBtn.textContent = "Filling...";

    const { selectedPackIndex } = await chrome.storage.local.get("selectedPackIndex");
    const pack = packs[selectedPackIndex || 0];

    if (!pack) {
      fillBtn.textContent = "No pack selected";
      return;
    }

    // Get user profile from storage
    const { userProfile } = await chrome.storage.local.get("userProfile");

    // Send fill command to content script
    const results = await chrome.tabs.sendMessage(tab.id, {
      action: "fill_application",
      pack,
      profile: userProfile || {},
      ats: detectedATS,
    });

    // Show results
    fillResults.style.display = "block";
    fieldResults.innerHTML = "";
    if (results && results.fields) {
      results.fields.forEach(field => {
        const li = document.createElement("li");
        li.className = field.filled ? "filled" : "missed";
        li.textContent = `${field.filled ? "✓" : "○"} ${field.name}: ${field.filled ? "Filled" : "Not found"}`;
        fieldResults.appendChild(li);
      });
    }

    fillBtn.textContent = `Filled ${results?.filledCount || 0} fields`;
    setTimeout(() => {
      fillBtn.textContent = "Auto-Fill Application";
      fillBtn.disabled = false;
    }, 3000);
  });
}

init();
