// ─── JobIQ AI — Background Service Worker ───────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // ── Mode 1: Smart Match Analysis ──────────────────────────────────────────
  if (msg.type === "GET_ANALYSIS") {
    const tabId = sender.tab?.id;

    // If called from popup, get the active tab id
    const getTabId = (callback) => {
      if (tabId) { callback(tabId); return; }
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        callback(tabs[0]?.id);
      });
    };

    chrome.storage.local.get(["resumeText", "geminiApiKey"], async (data) => {
      const resume = data.resumeText || "";
      const apiKey = data.geminiApiKey || "";

      getTabId((tid) => {
        if (!resume) {
          if (tid) chrome.tabs.sendMessage(tid, { type: "ANALYSIS_ERROR", error: "No resume uploaded. Please upload your resume first." });
          chrome.runtime.sendMessage({ type: "ANALYSIS_ERROR", error: "No resume uploaded." });
          return;
        }
        if (!apiKey) {
          if (tid) chrome.tabs.sendMessage(tid, { type: "ANALYSIS_ERROR", error: "No API key. Go to extension popup → ⚙️ Settings and save your Gemini API key." });
          chrome.runtime.sendMessage({ type: "ANALYSIS_ERROR", error: "No API key set." });
          return;
        }

        const prompt = `You are a career coach AI. Analyze this resume against the job description.

Return ONLY valid JSON:
{
  "match": 75,
  "missing_keywords": ["keyword1"],
  "strong_keywords": ["keyword2"],
  "suggestions": "2-3 sentence advice",
  "cover_letter": "3 paragraph cover letter"
}

RESUME:
${resume.slice(0, 1500)}

JOB DESCRIPTION:
${msg.jd.slice(0, 1500)}`;

        fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
          }
        ).then(r => r.json()).then(raw => {
          const text = raw.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
          const clean = text.replace(/```json|```/g, "").trim();
          const result = JSON.parse(clean);
          chrome.storage.local.set({ lastAnalysis: result, lastJD: msg.jd });
          if (tid) chrome.tabs.sendMessage(tid, { type: "SHOW_RESULT", data: result });
          chrome.runtime.sendMessage({ type: "SHOW_RESULT", data: result });
        }).catch(e => {
          if (tid) chrome.tabs.sendMessage(tid, { type: "ANALYSIS_ERROR", error: `AI failed: ${e.message}` });
          chrome.runtime.sendMessage({ type: "ANALYSIS_ERROR", error: `AI failed: ${e.message}` });
        });
      });
    });
    return true;
  }

  // ── Mode 2: Easy Apply Automation ─────────────────────────────────────────
  if (msg.type === "START_APPLY") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: triggerEasyApply
        });
      }
    });
  }

  // ── Save applied job ───────────────────────────────────────────────────────
  if (msg.type === "JOB_APPLIED") {
    chrome.storage.local.get(["appliedJobs"], (r) => {
      const jobs = r.appliedJobs || [];
      jobs.unshift({
        date: new Date().toLocaleDateString("en-IN"),
        title: msg.title,
        company: msg.company,
        match: msg.match,
        status: msg.status
      });
      chrome.storage.local.set({ appliedJobs: jobs.slice(0, 100) });
    });
  }

  return true;
});

// Injected into page to trigger Easy Apply
function triggerEasyApply() {
  window.postMessage({ type: "JOBIQ_START_APPLY" }, "*");
}
