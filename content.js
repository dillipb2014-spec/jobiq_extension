// ─── JobIQ AI — Content Script ───────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Auto-detect JD when page loads ───────────────────────────────────────────
let lastUrl = "";
const observer = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    if (location.href.includes("/jobs/")) {
      setTimeout(extractAndSendJD, 3000);
    }
  }
});
observer.observe(document.body, { childList: true, subtree: true });
setTimeout(extractAndSendJD, 3000);

function extractAndSendJD() {
  const jdEl = document.querySelector(
    ".jobs-description-content__text, .show-more-less-html__markup, .jobs-description__content"
  );
  const titleEl = document.querySelector(
    "h1.job-details-jobs-unified-top-card__job-title, h1.t-24"
  );
  const companyEl = document.querySelector(
    ".job-details-jobs-unified-top-card__company-name a, .jobs-unified-top-card__company-name a"
  );

  const jd = jdEl?.innerText || "";
  const title = titleEl?.innerText?.trim() || "";
  const company = companyEl?.innerText?.trim() || "";

  if (jd) {
    chrome.runtime.sendMessage({ type: "JD_DETECTED", jd, title, company });
  }
}

// ── Listen for Easy Apply trigger from background ─────────────────────────────
window.addEventListener("message", async (e) => {
  if (e.data?.type === "JOBIQ_START_APPLY") {
    await runEasyApply();
  }
});

// ── Easy Apply Automation ─────────────────────────────────────────────────────
async function runEasyApply() {
  // Find Easy Apply button (not the filter button)
  const applyBtn = [...document.querySelectorAll("button.jobs-apply-button")]
    .find(b => (b.getAttribute("aria-label") || "").toLowerCase().includes("easy apply") && b.offsetParent);

  if (!applyBtn) {
    chrome.runtime.sendMessage({ type: "APPLY_STATUS", status: "no_button", msg: "No Easy Apply button found on this job." });
    return;
  }

  chrome.runtime.sendMessage({ type: "APPLY_STATUS", status: "started", msg: "Clicking Easy Apply..." });
  applyBtn.click();
  await sleep(2500);

  const modal = document.querySelector("div.jobs-easy-apply-modal");
  if (!modal) {
    chrome.runtime.sendMessage({ type: "APPLY_STATUS", status: "error", msg: "Modal did not open." });
    return;
  }

  // Walk through form steps
  for (let step = 0; step < 10; step++) {
    await sleep(1500);
    modal.scrollTop = 99999;
    await sleep(800);

    fillFormFields(modal);
    await sleep(800);

    // Check for Submit
    const submitBtn = getModalBtn(modal, ["Submit application", "Submit"]);
    if (submitBtn) {
      submitBtn.scrollIntoView();
      await sleep(500);
      submitBtn.click();
      await sleep(2000);

      // Get job info for saving
      const title = document.querySelector("h1")?.innerText?.trim() || "Unknown";
      const company = document.querySelector(".jobs-unified-top-card__company-name a")?.innerText?.trim() || "Unknown";

      chrome.runtime.sendMessage({
        type: "JOB_APPLIED",
        title, company,
        match: (await getLastMatch()) || 0,
        status: "Applied"
      });
      chrome.runtime.sendMessage({ type: "APPLY_STATUS", status: "success", msg: `✅ Applied to ${title} @ ${company}` });

      // Dismiss modal
      document.querySelector("button[aria-label='Dismiss']")?.click();
      return;
    }

    // Next / Review
    const nextBtn = getModalBtn(modal, ["Continue to next step", "Review your application", "Next", "Continue", "Review"]);
    if (nextBtn) {
      chrome.runtime.sendMessage({ type: "APPLY_STATUS", status: "progress", msg: `Step ${step + 1} — ${nextBtn.textContent.trim()}` });
      nextBtn.click();
      await sleep(1500);
    } else {
      chrome.runtime.sendMessage({ type: "APPLY_STATUS", status: "error", msg: "Could not find Next/Submit button." });
      break;
    }
  }
}

function getModalBtn(modal, keywords) {
  for (const btn of modal.querySelectorAll("button")) {
    const label = (btn.getAttribute("aria-label") || "").toLowerCase();
    const text = btn.textContent.toLowerCase();
    if (keywords.some(k => label.includes(k.toLowerCase()) || text.includes(k.toLowerCase()))) {
      return btn;
    }
  }
  return null;
}

function fillFormFields(modal) {
  chrome.storage.local.get(["candidateProfile"], (data) => {
    const p = data.candidateProfile || {};
    const fieldMap = {
      "phone": p.phone || "", "mobile": p.phone || "",
      "city": "Bangalore", "location": "Bangalore",
      "years of experience": p.experience || "4",
      "experience": p.experience || "4",
      "current salary": p.currentSalary || "900000",
      "current ctc": p.currentSalary || "900000",
      "expected": p.expectedSalary || "1200000",
      "notice": p.noticePeriod || "30",
      "name": p.name || "", "full name": p.name || "",
      "email": p.email || "",
    };

    modal.querySelectorAll("input[type='text'], input[type='tel'], input[type='number']").forEach(inp => {
      const id = inp.getAttribute("id") || "";
      const label = (modal.querySelector(`label[for='${id}']`)?.textContent || "").toLowerCase();
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

    // Radio buttons — first option per group
    const groups = {};
    modal.querySelectorAll("input[type='radio']").forEach(r => {
      if (!groups[r.name]) groups[r.name] = r;
    });
    Object.values(groups).forEach(r => { if (!r.checked) r.click(); });
  });
}

async function getLastMatch() {
  return new Promise(resolve => {
    chrome.storage.local.get(["lastAnalysis"], r => resolve(r.lastAnalysis?.match || 0));
  });
}
