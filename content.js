// JobIQ AI - Content Script
console.log("[JobIQ] Loaded. Extension ID:", chrome.runtime?.id);

const sleep = ms => new Promise(r => setTimeout(r, ms));
let lastUrl = location.href;
let currentTitle = "";
let currentCompany = "";

// ── Extension health check ────────────────────────────────────────────────────
function isAlive() { return !!chrome.runtime?.id; }

// ── Safe JSON extractor ───────────────────────────────────────────────────────
function extractJSON(text) {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}") + 1;
    if (start === -1 || end === 0) throw new Error("No JSON");
    return JSON.parse(text.slice(start, end));
  } catch (e) {
    console.error("[JobIQ] JSON parse failed:", text.slice(0, 200));
    return null;
  }
}

// ── Resume text extraction — supports PDF, DOCX, DOC, TXT, RTF ─────────────
async function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function extractTextFromPDF(file) {
  await loadScript(chrome.runtime.getURL("pdf.min.js"));
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf.worker.min.js");
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(x => x.str).join(" ") + "\n";
  }
  return text.trim();
}

async function extractTextFromDOCX(file) {
  await loadScript(chrome.runtime.getURL("mammoth.min.js"));
  const buf = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  return result.value.trim();
}

async function extractResumeText(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return await extractTextFromPDF(file);
  if (name.endsWith(".docx")) return await extractTextFromDOCX(file);
  if (name.endsWith(".doc")) {
    // DOC fallback — read as text (older binary format, best effort)
    try { return await extractTextFromDOCX(file); }
    catch { return await file.text(); }
  }
  // TXT, RTF, any other text format
  return await file.text();
}

// ── Get full JD including About the Job section ───────────────────────────────
function getJobDescription() {
  const selectors = [
    ".jobs-description-content__text",
    ".jobs-box__html-content",
    "#job-details",
    ".show-more-less-html__markup",
    ".jobs-description__content",
    "[class*='description']"
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.innerText.trim().length > 100) return el.innerText.trim();
  }
  return null;
}

async function waitForJD() {
  for (let i = 0; i < 12; i++) {
    const jd = getJobDescription();
    if (jd) return jd;
    await sleep(1000);
  }
  return null;
}

