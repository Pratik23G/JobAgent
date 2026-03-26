// background.js — Service worker for JobAgent extension
// Handles: SSE real-time stream, auto-sync fallback, tab monitoring, auto-apply pipeline

const DEFAULT_URL = "http://localhost:3000";

// ─── Auto-Apply Queue ────────────────────────────────────────────────────────

const autoApplyQueue = []; // Jobs waiting to be processed
let autoApplyRunning = false;
const autoApplyResults = []; // Track results for reporting

// Process auto-apply queue sequentially
async function processAutoApplyQueue() {
  if (autoApplyRunning || autoApplyQueue.length === 0) return;
  autoApplyRunning = true;

  // Update badge to show queue status
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.id) {
    chrome.action.setBadgeText({ text: `${autoApplyQueue.length}`, tabId: activeTab.id });
    chrome.action.setBadgeBackgroundColor({ color: "#f59e0b", tabId: activeTab.id });
  }

  while (autoApplyQueue.length > 0) {
    const item = autoApplyQueue.shift();
    const { job, pack, profile, mode } = item;
    const jobResult = { company: job.company, title: job.title, url: job.url, status: "pending", fieldsFilledCount: 0, resumeUploaded: false, submitted: false, error: null };

    try {
      console.log(`[JobAgent] Auto-apply: navigating to ${job.company} - ${job.title}`);

      // Step 1: Open the job URL in a new tab
      const tab = await chrome.tabs.create({ url: job.url, active: false });
      const tabId = tab.id;

      // Step 2: Wait for page to load completely
      await waitForTabLoad(tabId, 15000);

      // Step 3: Look for an "Apply" button and click it
      const applyResult = await injectAndFindApplyButton(tabId);

      if (applyResult.clicked) {
        // Wait for form to load after clicking apply
        await new Promise(r => setTimeout(r, 3000));

        // Check if we navigated to a new page (external ATS)
        const updatedTab = await chrome.tabs.get(tabId);
        if (updatedTab.url !== job.url) {
          // Wait for the new page to load
          await waitForTabLoad(tabId, 15000);
          await new Promise(r => setTimeout(r, 2000));
        }
      } else if (applyResult.isFormPage) {
        // Already on a form page, proceed directly
        console.log(`[JobAgent] Already on form page for ${job.company}`);
      } else {
        // No apply button and not a form page — skip
        jobResult.status = "no_apply_button";
        jobResult.error = "Could not find apply button or application form";
        autoApplyResults.push(jobResult);
        await chrome.tabs.remove(tabId).catch(() => {});
        // Delay between jobs
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      // Step 4: Inject content script and fill the form
      const fillResult = await injectAndFillForm(tabId, pack, profile);
      jobResult.fieldsFilledCount = fillResult.filledCount || 0;
      jobResult.resumeUploaded = fillResult.resumeUploaded || false;

      if (mode === "auto") {
        // Auto mode: wait briefly, then submit
        await new Promise(r => setTimeout(r, 1500));

        const submitResult = await sendToContentScript(tabId, {
          action: "submit_application",
          pack,
          filledCount: jobResult.fieldsFilledCount,
          resumeUploaded: jobResult.resumeUploaded,
        });

        jobResult.submitted = submitResult?.submitted || false;
        jobResult.status = submitResult?.submitted ? "applied" : "submit_failed";

        if (submitResult?.submitted) {
          // Report to backend
          await reportAutoApplyResult(job, pack, jobResult);
        }

        // Close tab after submit (wait for confirmation page)
        await new Promise(r => setTimeout(r, 3000));
        await chrome.tabs.remove(tabId).catch(() => {});
      } else {
        // Review mode: fill form but DON'T submit. Show review panel.
        jobResult.status = "review_pending";

        await sendToContentScript(tabId, {
          action: "show_review_panel",
          pack,
          job,
          filledCount: jobResult.fieldsFilledCount,
          resumeUploaded: jobResult.resumeUploaded,
          queueRemaining: autoApplyQueue.length,
        });

        // Bring the tab to focus so user can review
        await chrome.tabs.update(tabId, { active: true });

        // Wait for user to submit or skip (via message from content script)
        const userAction = await waitForUserAction(tabId, 120000); // 2 min timeout
        if (userAction === "submitted") {
          jobResult.submitted = true;
          jobResult.status = "applied";
          await reportAutoApplyResult(job, pack, jobResult);
          await new Promise(r => setTimeout(r, 2000));
          await chrome.tabs.remove(tabId).catch(() => {});
        } else if (userAction === "skipped") {
          jobResult.status = "skipped_by_user";
          await chrome.tabs.remove(tabId).catch(() => {});
        } else {
          // Timeout — leave tab open for manual review
          jobResult.status = "review_timeout";
        }
      }
    } catch (err) {
      console.error(`[JobAgent] Auto-apply error for ${job.company}:`, err);
      jobResult.status = "error";
      jobResult.error = err.message || String(err);
    }

    autoApplyResults.push(jobResult);

    // Update badge with remaining count
    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (currentTab?.id) {
      const remaining = autoApplyQueue.length;
      chrome.action.setBadgeText({ text: remaining > 0 ? `${remaining}` : "", tabId: currentTab.id });
    }

    // Delay between jobs to avoid rate-limiting
    if (autoApplyQueue.length > 0) {
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  autoApplyRunning = false;

  // Notify popup/content that pipeline is complete
  chrome.runtime.sendMessage({
    action: "auto_apply_complete",
    results: autoApplyResults,
    summary: {
      total: autoApplyResults.length,
      applied: autoApplyResults.filter(r => r.status === "applied").length,
      review_pending: autoApplyResults.filter(r => r.status === "review_pending" || r.status === "review_timeout").length,
      skipped: autoApplyResults.filter(r => r.status === "skipped_duplicate" || r.status === "skipped_by_user").length,
      failed: autoApplyResults.filter(r => r.status === "error" || r.status === "no_apply_button" || r.status === "submit_failed").length,
    },
  }).catch(() => {});

  // Clear badge
  const [finalTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (finalTab?.id) {
    chrome.action.setBadgeText({ text: "", tabId: finalTab.id });
  }
}

// Wait for a tab to finish loading
function waitForTabLoad(tabId, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(); // Resolve even on timeout — the page may be usable
    }, timeout);

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

// Inject content script and find/click the Apply button
async function injectAndFindApplyButton(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  } catch {
    // May already be injected
  }

  await new Promise(r => setTimeout(r, 1000));

  try {
    const result = await chrome.tabs.sendMessage(tabId, { action: "find_apply_button" });
    return result || { clicked: false, isFormPage: false };
  } catch {
    return { clicked: false, isFormPage: false };
  }
}

// Inject content script and fill the form
async function injectAndFillForm(tabId, pack, profile) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  } catch {
    // May already be injected
  }

  await new Promise(r => setTimeout(r, 500));

  try {
    const result = await chrome.tabs.sendMessage(tabId, {
      action: "fill_application",
      pack,
      profile,
      ats: null, // Auto-detect
    });
    return result || { filledCount: 0, resumeUploaded: false };
  } catch (err) {
    console.warn("[JobAgent] Fill form failed:", err);
    return { filledCount: 0, resumeUploaded: false };
  }
}

