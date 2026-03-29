// background.js — Service worker for JobAgent extension
// Handles: SSE real-time stream, auto-sync fallback, tab monitoring

const DEFAULT_URL = "http://localhost:3000";

// ─── SSE Real-Time Stream ───────────────────────────────────────────────────

let sseController = null; // AbortController for active SSE connection
let sseRetryTimeout = null;

async function connectSSE() {
  const serverUrl = await getServerUrl();
  const sessionId = await getSessionId();

  if (!sessionId) {
    console.log("[JobAgent] No sessionId — skipping SSE, using polling only");
    return;
  }

  // Disconnect any existing connection
  disconnectSSE();

  try {
    sseController = new AbortController();
    const url = `${serverUrl}/api/extension/stream?sessionId=${sessionId}`;

    const response = await fetch(url, {
      signal: sseController.signal,
      headers: { Accept: "text/event-stream" },
    });

    if (!response.ok || !response.body) {
      throw new Error(`SSE connection failed: ${response.status}`);
    }

    console.log("[JobAgent] SSE connected");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events from buffer
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      let currentEvent = "";
      let currentData = "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          currentData = line.slice(6).trim();
        } else if (line === "" && currentEvent && currentData) {
          // End of event — process it
          await handleSSEEvent(currentEvent, currentData);
          currentEvent = "";
          currentData = "";
        }
      }
    }
  } catch (err) {
    if (err.name === "AbortError") return; // Intentional disconnect
    console.warn("[JobAgent] SSE error, retrying in 10s:", err.message);
  }

  // Reconnect after delay (unless intentionally disconnected)
  if (sseController && !sseController.signal.aborted) {
    sseRetryTimeout = setTimeout(connectSSE, 10000);
  }
}

function disconnectSSE() {
  if (sseController) {
    sseController.abort();
    sseController = null;
  }
  if (sseRetryTimeout) {
    clearTimeout(sseRetryTimeout);
    sseRetryTimeout = null;
  }
}

async function handleSSEEvent(event, dataStr) {
  try {
    const data = JSON.parse(dataStr);

    switch (event) {
      case "apply_pack": {
        // New apply packs pushed from the agent — REPLACE old packs, don't merge
        const packs = data.packs || [];
        if (packs.length > 0) {
          await chrome.storage.local.set({ applyPacks: packs });
        }

        // Notify popup and content scripts
        chrome.runtime.sendMessage({
          action: "packs_updated",
          count: merged.length,
          newPacks: packs.length,
        }).catch(() => {});

        // Badge notification
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
          chrome.action.setBadgeText({ text: `${packs.length}`, tabId: tab.id });
          chrome.action.setBadgeBackgroundColor({ color: "#22c55e", tabId: tab.id });
          // Clear badge after 5s
          setTimeout(() => {
            chrome.action.setBadgeText({ text: "", tabId: tab.id }).catch(() => {});
          }, 5000);
        }
        break;
      }

      case "form_fill": {
        // Agent wants to push form-fill data directly to the active tab
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab?.id && detectATS(activeTab.url)) {
          chrome.tabs.sendMessage(activeTab.id, {
            action: "fill_application",
            pack: data.pack,
            profile: data.profile,
            ats: detectATS(activeTab.url),
          }).catch(() => {});
        }
        break;
      }

      case "connected":
        console.log("[JobAgent] SSE stream confirmed for session:", data.sessionId);
        break;

      case "auto_fill_request": {
        // Autonomous pipeline: navigate to job URL, fill form (no submit), report back
        const { queueId, jobUrl, jobTitle, company, matchScore, pack, profile, resumeFileUrl } = data;
        console.log(`[JobAgent] Auto-fill request: ${jobTitle} at ${company} (score: ${matchScore})`);

        // Add to fill queue (process sequentially to avoid overwhelming browser)
        addToFillQueue({ queueId, jobUrl, jobTitle, company, pack, profile, resumeFileUrl });
        break;
      }

      case "submit_approved": {
        // Human approved — find the tab and click submit
        const { queueId: approvedQueueId, jobUrl: approvedUrl } = data;
        console.log(`[JobAgent] Submit approved for queue item: ${approvedQueueId}`);

        // Find matching tab
        const tabs = await chrome.tabs.query({});
        const matchingTab = tabs.find(t => t.url && t.url.includes(new URL(approvedUrl).hostname));
        if (matchingTab?.id) {
          chrome.tabs.sendMessage(matchingTab.id, {
            action: "submit_approved",
            queueId: approvedQueueId,
            pack: data.pack || {},
            filledCount: data.filledCount || 0,
            resumeUploaded: data.resumeUploaded || false,
          }).catch(() => {});
        }
        break;
      }

      default:
        console.log("[JobAgent] Unknown SSE event:", event, data);
    }
  } catch (err) {
    console.warn("[JobAgent] SSE event parse error:", err);
  }
}