// ── Inject floating panel ─────────────────────────────────────────────────────
function injectJobIQPanel() {
  if (document.getElementById("jobiq-panel")) return;

  const panel = document.createElement("div");
  panel.id = "jobiq-panel";
  panel.innerHTML = `
    <div id="jobiq-box" style="
      position:fixed;top:80px;right:20px;width:300px;
      background:linear-gradient(135deg,#0f172a,#1e293b);
      color:#e2e8f0;padding:14px;border-radius:14px;
      z-index:99999;box-shadow:0 8px 32px rgba(0,0,0,0.7);
      border:1px solid #334155;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      cursor:move;user-select:none;max-height:90vh;overflow-y:auto;
    ">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:18px;">&#x1F9E0;</span>
          <span style="font-weight:800;font-size:15px;color:#818cf8;">JobIQ AI</span>
        </div>
        <button id="jobiq-close" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:18px;line-height:1;">&#x2715;</button>
      </div>

      <!-- Job Info -->
      <div id="jobiq-job-info" style="font-size:11px;color:#94a3b8;margin-bottom:10px;padding:6px 8px;background:#0f172a;border-radius:8px;display:none;">
        <div id="jobiq-job-title" style="font-weight:700;color:#e2e8f0;font-size:12px;"></div>
        <div id="jobiq-job-company" style="margin-top:2px;color:#64748b;"></div>
      </div>

      <!-- Match Score -->
      <div id="jobiq-score-section" style="margin-bottom:12px;display:none;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-size:11px;color:#94a3b8;font-weight:600;letter-spacing:0.5px;">ATS MATCH SCORE</span>
          <span id="jobiq-score-num" style="font-size:26px;font-weight:800;color:#34d399;">0%</span>
        </div>
        <div style="background:#334155;border-radius:99px;height:10px;overflow:hidden;">
          <div id="jobiq-progress" style="height:100%;width:0%;border-radius:99px;transition:width 1s ease;"></div>
        </div>
        <div id="jobiq-score-label" style="font-size:10px;color:#64748b;margin-top:4px;text-align:right;"></div>
      </div>

      <!-- Strong Keywords -->
      <div id="jobiq-strong-section" style="margin-bottom:10px;display:none;">
        <div style="font-size:10px;color:#34d399;margin-bottom:5px;font-weight:700;letter-spacing:0.5px;">&#x2705; KEYWORDS IN YOUR RESUME</div>
        <div id="jobiq-strong-tags" style="display:flex;flex-wrap:wrap;gap:4px;"></div>
      </div>

      <!-- Missing Keywords -->
      <div id="jobiq-missing-section" style="margin-bottom:10px;display:none;">
        <div style="font-size:10px;color:#f87171;margin-bottom:5px;font-weight:700;letter-spacing:0.5px;">&#x274C; MISSING ATS KEYWORDS</div>
        <div id="jobiq-missing-tags" style="display:flex;flex-wrap:wrap;gap:4px;"></div>
      </div>

      <!-- Add to Resume -->
      <div id="jobiq-improve-section" style="margin-bottom:10px;display:none;">
        <div style="font-size:10px;color:#fbbf24;margin-bottom:5px;font-weight:700;letter-spacing:0.5px;">&#x1F4A1; ADD THESE TO YOUR RESUME</div>
        <div id="jobiq-improve-list" style="font-size:10px;color:#fbbf24;line-height:1.9;background:#1c1500;padding:8px;border-radius:6px;border:1px solid #78350f;"></div>
      </div>

      <!-- AI Tip -->
      <div id="jobiq-suggestion" style="font-size:10px;color:#93c5fd;background:#0f2040;border:1px solid #1d4ed8;border-radius:8px;padding:8px;margin-bottom:10px;line-height:1.7;display:none;"></div>

      <!-- Status -->
      <div id="jobiq-status" style="font-size:11px;padding:7px 10px;border-radius:8px;margin-bottom:8px;background:#1e293b;color:#94a3b8;border:1px solid #334155;line-height:1.5;">
        Open a LinkedIn job to begin.
      </div>

      <!-- Resume Upload -->
      <label id="jobiq-resume-label" style="display:block;font-size:10px;color:#818cf8;background:#1e293b;border:1px dashed #4f46e5;border-radius:8px;padding:7px 10px;margin-bottom:8px;cursor:pointer;text-align:center;">
        &#x1F4C4; Upload Resume (PDF, DOCX, DOC, TXT)
        <input type="file" id="jobiq-resume" accept=".pdf,.docx,.doc,.txt,.rtf" style="display:none">
      </label>

      <!-- Buttons -->
      <div style="display:flex;gap:6px;">
        <button id="jobiq-analyze" style="flex:1;padding:9px;border:none;border-radius:8px;cursor:pointer;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;font-size:12px;font-weight:700;">
          &#x1F9E0; Analyze
        </button>
        <button id="jobiq-apply" disabled style="flex:1;padding:9px;border:none;border-radius:8px;cursor:pointer;background:#374151;color:#6b7280;font-size:12px;font-weight:700;">
          &#x1F916; Apply
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(panel);
  makeDraggable(document.getElementById("jobiq-box"));

  document.getElementById("jobiq-close").addEventListener("click", () => panel.remove());

  // Resume upload — PDF + TXT
  document.getElementById("jobiq-resume").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setStatus("Reading resume...", "#94a3b8");
    try {
      const text = await extractResumeText(file);
      if (!text || text.length < 50) {
        setStatus("Resume appears empty. Try a different format.", "#f87171");
        return;
      }
      chrome.storage.local.set({ resumeText: text.slice(0, 8000) });
      setStatus("Resume ready: " + file.name + " (" + text.length + " chars)", "#34d399");
      document.getElementById("jobiq-resume-label").textContent = "\u2705 " + file.name;
      console.log("[JobIQ] Resume extracted:", text.slice(0, 200));
    } catch (err) {
      setStatus("Resume read failed: " + err.message, "#f87171");
      console.error("[JobIQ] Resume error:", err);
    }
  });

  // Analyze button
  document.getElementById("jobiq-analyze").addEventListener("click", async () => {
    if (!isAlive()) {
      setStatus("Extension reloaded — refresh page (Cmd+Shift+R)", "#f87171");
      return;
    }
    setStatus("Reading job description...", "#94a3b8");
    const jd = await waitForJD();
    if (!jd) {
      setStatus("No job found. Click a job card and wait.", "#f87171");
      return;
    }
    setStatus("Analyzing ATS keywords...", "#818cf8");
    await runAnalysis(jd);
  });

  // Apply button
  document.getElementById("jobiq-apply").addEventListener("click", async () => {
    setStatus("Starting Easy Apply...", "#93c5fd");
    await runEasyApply();
  });
}

// ── Core AI Analysis ──────────────────────────────────────────────────────────
async function runAnalysis(jd) {
  try {
    const stored = await new Promise(r => chrome.storage.local.get(["geminiApiKey", "resumeText", "minMatch"], r));
    const apiKey = stored.geminiApiKey || "AIzaSyC8n0AmvdVjZ7N0PNlVDY1f0SJV9WLyog8";
    const resume = stored.resumeText ||
      "Dillip Kumar Behera | Talent Acquisition | 4.6 years | Juspay, Infosys, Tech Mahindra | Skills: Power BI, ATS, Boolean Search, Stakeholder Management, End-to-End Recruitment, Offer Negotiation, Campus Hiring, BGV, Compliance, Recruitment Analytics, Workflow Automation";

    const prompt = `You are an expert ATS (Applicant Tracking System) analyzer.

TASK: Deeply analyze the Job Description and extract ALL important ATS keywords. Then check which ones exist in the resume.

Return ONLY this exact JSON (no extra text, no markdown):
{
  "match": 72,
  "strong_keywords": ["keyword1", "keyword2"],
  "missing_keywords": ["keyword3", "keyword4"],
  "improve_suggestions": [
    "Add 'keyword3' to your Skills section",
    "Mention 'keyword4' in your work experience at Juspay"
  ],
  "suggestions": "2-3 sentence specific advice to improve this application",
  "cover_letter": "Paragraph 1\\n\\nParagraph 2\\n\\nParagraph 3"
}

Rules:
- match = integer 0-100 (realistic ATS score based on keyword overlap + experience fit)
- strong_keywords = ATS keywords found in BOTH resume and JD (max 10)
- missing_keywords = important ATS keywords in JD but NOT in resume (max 10)
- improve_suggestions = exact actionable steps to add missing keywords to resume
- Focus on the "About the Job", "Requirements", "Responsibilities" sections of JD

RESUME:
${resume.slice(0, 3000)}

JOB DESCRIPTION:
${jd.slice(0, 3000)}`;

    console.log("[JobIQ] Calling Gemini API...");
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      }
    );

    const raw = await res.json();
    console.log("[JobIQ] Raw API response:", raw);

    if (raw.error) {
      setStatus("API Error: " + raw.error.message, "#f87171");
      return;
    }

    const text = raw.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    console.log("[JobIQ] AI text:", text);

    let result = extractJSON(text);
    if (!result) {
      setStatus("Could not parse AI response. Try again.", "#f87171");
      return;
    }

    result.match = Number(result.match) || 0;
    console.log("[JobIQ] Final result:", result);

    chrome.storage.local.set({ lastAnalysis: result });
    showResultInPanel(result, stored.minMatch || 50);

  } catch (err) {
    if (err.message && err.message.includes("Extension context invalidated")) {
      setStatus("Extension reloaded — refresh page (Cmd+Shift+R)", "#f87171");
    } else {
      setStatus("Error: " + err.message, "#f87171");
    }
    console.error("[JobIQ] Analysis error:", err);
  }
}

// ── Show result in panel ──────────────────────────────────────────────────────
function showResultInPanel(data, minMatch) {
  const match = Number(data.match) || 0;
  const min = minMatch || 50;

  // Score
  const scoreEl = document.getElementById("jobiq-score-num");
  const progressEl = document.getElementById("jobiq-progress");
  const scoreSection = document.getElementById("jobiq-score-section");
  const scoreLabel = document.getElementById("jobiq-score-label");

  if (scoreEl) {
    scoreEl.textContent = match + "%";
    const color = match >= 70 ? "#34d399" : match >= 50 ? "#fbbf24" : "#f87171";
    scoreEl.style.color = color;
    progressEl.style.width = match + "%";
    progressEl.style.background = match >= 70
      ? "linear-gradient(90deg,#10b981,#34d399)"
      : match >= 50
      ? "linear-gradient(90deg,#f59e0b,#fbbf24)"
      : "linear-gradient(90deg,#ef4444,#f87171)";
    scoreLabel.textContent = match >= 70 ? "Strong match" : match >= 50 ? "Moderate match" : "Weak match — improve resume";
    scoreSection.style.display = "block";
  }

  // Strong keywords
  const strongSection = document.getElementById("jobiq-strong-section");
  const strongTags = document.getElementById("jobiq-strong-tags");
  if (data.strong_keywords && data.strong_keywords.length) {
    strongTags.innerHTML = data.strong_keywords.map(k =>
      `<span style="font-size:10px;padding:3px 8px;border-radius:99px;background:#064e3b;color:#34d399;border:1px solid #065f46;font-weight:600;">${k}</span>`
    ).join("");
    strongSection.style.display = "block";
  }

  // Missing keywords
  const missingSection = document.getElementById("jobiq-missing-section");
  const missingTags = document.getElementById("jobiq-missing-tags");
  if (data.missing_keywords && data.missing_keywords.length) {
    missingTags.innerHTML = data.missing_keywords.map(k =>
      `<span style="font-size:10px;padding:3px 8px;border-radius:99px;background:#450a0a;color:#f87171;border:1px solid #7f1d1d;font-weight:600;">${k}</span>`
    ).join("");
    missingSection.style.display = "block";
  }

  // Improve suggestions
  const improveSection = document.getElementById("jobiq-improve-section");
  const improveList = document.getElementById("jobiq-improve-list");
  if (data.improve_suggestions && data.improve_suggestions.length) {
    improveList.innerHTML = data.improve_suggestions.map(s =>
      `<div style="margin-bottom:2px;">&#x2022; ${s}</div>`
    ).join("");
    improveSection.style.display = "block";
  }

  // AI tip
  const suggEl = document.getElementById("jobiq-suggestion");
  if (data.suggestions) {
    suggEl.textContent = "&#x1F4A1; " + data.suggestions;
    suggEl.style.display = "block";
  }

  // Apply button — check Easy Apply availability
  const hasEasyApply = [...document.querySelectorAll("button.jobs-apply-button")]
    .some(b => (b.getAttribute("aria-label") || "").toLowerCase().includes("easy apply") && b.offsetParent);

  const applyBtn = document.getElementById("jobiq-apply");
  if (applyBtn) {
    if (match >= min && hasEasyApply) {
      applyBtn.disabled = false;
      applyBtn.style.background = "linear-gradient(135deg,#10b981,#059669)";
      applyBtn.style.color = "white";
      applyBtn.textContent = "Easy Apply";
      setStatus(match + "% match — Easy Apply ready!", "#34d399");
    } else if (match >= min && !hasEasyApply) {
      applyBtn.disabled = true;
      applyBtn.style.background = "#374151";
      applyBtn.style.color = "#6b7280";
      applyBtn.textContent = "External Apply";
      setStatus(match + "% match — No Easy Apply on this job.", "#fbbf24");
    } else {
      applyBtn.disabled = true;
      applyBtn.style.background = "#374151";
      applyBtn.style.color = "#6b7280";
      applyBtn.textContent = "Apply";
      setStatus(match + "% — Add missing keywords to resume first.", "#f87171");
    }
  }
}