// Send message to content script
async function sendToContentScript(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    return null;
  }
}

// Wait for user to submit or skip from the review panel
function waitForUserAction(tabId, timeout = 120000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      resolve("timeout");
    }, timeout);

    const listener = (message, sender) => {
      const senderTabId = sender.tab?.id || message.tabId;
      if (message.action === "review_submitted" && senderTabId === tabId) {
        clearTimeout(timer);
        chrome.runtime.onMessage.removeListener(listener);
        chrome.tabs.onRemoved.removeListener(onRemoved);
        resolve("submitted");
      } else if (message.action === "review_skipped" && senderTabId === tabId) {
        clearTimeout(timer);
        chrome.runtime.onMessage.removeListener(listener);
        chrome.tabs.onRemoved.removeListener(onRemoved);
        resolve("skipped");
      }
    };

    const onRemoved = (removedTabId) => {
      if (removedTabId === tabId) {
        clearTimeout(timer);
        chrome.runtime.onMessage.removeListener(listener);
        chrome.tabs.onRemoved.removeListener(onRemoved);
        resolve("skipped");
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
}

// Report auto-apply result to backend
async function reportAutoApplyResult(job, pack, result) {
  try {
    const serverUrl = await getServerUrl();
    const sessionId = await getSessionId();

    await fetch(`${serverUrl}/api/extension/confirm-submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company: job.company,
        jobTitle: job.title,
        jobUrl: job.url,
        sessionId: sessionId || "",
        fieldsFilledCount: result.fieldsFilledCount,
        resumeUploaded: result.resumeUploaded,
        autoApply: true,
      }),
    });
  } catch (err) {
    console.warn("[JobAgent] Failed to report auto-apply result:", err);
  }
}

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
          count: packs.length,
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

      case "auto_apply": {
        // Agent wants the extension to auto-navigate and fill/submit jobs
        console.log("[JobAgent] Auto-apply event received:", data.job?.company);

        // Get profile from storage
        const stored = await chrome.storage.local.get(["userProfile"]);
        const profile = stored.userProfile || {};

        // Add to queue
        autoApplyQueue.push({
          job: data.job,
          pack: data.pack,
          profile,
          mode: data.mode || "review",
        });

        // Start processing if not already running
        processAutoApplyQueue();
        break;
      }

      case "connected":
        console.log("[JobAgent] SSE stream confirmed for session:", data.sessionId);
        break;

      default:
        console.log("[JobAgent] Unknown SSE event:", event, data);
    }
  } catch (err) {
    console.warn("[JobAgent] SSE event parse error:", err);
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

  // Review panel actions from content script
  if (message.action === "review_submitted" || message.action === "review_skipped") {
    // Attach the sender's tab ID so waitForUserAction can match it
    message.tabId = sender.tab?.id;
    // The listener added by waitForUserAction will pick this up
    return true;
  }

  // Get auto-apply queue status
  if (message.action === "get_auto_apply_status") {
    sendResponse({
      running: autoApplyRunning,
      queueLength: autoApplyQueue.length,
      results: autoApplyResults,
    });
    return true;
  }

  // Cancel auto-apply pipeline
  if (message.action === "cancel_auto_apply") {
    autoApplyQueue.length = 0; // Clear queue
    sendResponse({ success: true, message: "Auto-apply queue cleared" });
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
  } else if (!autoApplyRunning) {
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
  if (/ashbyhq\.com/i.test(url)) return "Ashby";
  return null;
}
