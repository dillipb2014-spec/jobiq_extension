// ─── JobIQ AI — Background Service Worker ───────────────────────────────────

// Default config — pre-loaded on first install
const DEFAULTS = {
  geminiApiKey: "AIzaSyC8n0AmvdVjZ7N0PNlVDY1f0SJV9WLyog8",
  minMatch: 50,
  candidateProfile: {
    name: "Dillip Kumar Behera",
    email: "dillipb2014@gmail.com",
    phone: "7750978982",
    experience: "4",
    currentSalary: "900000",
    expectedSalary: "1200000",
    noticePeriod: "30",
  },
  resumeText: `Dillip Kumar Behera | Talent Acquisition | People Operations Specialist
Location: Bangalore, India
SUMMARY: 4.6 years experience in end-to-end recruitment across Engineering, Design, InfoSec, Finance.
SKILLS: Power BI, ATS, Boolean Search, Stakeholder Management, Offer Negotiation, Campus Hiring, BGV, Compliance, Workflow Automation, Recruitment Analytics.
EXPERIENCE:
- JUSPAY: Talent Acquisition & HR Operations Specialist (Jan 2024-Present). Full-cycle hiring, Power BI dashboards, AI sourcing tools.
- INFOSYS: Senior HR Process Executive (Jun 2022-Dec 2023). Recruitment operations, analytics reports, onboarding compliance.
- TECH MAHINDRA: Process Executive (Aug 2021-Jun 2022). HR operations, interview scheduling, ATS management.
EDUCATION: MBA in HRM (2023-2025) | B.Tech (2019)`
};

// Load defaults on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["geminiApiKey"], (r) => {
    if (!r.geminiApiKey) {
      chrome.storage.local.set(DEFAULTS);
    }
  });
});
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
      const resume = data.resumeText || DEFAULTS.resumeText;
      const apiKey = data.geminiApiKey || DEFAULTS.geminiApiKey;

      getTabId((tid) => {
        const finalApiKey = data.geminiApiKey || DEFAULTS.geminiApiKey;
        const finalResume = data.resumeText || DEFAULTS.resumeText;

        // Logging
        console.log("[JobIQ] JD Length:", msg.jd?.length);
        console.log("[JobIQ] Using API Key:", !!finalApiKey);
        console.log("[JobIQ] Resume Length:", finalResume.length);

        const prompt = `You are an expert ATS (Applicant Tracking System) and career coach AI.

Analyze the resume against the job description and return a STRICT JSON response.

Rules:
- "match" must be an integer 0-100 based on skills overlap, experience relevance, and role alignment
- "missing_keywords" = important keywords in JD that are NOT in resume (max 8)
- "strong_keywords" = keywords present in BOTH resume and JD (max 8)
- "improve_suggestions" = specific keywords/phrases candidate should ADD to their resume to improve match
- "suggestions" = 2-3 sentence actionable advice on how to tailor the resume for this specific role
- "cover_letter" = 3 paragraph personalized cover letter addressing the specific JD requirements

Return ONLY this JSON, no extra text:
{
  "match": 72,
  "missing_keywords": ["keyword1", "keyword2"],
  "strong_keywords": ["keyword3", "keyword4"],
  "improve_suggestions": ["Add: keyword1 in your skills section", "Mention: keyword2 in your experience"],
  "suggestions": "Actionable advice here.",
  "cover_letter": "Para 1...\n\nPara 2...\n\nPara 3..."
}

RESUME:
${finalResume.slice(0, 2000)}

JOB DESCRIPTION:
${msg.jd.slice(0, 2000)}`;

        fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${finalApiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
          }
        ).then(r => r.json()).then(raw => {
          const text = raw.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
          const clean = text.replace(/```json|```/g, "").trim();

          // Safe JSON parse with fallback
          let parsed;
          try {
            parsed = JSON.parse(clean);
          } catch (e) {
            console.error("[JobIQ] Invalid JSON from Gemini:", clean);
            parsed = {
              match: 0,
              missing_keywords: [],
              strong_keywords: [],
              suggestions: clean,
              cover_letter: ""
            };
          }

          console.log("[JobIQ] Result:", parsed);
          chrome.storage.local.set({ lastAnalysis: parsed, lastJD: msg.jd });
          if (tid) chrome.tabs.sendMessage(tid, { type: "SHOW_RESULT", data: parsed });
          chrome.runtime.sendMessage({ type: "SHOW_RESULT", data: parsed });
        }).catch(e => {
          console.error("[JobIQ] Fetch error:", e.message);
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