// ── Drag support ──────────────────────────────────────────────────────────────
function makeDraggable(el) {
  let ox = 0, oy = 0, mx = 0, my = 0;
  el.addEventListener("mousedown", (e) => {
    if (["BUTTON", "INPUT", "LABEL"].includes(e.target.tagName)) return;
    e.preventDefault();
    ox = e.clientX; oy = e.clientY;
    document.addEventListener("mousemove", drag);
    document.addEventListener("mouseup", stop);
  });
  function drag(e) {
    mx = ox - e.clientX; my = oy - e.clientY;
    ox = e.clientX; oy = e.clientY;
    el.style.top = (el.offsetTop - my) + "px";
    el.style.right = "auto";
    el.style.left = (el.offsetLeft - mx) + "px";
  }
  function stop() {
    document.removeEventListener("mousemove", drag);
    document.removeEventListener("mouseup", stop);
  }
}

function setStatus(msg, color) {
  const el = document.getElementById("jobiq-status");
  if (el) { el.textContent = msg; el.style.color = color || "#94a3b8"; }
}

// ── Extract job title/company and update panel ────────────────────────────────
function extractAndSendJD() {
  const titleEl = document.querySelector("h1.job-details-jobs-unified-top-card__job-title, h1.t-24");
  const companyEl = document.querySelector(".job-details-jobs-unified-top-card__company-name a, .jobs-unified-top-card__company-name a");
  currentTitle = titleEl?.innerText?.trim() || "";
  currentCompany = companyEl?.innerText?.trim() || "";
  if (currentTitle) {
    const info = document.getElementById("jobiq-job-info");
    if (info) {
      info.style.display = "block";
      document.getElementById("jobiq-job-title").textContent = currentTitle;
      document.getElementById("jobiq-job-company").textContent = currentCompany;
    }
    setStatus(currentTitle + " — Click Analyze", "#34d399");
  }
}

