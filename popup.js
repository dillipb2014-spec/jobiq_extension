// ─── JobIQ AI — Popup Logic ───────────────────────────────────────────────────

let currentJD = "";
let currentTitle = "";
let currentCompany = "";
let currentMatch = 0;

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
    if (tab.dataset.tab === "history") loadHistory();
    if (tab.dataset.tab === "settings") loadSettings();
  });
});

document.getElementById("btnSettings").addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
  document.querySelector('[data-tab="settings"]').classList.add("active");
  document.getElementById("tab-settings").classList.add("active");
  loadSettings();
});

// ── Listen for messages from content/background ───────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {

  if (msg.type === "JD_DETECTED") {
    currentJD = msg.jd;
    currentTitle = msg.title;
    currentCompany = msg.company;

    if (msg.title) {
      document.getElementById("jobInfo").style.display = "block";
      document.getElementById("jobTitle").textContent = msg.title;
      document.getElementById("jobCompany").textContent = msg.company;
    }
    setStatus("info", `📄 Job detected: ${msg.title || "LinkedIn Job"}. Click Analyze Match.`);
  }

  if (msg.type === "SHOW_RESULT") {
    showAnalysisResult(msg.data);
  }

  if (msg.type === "ANALYSIS_ERROR") {
    setStatus("error", `❌ ${msg.error}`);
  }

  if (msg.type === "APPLY_STATUS") {
    const map = { started: "info", progress: "info", success: "success", error: "error", no_button: "error" };
    setApplyStatus(map[msg.status] || "info", msg.msg);
  }
});

// ── Analyze Button ────────────────────────────────────────────────────────────
document.getElementById("btnAnalyze").addEventListener("click", () => {
  if (!currentJD) {
    setStatus("error", "❌ No job detected. Open a LinkedIn job page first.");
    return;
  }
  setStatus("loading", "🧠 Analyzing with AI...");
  document.getElementById("matchCard").style.display = "none";
  document.getElementById("suggestionBox").style.display = "none";
  document.getElementById("coverLetterBox").classList.remove("show");
  chrome.runtime.sendMessage({ type: "GET_ANALYSIS", jd: currentJD });
});

// ── Show Analysis Result ──────────────────────────────────────────────────────
function showAnalysisResult(data) {
  currentMatch = data.match || 0;
  const scoreEl = document.getElementById("matchScore");
  const fillEl = document.getElementById("progressFill");

  scoreEl.textContent = `${currentMatch}%`;
  scoreEl.className = "match-score " + (currentMatch >= 70 ? "score-high" : currentMatch >= 50 ? "score-mid" : "score-low");
  fillEl.style.width = `${currentMatch}%`;
  fillEl.className = "progress-fill " + (currentMatch >= 70 ? "fill-high" : currentMatch >= 50 ? "fill-mid" : "fill-low");

  // Strong keywords
  const strongEl = document.getElementById("strongKeywords");
  strongEl.innerHTML = (data.strong_keywords || []).map(k =>
    `<span class="kw-tag kw-strong">${k}</span>`
  ).join("");

  // Missing keywords
  const missingEl = document.getElementById("missingKeywords");
  missingEl.innerHTML = (data.missing_keywords || []).map(k =>
    `<span class="kw-tag kw-missing">${k}</span>`
  ).join("");

  document.getElementById("matchCard").style.display = "block";

  // Suggestions
  if (data.suggestions) {
    document.getElementById("suggestionBox").textContent = `💡 ${data.suggestions}`;
    document.getElementById("suggestionBox").style.display = "block";
  }

  // Cover letter
  if (data.cover_letter) {
    document.getElementById("coverLetterText").textContent = data.cover_letter;
    document.getElementById("coverLetterBox").classList.add("show");
  }

  // Update apply tab
  document.getElementById("applyMatchScore").textContent = `${currentMatch}%`;
  document.getElementById("applyProgressFill").style.width = `${currentMatch}%`;
  document.getElementById("applyProgressFill").className = "progress-fill " +
    (currentMatch >= 70 ? "fill-high" : currentMatch >= 50 ? "fill-mid" : "fill-low");

  // Enable apply button if match is sufficient
  chrome.storage.local.get(["minMatch"], (r) => {
    const min = r.minMatch || 60;
    const applyBtn = document.getElementById("btnApply");
    if (currentMatch >= min) {
      applyBtn.disabled = false;
      setApplyStatus("success", `✅ Match ${currentMatch}% — Ready to Apply Smart!`);
    } else {
      applyBtn.disabled = true;
      setApplyStatus("error", `⚠️ Match ${currentMatch}% is below minimum ${min}%. Improve your resume first.`);
    }
  });

  setStatus("success", `✅ Analysis complete — ${currentMatch}% match`);
}