// ─── Auto-fill queue: process one job at a time ─────────────────────────────

const fillQueue = [];
let fillQueueRunning = false;
const FILL_DELAY = 10000; // 10s between fills

function addToFillQueue(item) {
  fillQueue.push(item);
  if (!fillQueueRunning) processFillQueue();
}

async function processFillQueue() {
  if (fillQueue.length === 0) {
    fillQueueRunning = false;
    return;
  }

  fillQueueRunning = true;
  const item = fillQueue.shift();

  try {
    await navigateAndFill(item);
  } catch (err) {
    console.error("[JobAgent] Fill failed:", err);
    await reportFillResult(item.queueId, {
      success: false,
      error: err.message || String(err),
    });
  }

  // Delay before next fill
  if (fillQueue.length > 0) {
    setTimeout(processFillQueue, FILL_DELAY);
  } else {
    fillQueueRunning = false;
  }
}

async function navigateAndFill(item) {
  const { queueId, jobUrl, pack, profile, resumeFileUrl } = item;

  // Store resume if provided
  if (resumeFileUrl) {
    await chrome.storage.local.set({
      resumeBlob: resumeFileUrl,
      resumeFileName: "resume.pdf",
      resumeType: "application/pdf",
    });
  }

  // Open job URL in a new background tab
  const tab = await chrome.tabs.create({ url: jobUrl, active: false });

  // Wait for page to fully load
  await new Promise((resolve) => {
    const listener = (tabId, changeInfo) => {
      if (tabId === tab.id && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    // Timeout after 30s
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 30000);
  });

  // Wait an extra 2s for dynamic content (React/SPA rendering)
  await new Promise(r => setTimeout(r, 2000));

  // Inject content script
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  } catch {
    // Already injected via manifest match patterns — that's fine
  }

  await new Promise(r => setTimeout(r, 500));

  // Send fill_only message (fills form, does NOT submit)
  const ats = detectATS(jobUrl);
  const result = await chrome.tabs.sendMessage(tab.id, {
    action: "fill_only",
    pack: pack || {},
    profile: profile || {},
    ats: ats || "Generic",
    queueId,
  });

  // Report results back to the server
  await reportFillResult(queueId, {
    success: true,
    fields_filled: result?.filledCount || 0,
    fields_total: result?.totalFields || 0,
    resume_uploaded: result?.resumeUploaded || false,
    form_snapshot: result?.formSnapshot || null,
    tab_id: tab.id,
  });
}