// ── Message listener ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "SHOW_RESULT") showResultInPanel(msg.data, 50);
  if (msg.type === "ANALYSIS_ERROR") setStatus(msg.error, "#f87171");
});

// ── Easy Apply ────────────────────────────────────────────────────────────────
async function runEasyApply() {
  const btn = [...document.querySelectorAll("button.jobs-apply-button")]
    .find(b => (b.getAttribute("aria-label") || "").toLowerCase().includes("easy apply") && b.offsetParent);
  if (!btn) { setStatus("No Easy Apply button found.", "#f87171"); return; }

  btn.click();
  await sleep(2500);

  const modal = document.querySelector("div.jobs-easy-apply-modal");
  if (!modal) { setStatus("Modal did not open.", "#f87171"); return; }

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
      const title = document.querySelector("h1")?.innerText?.trim() || currentTitle;
      chrome.runtime.sendMessage({ type: "JOB_APPLIED", title, company: currentCompany, match: 0, status: "Applied" });
      setStatus("Applied to " + title + " @ " + currentCompany, "#34d399");
      document.querySelector("button[aria-label='Dismiss']")?.click();
      return;
    }

    const nextBtn = getModalBtn(modal, ["Continue to next step", "Review your application", "Next", "Continue", "Review"]);
    if (nextBtn) {
      setStatus("Step " + (step + 1) + " — " + nextBtn.textContent.trim(), "#93c5fd");
      nextBtn.click();
    } else {
      setStatus("Could not find Next/Submit.", "#f87171");
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
  const DEF = { phone: "7750978982", name: "Dillip Kumar Behera", email: "dillipb2014@gmail.com", experience: "4", currentSalary: "900000", expectedSalary: "1200000", noticePeriod: "30" };
  chrome.storage.local.get(["candidateProfile"], (data) => {
    const p = Object.assign({}, DEF, data.candidateProfile || {});
    const map = {
      "phone": p.phone, "mobile": p.phone, "city": "Bangalore", "location": "Bangalore",
      "years of experience": p.experience, "experience": p.experience,
      "current salary": p.currentSalary, "current ctc": p.currentSalary,
      "expected": p.expectedSalary, "notice": p.noticePeriod,
      "name": p.name, "full name": p.name, "email": p.email
    };
    modal.querySelectorAll("input[type='text'],input[type='tel'],input[type='number']").forEach(inp => {
      const id = inp.getAttribute("id") || "";
      const lbl = (modal.querySelector("label[for='" + id + "']")?.textContent || "").toLowerCase();
      const ph = (inp.getAttribute("placeholder") || "").toLowerCase();
      const combined = lbl + " " + ph;
      for (const [key, val] of Object.entries(map)) {
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

// ── SPA URL polling ───────────────────────────────────────────────────────────
setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    if (location.href.includes("/jobs/")) {
      setTimeout(() => { injectJobIQPanel(); extractAndSendJD(); }, 2000);
    }
  }
}, 1000);

// ── Initial load ──────────────────────────────────────────────────────────────
window.addEventListener("load", () => setTimeout(() => { injectJobIQPanel(); extractAndSendJD(); }, 3000));
setTimeout(() => { injectJobIQPanel(); extractAndSendJD(); }, 3000);
