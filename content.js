// JobIQ AI - Content Script

const sleep = ms => new Promise(r => setTimeout(r, ms));
let lastUrl = location.href;
let currentJD = "";
let currentTitle = "";
let currentCompany = "";

// Robust JD Detection with retry
function getJobDescription() {
  const selectors = [
    ".jobs-description-content__text",
    ".jobs-box__html-content",
    "#job-details",
    ".show-more-less-html__markup",
    ".jobs-description__content"
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.innerText.length > 100) return el.innerText;
  }
  return null;
}

async function waitForJD() {
  for (let i = 0; i < 10; i++) {
    const jd = getJobDescription();
    if (jd) return jd;
    await sleep(1000);
  }
  return null;
}

// Inject floating panel
function injectJobIQPanel() {
  if (document.getElementById("jobiq-panel")) return;

  const panel = document.createElement("div");
  panel.id = "jobiq-panel";
  panel.innerHTML = `
    <div id="jobiq-box" style="
      position:fixed; top:100px; right:20px; width:290px;
      background:linear-gradient(135deg,#0f172a,#1e293b);
      color:#e2e8f0; padding:14px; border-radius:14px;
      z-index:99999; box-shadow:0 8px 32px rgba(0,0,0,0.6);
      border:1px solid #334155;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      cursor:move; user-select:none;
    ">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:16px;">&#x1F9E0;</span>
          <span style="font-weight:800;font-size:14px;color:#818cf8;">JobIQ AI</span>
        </div>
        <button id="jobiq-close" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:16px;">&#x2715;</button>
      </div>

      <!-- Job Info -->
      <div id="jobiq-job-info" style="font-size:11px;color:#94a3b8;margin-bottom:10px;padding:6px 8px;background:#0f172a;border-radius:8px;display:none;">
        <div id="jobiq-job-title" style="font-weight:700;color:#e2e8f0;"></div>
        <div id="jobiq-job-company" style="margin-top:2px;"></div>
      </div>

      <!-- Match Score -->
      <div id="jobiq-score-section" style="margin-bottom:10px;display:none;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-size:11px;color:#94a3b8;font-weight:600;">MATCH SCORE</span>
          <span id="jobiq-score-num" style="font-size:22px;font-weight:800;color:#34d399;">0%</span>
        </div>
        <div style="background:#334155;border-radius:99px;height:8px;overflow:hidden;">
          <div id="jobiq-progress" style="height:100%;width:0%;border-radius:99px;background:linear-gradient(90deg,#10b981,#34d399);transition:width 0.8s ease;"></div>
        </div>
      </div>

      <!-- Strong Keywords -->
      <div id="jobiq-strong-section" style="margin-bottom:8px;display:none;">
        <div style="font-size:10px;color:#94a3b8;margin-bottom:4px;font-weight:600;">&#x2705; STRONG KEYWORDS</div>
        <div id="jobiq-strong-tags" style="display:flex;flex-wrap:wrap;gap:3px;"></div>
      </div>

      <!-- Missing Keywords -->
      <div id="jobiq-missing-section" style="margin-bottom:8px;display:none;">
        <div style="font-size:10px;color:#94a3b8;margin-bottom:4px;font-weight:600;">&#x274C; MISSING KEYWORDS</div>
        <div id="jobiq-missing-tags" style="display:flex;flex-wrap:wrap;gap:3px;"></div>
      </div>

      <!-- How to Improve -->
      <div id="jobiq-improve-section" style="margin-bottom:8px;display:none;">
        <div style="font-size:10px;color:#94a3b8;margin-bottom:4px;font-weight:600;">&#x1F4A1; HOW TO IMPROVE</div>
        <div id="jobiq-improve-list" style="font-size:10px;color:#fbbf24;line-height:1.8;background:#1c1a0a;padding:6px 8px;border-radius:6px;border:1px solid #78350f;"></div>
      </div>

      <!-- Suggestion -->
      <div id="jobiq-suggestion" style="font-size:10px;color:#93c5fd;background:#1e3a5f;border:1px solid #1d4ed8;border-radius:8px;padding:8px;margin-bottom:10px;line-height:1.6;display:none;"></div>

      <!-- Status -->
      <div id="jobiq-status" style="font-size:11px;padding:6px 8px;border-radius:8px;margin-bottom:8px;background:#1e293b;color:#94a3b8;border:1px solid #334155;">
        Open a LinkedIn job to begin.
      </div>

      <!-- Resume Upload -->
      <label id="jobiq-resume-label" style="display:block;font-size:10px;color:#818cf8;background:#1e293b;border:1px dashed #4f46e5;border-radius:8px;padding:6px 10px;margin-bottom:8px;cursor:pointer;text-align:center;">
        &#x1F4C4; Upload Resume (.txt)
        <input type="file" id="jobiq-resume" accept=".txt" style="display:none">
      </label>

      <!-- Buttons -->
      <div style="display:flex;gap:6px;">
        <button id="jobiq-analyze" style="flex:1;padding:8px;border:none;border-radius:8px;cursor:pointer;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;font-size:11px;font-weight:700;">
          &#x1F9E0; Analyze
        </button>
        <button id="jobiq-apply" disabled style="flex:1;padding:8px;border:none;border-radius:8px;cursor:pointer;background:#374151;color:#6b7280;font-size:11px;font-weight:700;">
          &#x1F916; Apply
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(panel);
  makeDraggable(document.getElementById("jobiq-box"));

  document.getElementById("jobiq-close").addEventListener("click", () => panel.remove());

  document.getElementById("jobiq-resume").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    chrome.storage.local.set({ resumeText: text });
    setStatus("Resume uploaded!", "#34d399");
    document.getElementById("jobiq-resume-label").textContent = "Resume: " + file.name;
  });

  document.getElementById("jobiq-analyze").addEventListener("click", async () => {
    setStatus("Detecting job description...", "#94a3b8");
    const jd = await waitForJD();
    if (!jd) {
      setStatus("No job detected. Click a job card first.", "#f87171");
      return;
    }
    currentJD = jd;
    setStatus("Analyzing with AI...", "#94a3b8");

    // Call Gemini directly from content script
    try {
      const stored = await new Promise(resolve => chrome.storage.local.get(["geminiApiKey", "resumeText"], resolve));
      const apiKey = stored.geminiApiKey || "AIzaSyC8n0AmvdVjZ7N0PNlVDY1f0SJV9WLyog8";
      const resume = stored.resumeText || "Dillip Kumar Behera | Talent Acquisition | 4.6 years | Power BI, ATS, Boolean Search, Stakeholder Management, Recruitment Analytics | Juspay, Infosys, Tech Mahindra";

      const prompt = `You are an ATS expert. Analyze resume vs job description.
Return ONLY valid JSON:
{"match":75,"missing_keywords":["kw1"],"strong_keywords":["kw2"],"improve_suggestions":["Add kw1 to skills"],"suggestions":"advice here","cover_letter":"para1\n\npara2\n\npara3"}

RESUME: ${resume.slice(0, 1500)}
JOB: ${jd.slice(0, 1500)}`;

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
      let result;
      try { result = JSON.parse(clean); }
      catch (e) { result = { match: 0, missing_keywords: [], strong_keywords: [], improve_suggestions: [], suggestions: clean, cover_letter: "" }; }

      chrome.storage.local.set({ lastAnalysis: result });
      showResultInPanel(result);
    } catch (e) {
      setStatus("AI error: " + e.message, "#f87171");
    }
  });

  document.getElementById("jobiq-apply").addEventListener("click", async () => {
    setStatus("Starting Easy Apply...", "#93c5fd");
    await runEasyApply();
  });
}

// Drag support
function makeDraggable(el) {
  let ox = 0, oy = 0, mx = 0, my = 0;
  el.addEventListener("mousedown", (e) => {
    if (e.target.tagName === "BUTTON" || e.target.tagName === "INPUT" || e.target.tagName === "LABEL") return;
    e.preventDefault();
    ox = e.clientX; oy = e.clientY;
    document.addEventListener("mousemove", drag);
    document.addEventListener("mouseup", stopDrag);
  });
  function drag(e) {
    mx = ox - e.clientX; my = oy - e.clientY;
    ox = e.clientX; oy = e.clientY;
    el.style.top = (el.offsetTop - my) + "px";
    el.style.right = "auto";
    el.style.left = (el.offsetLeft - mx) + "px";
  }
  function stopDrag() {
    document.removeEventListener("mousemove", drag);
    document.removeEventListener("mouseup", stopDrag);
  }
}

function setStatus(msg, color) {
  const el = document.getElementById("jobiq-status");
  if (el) { el.textContent = msg; el.style.color = color || "#94a3b8"; }
}

// Extract JD and update panel
function extractAndSendJD() {
  const titleEl = document.querySelector("h1.job-details-jobs-unified-top-card__job-title, h1.t-24");
  const companyEl = document.querySelector(".job-details-jobs-unified-top-card__company-name a, .jobs-unified-top-card__company-name a");

  currentTitle = titleEl?.innerText?.trim() || "";
  currentCompany = companyEl?.innerText?.trim() || "";

  if (currentTitle) {
    const infoEl = document.getElementById("jobiq-job-info");
    if (infoEl) {
      infoEl.style.display = "block";
      document.getElementById("jobiq-job-title").textContent = currentTitle;
      document.getElementById("jobiq-job-company").textContent = currentCompany;
    }
    setStatus(currentTitle + " detected. Click Analyze.", "#34d399");
  }
}

// Show analysis result in panel
function showResultInPanel(data) {
  const match = data.match || 0;

  // Score + progress bar
  const scoreEl = document.getElementById("jobiq-score-num");
  const progressEl = document.getElementById("jobiq-progress");
  const scoreSection = document.getElementById("jobiq-score-section");
  if (scoreEl) {
    scoreEl.textContent = match + "%";
    scoreEl.style.color = match >= 70 ? "#34d399" : match >= 50 ? "#fbbf24" : "#f87171";
    progressEl.style.width = match + "%";
    progressEl.style.background = match >= 70
      ? "linear-gradient(90deg,#10b981,#34d399)"
      : match >= 50
      ? "linear-gradient(90deg,#f59e0b,#fbbf24)"
      : "linear-gradient(90deg,#ef4444,#f87171)";
    scoreSection.style.display = "block";
  }

  // Strong keywords (green)
  const strongSection = document.getElementById("jobiq-strong-section");
  const strongTags = document.getElementById("jobiq-strong-tags");
  if (strongSection && data.strong_keywords && data.strong_keywords.length) {
    strongTags.innerHTML = data.strong_keywords.map(k =>
      '<span style="font-size:10px;padding:2px 7px;border-radius:99px;background:#064e3b;color:#34d399;border:1px solid #065f46;">' + k + '</span>'
    ).join("");
    strongSection.style.display = "block";
  }

  // Missing keywords (red)
  const missingSection = document.getElementById("jobiq-missing-section");
  const missingTags = document.getElementById("jobiq-missing-tags");
  if (missingSection && data.missing_keywords && data.missing_keywords.length) {
    missingTags.innerHTML = data.missing_keywords.map(k =>
      '<span style="font-size:10px;padding:2px 7px;border-radius:99px;background:#450a0a;color:#f87171;border:1px solid #7f1d1d;">' + k + '</span>'
    ).join("");
    missingSection.style.display = "block";
  }

  // How to improve (yellow bullets)
  const improveSection = document.getElementById("jobiq-improve-section");
  const improveList = document.getElementById("jobiq-improve-list");
  if (improveSection && data.improve_suggestions && data.improve_suggestions.length) {
    improveList.innerHTML = data.improve_suggestions.map(s => "<div>• " + s + "</div>").join("");
    improveSection.style.display = "block";
  }

  // AI suggestion
  const suggEl = document.getElementById("jobiq-suggestion");
  if (suggEl && data.suggestions) {
    suggEl.textContent = "Tip: " + data.suggestions;
    suggEl.style.display = "block";
  }

  // Check if Easy Apply button exists on this job
  const hasEasyApply = [...document.querySelectorAll("button.jobs-apply-button")]
    .some(b => (b.getAttribute("aria-label") || "").toLowerCase().includes("easy apply") && b.offsetParent);

  // Enable/disable apply button
  const applyBtn = document.getElementById("jobiq-apply");
  if (applyBtn) {
    chrome.storage.local.get(["minMatch"], (r) => {
      const min = r.minMatch || 50;
      if (match >= min && hasEasyApply) {
        applyBtn.disabled = false;
        applyBtn.style.background = "linear-gradient(135deg,#10b981,#059669)";
        applyBtn.style.color = "white";
        applyBtn.textContent = "Easy Apply";
        setStatus(match + "% match - Easy Apply ready!", "#34d399");
      } else if (match >= min && !hasEasyApply) {
        applyBtn.disabled = true;
        applyBtn.style.background = "#374151";
        applyBtn.style.color = "#6b7280";
        applyBtn.textContent = "External Apply";
        setStatus(match + "% match - No Easy Apply on this job.", "#fbbf24");
      } else {
        applyBtn.disabled = true;
        applyBtn.style.background = "#374151";
        applyBtn.style.color = "#6b7280";
        applyBtn.textContent = "Apply";
        setStatus(match + "% - below minimum " + min + "%. Improve resume.", "#fbbf24");
      }
    });
  }
}

// Listen for messages from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "SHOW_RESULT") showResultInPanel(msg.data);
  if (msg.type === "ANALYSIS_ERROR") setStatus(msg.error, "#f87171");
  if (msg.type === "APPLY_STATUS") {
    const colors = { started: "#93c5fd", progress: "#93c5fd", success: "#34d399", error: "#f87171", no_button: "#f87171" };
    setStatus(msg.msg, colors[msg.status] || "#94a3b8");
  }
});

window.addEventListener("message", async (e) => {
  if (e.data && e.data.type === "JOBIQ_START_APPLY") await runEasyApply();
});

// Easy Apply Automation
async function runEasyApply() {
  const applyBtn = [...document.querySelectorAll("button.jobs-apply-button")]
    .find(b => (b.getAttribute("aria-label") || "").toLowerCase().includes("easy apply") && b.offsetParent);

  if (!applyBtn) {
    setStatus("No Easy Apply button found on this job.", "#f87171");
    return;
  }

  applyBtn.click();
  await sleep(2500);

  const modal = document.querySelector("div.jobs-easy-apply-modal");
  if (!modal) {
    setStatus("Modal did not open.", "#f87171");
    return;
  }

  for (let step = 0; step < 10; step++) {
    await sleep(1500);
    modal.scrollTop = 99999;
    await sleep(800);
    fillFormFields(modal);
    await sleep(800);

    const submitBtn = getModalBtn(modal, ["Submit application", "Submit"]);
    if (submitBtn) {
      submitBtn.scrollIntoView();
      await sleep(500);
      submitBtn.click();
      await sleep(2000);
      const title = document.querySelector("h1") ? document.querySelector("h1").innerText.trim() : currentTitle;
      chrome.runtime.sendMessage({ type: "JOB_APPLIED", title, company: currentCompany, match: 0, status: "Applied" });
      setStatus("Applied to " + title + " @ " + currentCompany, "#34d399");
      const dismiss = document.querySelector("button[aria-label='Dismiss']");
      if (dismiss) dismiss.click();
      return;
    }

    const nextBtn = getModalBtn(modal, ["Continue to next step", "Review your application", "Next", "Continue", "Review"]);
    if (nextBtn) {
      setStatus("Step " + (step + 1) + " - " + nextBtn.textContent.trim(), "#93c5fd");
      nextBtn.click();
    } else {
      setStatus("Could not find Next/Submit button.", "#f87171");
      break;
    }
  }
}

function getModalBtn(modal, keywords) {
  for (const btn of modal.querySelectorAll("button")) {
    const label = (btn.getAttribute("aria-label") || "").toLowerCase();
    const text = btn.textContent.toLowerCase();
    if (keywords.some(k => label.includes(k.toLowerCase()) || text.includes(k.toLowerCase()))) return btn;
  }
  return null;
}

function fillFormFields(modal) {
  const DEFAULT_PROFILE = {
    phone: "7750978982", name: "Dillip Kumar Behera",
    email: "dillipb2014@gmail.com", experience: "4",
    currentSalary: "900000", expectedSalary: "1200000", noticePeriod: "30"
  };
  chrome.storage.local.get(["candidateProfile"], (data) => {
    const p = Object.assign({}, DEFAULT_PROFILE, data.candidateProfile || {});
    const fieldMap = {
      "phone": p.phone, "mobile": p.phone,
      "city": "Bangalore", "location": "Bangalore",
      "years of experience": p.experience, "experience": p.experience,
      "current salary": p.currentSalary, "current ctc": p.currentSalary,
      "expected": p.expectedSalary, "notice": p.noticePeriod,
      "name": p.name, "full name": p.name, "email": p.email,
    };
    modal.querySelectorAll("input[type='text'], input[type='tel'], input[type='number']").forEach(inp => {
      const id = inp.getAttribute("id") || "";
      const labelEl = modal.querySelector("label[for='" + id + "']");
      const label = (labelEl ? labelEl.textContent : "").toLowerCase();
      const placeholder = (inp.getAttribute("placeholder") || "").toLowerCase();
      const combined = label + " " + placeholder;
      for (const [key, val] of Object.entries(fieldMap)) {
        if (combined.includes(key) && val && !inp.value.trim()) {
          inp.value = val;
          inp.dispatchEvent(new Event("input", { bubbles: true }));
          inp.dispatchEvent(new Event("change", { bubbles: true }));
          break;
        }
      }
    });
    const groups = {};
    modal.querySelectorAll("input[type='radio']").forEach(r => { if (!groups[r.name]) groups[r.name] = r; });
    Object.values(groups).forEach(r => { if (!r.checked) r.click(); });
  });
}

// SPA URL polling
setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    if (location.href.includes("/jobs/")) {
      setTimeout(() => { injectJobIQPanel(); extractAndSendJD(); }, 2000);
    }
  }
}, 1000);

// Initial load
window.addEventListener("load", () => {
  setTimeout(() => { injectJobIQPanel(); extractAndSendJD(); }, 3000);
});
setTimeout(() => { injectJobIQPanel(); extractAndSendJD(); }, 3000);