// ── Apply Smart Button ────────────────────────────────────────────────────────
document.getElementById("btnApply").addEventListener("click", () => {
  setApplyStatus("info", "🤖 Starting Easy Apply...");
  chrome.runtime.sendMessage({ type: "START_APPLY" });
});

// ── Copy Cover Letter ─────────────────────────────────────────────────────────
document.getElementById("copyBtn").addEventListener("click", () => {
  const text = document.getElementById("coverLetterText").textContent;
  navigator.clipboard.writeText(text).then(() => {
    document.getElementById("copyBtn").textContent = "Copied!";
    setTimeout(() => document.getElementById("copyBtn").textContent = "Copy", 2000);
  });
});

// ── History ───────────────────────────────────────────────────────────────────
function loadHistory() {
  chrome.storage.local.get(["appliedJobs"], (r) => {
    const jobs = r.appliedJobs || [];
    const list = document.getElementById("historyList");
    if (!jobs.length) {
      list.innerHTML = '<div class="empty-state">No applications yet.<br>Start applying to see history here.</div>';
      return;
    }
    list.innerHTML = jobs.map(j => `
      <div class="history-card">
        <div>
          <div class="h-title">${j.title}</div>
          <div class="h-company">${j.company} · ${j.date}</div>
        </div>
        <div style="text-align:right">
          <span class="h-badge ${j.status === 'Applied' ? 'badge-applied' : 'badge-manual'}">${j.status}</span>
          <div style="font-size:10px; color:#64748b; margin-top:3px">${j.match}% match</div>
        </div>
      </div>`).join("");
  });
}

document.getElementById("btnClearHistory").addEventListener("click", () => {
  chrome.storage.local.set({ appliedJobs: [] }, loadHistory);
});

// ── Settings ──────────────────────────────────────────────────────────────────
function loadSettings() {
  chrome.storage.local.get(["geminiApiKey", "candidateProfile", "minMatch", "resumeText"], (r) => {
    if (r.geminiApiKey) document.getElementById("apiKey").value = r.geminiApiKey;
    if (r.minMatch) document.getElementById("minMatch").value = r.minMatch;
    const p = r.candidateProfile || {};
    if (p.name) document.getElementById("pName").value = p.name;
    if (p.email) document.getElementById("pEmail").value = p.email;
    if (p.phone) document.getElementById("pPhone").value = p.phone;
    if (p.experience) document.getElementById("pExperience").value = p.experience;
    if (p.currentSalary) document.getElementById("pCurrentSalary").value = p.currentSalary;
    if (p.expectedSalary) document.getElementById("pExpectedSalary").value = p.expectedSalary;
    if (p.noticePeriod) document.getElementById("pNotice").value = p.noticePeriod;
    if (r.resumeText) document.getElementById("resumeLabel").textContent = "✅ Resume uploaded";
  });
}

document.getElementById("resumeUpload").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  chrome.storage.local.set({ resumeText: text });
  document.getElementById("resumeLabel").textContent = `✅ ${file.name}`;
});

document.getElementById("btnSave").addEventListener("click", () => {
  const profile = {
    name: document.getElementById("pName").value,
    email: document.getElementById("pEmail").value,
    phone: document.getElementById("pPhone").value,
    experience: document.getElementById("pExperience").value,
    currentSalary: document.getElementById("pCurrentSalary").value,
    expectedSalary: document.getElementById("pExpectedSalary").value,
    noticePeriod: document.getElementById("pNotice").value,
  };
  chrome.storage.local.set({
    geminiApiKey: document.getElementById("apiKey").value,
    candidateProfile: profile,
    minMatch: parseInt(document.getElementById("minMatch").value) || 60,
  }, () => {
    document.getElementById("btnSave").textContent = "✅ Saved!";
    setTimeout(() => document.getElementById("btnSave").textContent = "💾 Save Settings", 2000);
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function setStatus(type, msg) {
  const bar = document.getElementById("statusBar");
  bar.textContent = msg;
  bar.className = `status-bar show status-${type}`;
}

function setApplyStatus(type, msg) {
  const bar = document.getElementById("applyStatus");
  bar.textContent = msg;
  bar.className = `status-bar show status-${type}`;
}

// ── Init — check for existing JD ─────────────────────────────────────────────
chrome.storage.local.get(["lastAnalysis", "lastJD"], (r) => {
  if (r.lastAnalysis) showAnalysisResult(r.lastAnalysis);
  if (r.lastJD) currentJD = r.lastJD;
});