async function reportFillResult(queueId, result) {
  try {
    const serverUrl = await getServerUrl();
    await fetch(`${serverUrl}/api/queue/${queueId}/fill-result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    });
  } catch (err) {
    console.warn("[JobAgent] Failed to report fill result:", err);
  }
}

// ─── Auto-sync fallback (every 5 minutes, in case SSE disconnects) ──────────

chrome.alarms.create("sync-packs", { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "sync-packs") {
    await syncFromBackend();
  }
});

async function getServerUrl() {
  const result = await chrome.storage.local.get("serverUrl");
  return result.serverUrl || DEFAULT_URL;
}

async function getSessionId() {
  const result = await chrome.storage.local.get("sessionId");
  return result.sessionId || "";
}

async function syncFromBackend() {
  try {
    const serverUrl = await getServerUrl();
    const sessionId = await getSessionId();
    const url = sessionId
      ? `${serverUrl}/api/extension/sync?sessionId=${sessionId}`
      : `${serverUrl}/api/extension/sync`;

    const res = await fetch(url);
    if (!res.ok) return;

    const data = await res.json();
    // Always replace packs with latest from server (not merge)
    await chrome.storage.local.set({ applyPacks: data.packs || [] });

    if (data.profile) {
      await chrome.storage.local.set({ userProfile: data.profile });
    }

    // If a resume data URI is provided, store it directly for ATS file upload
    if (data.resumeFileUrl) {
      await chrome.storage.local.set({
        resumeBlob: data.resumeFileUrl,
        resumeFileName: "resume.pdf",
        resumeType: "application/pdf",
      });
    }

    chrome.runtime.sendMessage({ action: "sync_complete", count: data.packs?.length || 0 }).catch(() => {});
  } catch {
    // Server unreachable — silent fail
  }
}

// ─── Startup: sync + connect SSE ────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  syncFromBackend();
  connectSSE();
});

// Also reconnect SSE when service worker wakes up
chrome.runtime.onStartup.addListener(() => {
  connectSSE();
});

// Reconnect SSE when sessionId changes
chrome.storage.onChanged.addListener((changes) => {
  if (changes.sessionId) {
    connectSSE();
  }
});

// ─── Message router ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "force_sync") {
    syncFromBackend().then(() => sendResponse({ success: true })).catch(() => sendResponse({ success: false }));
    return true;
  }

  if (message.action === "set_session") {
    chrome.storage.local.set({ sessionId: message.sessionId });
    // SSE will auto-reconnect via storage.onChanged listener
    sendResponse({ success: true });
    return true;
  }

  if (message.action === "fill_complete") {
    chrome.runtime.sendMessage(message).catch(() => {});
    return true;
  }

  // Results from auto-fill (fill_only mode) — forward to popup
  if (message.action === "fill_only_complete") {
    chrome.runtime.sendMessage(message).catch(() => {});
    return true;
  }

  // Results from submit_approved — forward to popup
  if (message.action === "submit_approved_complete") {
    chrome.runtime.sendMessage(message).catch(() => {});
    return true;
  }

  if (message.action === "store_resume") {
    chrome.storage.local.set({
      resumeBlob: message.data,
      resumeFileName: message.fileName,
      resumeType: message.type,
    });
    sendResponse({ success: true });
    return true;
  }

  if (message.action === "reconnect_sse") {
    connectSSE();
    sendResponse({ success: true });
    return true;
  }

  // Inject content script into any tab on demand (for non-ATS career pages)
  if (message.action === "inject_and_fill") {
    (async () => {
      const tabId = message.tabId;
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
        await chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] });
        // Wait for script to initialize
        await new Promise(r => setTimeout(r, 500));

        const result = await chrome.tabs.sendMessage(tabId, {
          action: "fill_application",
          pack: message.pack,
          profile: message.profile,
          ats: message.ats || "Generic",
        });
        sendResponse(result);
      } catch (err) {
        sendResponse({ error: "Injection failed: " + (err.message || String(err)) });
      }
    })();
    return true;
  }
});

// ─── Tab monitoring ─────────────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;

  const ats = detectATS(tab.url);
  if (ats) {
    chrome.action.setBadgeText({ text: "!", tabId });
    chrome.action.setBadgeBackgroundColor({ color: "#818cf8", tabId });
  } else {
    chrome.action.setBadgeText({ text: "", tabId });
  }
});

function detectATS(url) {
  if (!url) return null;
  if (/boards\.greenhouse\.io|jobs\.greenhouse\.io/i.test(url)) return "Greenhouse";
  if (/jobs\.lever\.co/i.test(url)) return "Lever";
  if (/myworkdayjobs\.com|myworkday\.com/i.test(url)) return "Workday";
  if (/linkedin\.com\/jobs/i.test(url)) return "LinkedIn";
  if (/indeed\.com\/viewjob/i.test(url)) return "Indeed";
  if (/apply\.workable\.com/i.test(url)) return "Workable";
  if (/smartrecruiters\.com/i.test(url)) return "SmartRecruiters";
  if (/bamboohr\.com/i.test(url)) return "BambooHR";
  return null;
}
