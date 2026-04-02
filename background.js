// ─── JobIQ AI — Background Service Worker ───────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // ── Mode 1: Smart Match Analysis ──────────────────────────────────────────
  if (msg.type === "GET_ANALYSIS") {
    chrome.storage.local.get(["resumeText", "geminiApiKey"], async (data) => {
      const resume = data.resumeText || "";
      const apiKey = data.geminiApiKey || "";

      if (!resume) {
        chrome.runtime.sendMessage({ type: "ANALYSIS_ERROR", error: "No resume uploaded. Please upload your resume first." });
        return;
      }
      if (!apiKey) {
        chrome.runtime.sendMessage({ type: "ANALYSIS_ERROR", error: "No API key set. Please add your Gemini API key in settings." });
        return;
      }

      try {
        const prompt = `You are a career coach AI. Analyze this resume against the job description.

Return ONLY valid JSON in this exact format:
{
  "match": 75,
  "missing_keywords": ["keyword1", "keyword2"],
  "strong_keywords": ["keyword3", "keyword4"],
  "suggestions": "2-3 sentence actionable advice",
  "cover_letter": "3 paragraph personalized cover letter"
}

RESUME:
${resume.slice(0, 1500)}

JOB DESCRIPTION:
${msg.jd.slice(0, 1500)}`;

        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
          }
        );

        const raw = await res.json();
        const text = raw.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
        const clean = text.replace(/```json|```/g, "").trim();
        const result = JSON.parse(clean);

        // Save last analysis
        chrome.storage.local.set({ lastAnalysis: result, lastJD: msg.jd });
        chrome.runtime.sendMessage({ type: "SHOW_RESULT", data: result });

      } catch (e) {
        chrome.runtime.sendMessage({ type: "ANALYSIS_ERROR", error: "AI analysis failed. Check your API key." });
      }
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
