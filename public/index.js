/**
 * Career Tracker — AI-Powered Career Platform
 * Frontend Controller & API Integration Script
 */

const BASE_URL = "http://localhost:3000";

// Global Active User State
let activeUserId = localStorage.getItem("tracker_userId") || "";
let activeUserName = localStorage.getItem("tracker_userName") || "";

// Pagination State: Job Matches
let allJobMatches = [];
let jobMatchesShown = 0;
const JOB_MATCHES_PAGE_SIZE = 5;

// Pagination State: Interview Questions
let allInterviewQuestions = [];
let questionsShown = 0;
const QUESTIONS_PAGE_SIZE = 5;

// ==========================================
// 1. SYSTEM INITIALIZATION
// ==========================================

window.addEventListener("DOMContentLoaded", () => {
  updateActiveUserUIState();
  fetchUsersDropdownOptions();
  fetchSkillsDropdowns();
  fetchUserSkillsList(activeUserId);
});

// ==========================================
// 2. DOM HELPER UTILITIES
// ==========================================

/** Safe element value retriever */
function g(id) {
  const el = document.getElementById(id);
  return el && el.value ? el.value.trim() : "";
}

/** Clear input value by ID */
function clearInput(id) {
  const el = document.getElementById(id);
  if (el) el.value = "";
}

/** Toggle Page Views */
function showPage(pageId) {
  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.remove("active"));
  document
    .querySelectorAll(".nav-item")
    .forEach((n) => n.classList.remove("active"));

  const targetPage = document.getElementById(`page-${pageId}`);
  const targetNav = document.getElementById(`nav-${pageId}`);

  if (targetPage) targetPage.classList.add("active");
  if (targetNav) targetNav.classList.add("active");
}

// ==========================================
// 3. USER SESSION & AUTHENTICATION
// ==========================================

/** Update UI components reflecting current user status */
function updateActiveUserUIState() {
  const chip = document.getElementById("user-chip");
  const avatar = document.getElementById("user-avatar");
  const nameLabel = document.getElementById("user-chip-name");

  const lockedUserFields = [
    "res-current-user",
    "airm-current-user",
    "aicl-current-user",
    "aiip-current-user",
    "mat-current-user",
  ];

  if (activeUserId && activeUserName) {
    if (chip) chip.classList.add("visible");
    if (avatar) avatar.innerText = activeUserName.charAt(0).toUpperCase();
    if (nameLabel) nameLabel.innerText = activeUserName;

    lockedUserFields.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.innerText = `${activeUserName} (Logged in)`;
        el.style.color = "#107c41";
      }
    });

    // Synchronize select dropdowns with active user ID
    setTimeout(() => {
      document.querySelectorAll(".user-select-dropdown").forEach((dropdown) => {
        dropdown.value = activeUserId;
      });
    }, 200);
  } else {
    if (chip) chip.classList.remove("visible");
    lockedUserFields.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.innerText = "Not logged in — please log in first";
        el.style.color = "#64748b";
      }
    });
  }
}

/** Log out active user and reset application state */
function logoutUser() {
  activeUserId = "";
  activeUserName = "";
  localStorage.removeItem("tracker_userId");
  localStorage.removeItem("tracker_userName");

  updateActiveUserUIState();
  fetchUserSkillsList("");

  document
    .querySelectorAll(".user-select-dropdown")
    .forEach((d) => (d.value = ""));

  showPage("auth");
}

/** Authenticate or Register User */
async function authCall(typePath) {
  const payload =
    typePath === "register"
      ? { name: g("r-name"), email: g("r-email"), password: g("r-pass") }
      : { email: g("l-email"), password: g("l-pass") };

  // Validation
  if (
    !payload.email ||
    !payload.password ||
    (typePath === "register" && !payload.name)
  ) {
    alert("Please fill in all required authorization fields.");
    return;
  }

  const feedback = document.getElementById("auth-feedback");
  let succeeded = false;

  await doCall("POST", `/auth/${typePath}`, payload, "auth", (data) => {
    const user = data && data.user ? data.user : data;

    if (user && user.id) {
      succeeded = true;
      activeUserId = user.id;
      activeUserName = user.name;
      localStorage.setItem("tracker_userId", activeUserId);
      localStorage.setItem("tracker_userName", activeUserName);

      updateActiveUserUIState();
      fetchUsersDropdownOptions();
      fetchUserSkillsList(activeUserId);

      if (feedback) {
        feedback.style.display = "block";
        feedback.style.background = "#dcfce7";
        feedback.style.color = "#15803d";
        feedback.innerText =
          typePath === "register"
            ? `✅ Successfully registered and logged in as ${user.name}`
            : `✅ Logged in as ${user.name}`;
      }

      clearInput("r-name");
      clearInput("r-email");
      clearInput("r-pass");
      clearInput("l-email");
      clearInput("l-pass");
    }
  });

  if (!succeeded && feedback) {
    feedback.style.display = "block";
    feedback.style.background = "#fee2e2";
    feedback.style.color = "#b91c1c";
    feedback.innerText =
      typePath === "register"
        ? "❌ Registration failed — email may already be in use."
        : "❌ Login failed — invalid email or password.";
  }
}

// ==========================================
// 4. DROPDOWNS & USER SKILLS MANAGEMENT
// ==========================================

/** Fetch registered users list for dropdown options */
async function fetchUsersDropdownOptions() {
  try {
    const res = await fetch(`${BASE_URL}/users`);
    if (!res.ok) return;
    const users = await res.json();
    populateUsersLists(users);
  } catch (e) {
    console.error("Failed to load users dropdown options:", e);
  }
}

/** Populate user dropdown elements */
function populateUsersLists(usersArray) {
  if (!Array.isArray(usersArray)) return;
  document.querySelectorAll(".user-select-dropdown").forEach((dropdown) => {
    dropdown.innerHTML = '<option value="">— select user —</option>';
    usersArray.forEach((u) => {
      const opt = document.createElement("option");
      opt.value = u.id;
      opt.innerText = `${u.name} (${u.email})`;
      dropdown.appendChild(opt);
    });
  });
  if (activeUserId) {
    document
      .querySelectorAll(".user-select-dropdown")
      .forEach((d) => (d.value = activeUserId));
  }
}

/** Fetch available system skills for dropdown */
async function fetchSkillsDropdowns() {
  try {
    const res = await fetch(`${BASE_URL}/skills`);
    if (!res.ok) return;
    const skills = await res.json();
    const skSelect = document.getElementById("sk-id");
    if (!skSelect) return;
    skSelect.innerHTML = '<option value="">— select skill —</option>';
    skills.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.innerText = s.name;
      skSelect.appendChild(opt);
    });
  } catch (e) {
    console.error("Failed to load skills dropdown options:", e);
  }
}

/** Assign selected skill to logged-in user profile */
async function addSkillToMe() {
  const skillId = g("sk-id");
  if (!activeUserId) {
    alert("Please log in first before adding skills.");
    return;
  }
  if (!skillId) {
    alert("Please select a skill from the list.");
    return;
  }
  await doCall(
    "POST",
    "/skills/assign",
    { userId: activeUserId, skillId: skillId },
    "skills",
    () => fetchUserSkillsList(activeUserId),
  );
}

/** Retrieve and display logged-in user's skills */
async function fetchUserSkillsList(userId) {
  const container = document.getElementById("my-skills-list");
  const loginHint = document.getElementById("skills-login-hint");
  if (!container) return;

  if (!userId) {
    container.innerHTML = "";
    if (loginHint) loginHint.style.display = "block";
    return;
  }
  if (loginHint) loginHint.style.display = "none";

  try {
    const res = await fetch(`${BASE_URL}/user-skills/${userId}`);
    if (!res.ok) return;
    const userSkills = await res.json();
    container.innerHTML = "";

    if (userSkills.length === 0) {
      container.innerHTML =
        '<div style="font-size:13px; color:#94a3b8;">No skills added to profile yet.</div>';
      return;
    }

    userSkills.forEach((us) => {
      const chip = document.createElement("span");
      chip.className = "skill-chip";
      chip.innerHTML = `<i class="ti ti-check"></i> ${us.skill ? us.skill.name : us.name || "Skill"}`;
      container.appendChild(chip);
    });
  } catch (e) {
    console.error("Failed to fetch user skills profile:", e);
  }
}

// ==========================================
// 5. CORE API FETCH PIPELINE WRAPPER
// ==========================================

async function doCall(
  method,
  route,
  bodyData,
  sectionKey,
  successCallback = null,
) {
  const dot = document.getElementById(`dot-${sectionKey}`);
  const pre = document.getElementById(`res-${sectionKey}`);

  if (dot) dot.className = "status-dot loading";
  if (pre) pre.innerText = "Executing request across network interface...";

  const config = {
    method: method,
    headers: { "Content-Type": "application/json" },
  };
  if (bodyData && method !== "GET") {
    config.body = JSON.stringify(bodyData);
  }

  try {
    const response = await fetch(`${BASE_URL}${route}`, config);
    const parsedData = await response.json();

    if (response.ok) {
      if (dot) dot.className = "status-dot ok";
      if (pre) pre.innerText = JSON.stringify(parsedData, null, 2);
      if (successCallback) successCallback(parsedData);
    } else {
      if (dot) dot.className = "status-dot err";
      if (pre)
        pre.innerText = `Server Error (${response.status}):\n${JSON.stringify(parsedData, null, 2)}`;
    }
  } catch (err) {
    if (dot) dot.className = "status-dot err";
    if (pre) pre.innerText = `Network Connection Error:\n${err.message}`;
  }
}

// ==========================================
// 6. RESUME UPLOAD & ATS ANALYSIS
// ==========================================

function showFileName() {
  const fileInput = document.getElementById("res-file");
  const tag = document.getElementById("file-name-tag");
  const label = document.getElementById("file-name-text");
  if (fileInput.files.length > 0) {
    tag.classList.add("visible");
    label.innerText = fileInput.files[0].name;
  } else {
    tag.classList.remove("visible");
  }
}

async function uploadResume() {
  const userId = activeUserId;
  const fileInput = document.getElementById("res-file");
  const dot = document.getElementById("dot-resumes");
  const pre = document.getElementById("res-resumes");
  const btn = document.getElementById("btn-upload-resume");
  const card = document.getElementById("ats-result-card");

  if (!userId) {
    alert("Please log in before uploading a resume.");
    return;
  }
  if (fileInput.files.length === 0) {
    alert("Please select a PDF resume file to upload.");
    return;
  }

  btn.disabled = true;
  btn.innerHTML =
    '<span class="spinner"></span> Analyzing Resume with Gemini AI...';
  if (card) card.classList.remove("visible");
  if (dot) dot.className = "status-dot loading";
  if (pre)
    pre.innerText = "Parsing PDF document and computing ATS score analysis...";

  const formData = new FormData();
  formData.append("userId", userId);
  formData.append("resume", fileInput.files[0]);

  try {
    const res = await fetch(`${BASE_URL}/resumes/upload`, {
      method: "POST",
      body: formData,
    });
    const data = await res.json();

    if (res.ok) {
      if (dot) dot.className = "status-dot ok";
      if (pre) pre.innerText = JSON.stringify(data, null, 2);

      // Populate ATS Metric Card
      if (data.resume && data.resume.analysis) {
        const analysis = data.resume.analysis;
        const atsScore = data.resume.atsScore || 0;

        document.getElementById("score-ats").innerText = `${atsScore}`;
        document.getElementById("bar-ats").style.width = `${atsScore}%`;

        document.getElementById("score-grammar").innerText =
          `${analysis.grammarScore || 0}`;
        document.getElementById("bar-grammar").style.width =
          `${analysis.grammarScore || 0}%`;

        document.getElementById("score-format").innerText =
          `${analysis.formatScore || 0}`;
        document.getElementById("bar-format").style.width =
          `${analysis.formatScore || 0}%`;

        document.getElementById("score-keyword").innerText =
          `${analysis.keywordScore || 0}`;
        document.getElementById("bar-keyword").style.width =
          `${analysis.keywordScore || 0}%`;

        const strList = document.getElementById("ats-strengths");
        const wkList = document.getElementById("ats-weaknesses");
        strList.innerHTML = "";
        wkList.innerHTML = "";

        if (Array.isArray(analysis.strengths)) {
          analysis.strengths.forEach((s) => {
            const li = document.createElement("li");
            li.innerText = s;
            strList.appendChild(li);
          });
        }
        if (Array.isArray(analysis.weaknesses)) {
          analysis.weaknesses.forEach((w) => {
            const li = document.createElement("li");
            li.innerText = w;
            wkList.appendChild(li);
          });
        }
        if (card) card.classList.add("visible");
      }
    } else {
      if (dot) dot.className = "status-dot err";
      if (pre)
        pre.innerText = `Error (${res.status}):\n${JSON.stringify(data, null, 2)}`;
    }
  } catch (err) {
    if (dot) dot.className = "status-dot err";
    if (pre) pre.innerText = `Upload Failed:\n${err.message}`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-upload"></i> Upload &amp; Analyze';
  }
}

// ==========================================
// 7. AI JOB MATCHING ENGINE
// ==========================================

function renderJobCard(job) {
  const card = document.createElement("div");
  card.className = "job-card";
  const badgeClass =
    job.source === "Local Database" ? "purple-badge" : "blue-badge";
  card.innerHTML = `
    <div class="card-header">
      <h3>${job.title}</h3>
      <span class="score-badge">${job.matchScore}% Match</span>
    </div>
    <div class="company-info">${job.company} • ${job.location}</div>
    <span class="source-tag ${badgeClass}">${job.source}</span>
    <div class="ai-insight">
      <strong>🤖 AI Match Analysis:</strong> ${job.matchReason}
    </div>
    <a href="${job.applyLink === "Internal Application System" ? "#" : job.applyLink}" target="_blank" class="apply-btn">
      ${job.source === "Local Database" ? "Apply Directly" : "View External Job Listing ↗"}
    </a>
  `;
  return card;
}

function renderNextJobMatchesPage() {
  const listContainer = document.getElementById("jobs-list");
  const loadMoreBtn = document.getElementById("btn-load-more-jobs");
  const nextBatch = allJobMatches.slice(
    jobMatchesShown,
    jobMatchesShown + JOB_MATCHES_PAGE_SIZE,
  );

  nextBatch.forEach((job) => listContainer.appendChild(renderJobCard(job)));
  jobMatchesShown += nextBatch.length;

  if (loadMoreBtn) {
    loadMoreBtn.style.display =
      jobMatchesShown < allJobMatches.length ? "inline-flex" : "none";
  }
}

function loadMoreJobMatches() {
  renderNextJobMatchesPage();
}

async function fetchJobMatches() {
  const uid = activeUserId;
  const listContainer = document.getElementById("jobs-list");
  const loadMoreBtn = document.getElementById("btn-load-more-jobs");
  const btn = document.getElementById("btn-fetch-matches");

  if (!uid) {
    alert("Please log in to compute job matches for your profile.");
    return;
  }

  listContainer.innerHTML = "";
  if (loadMoreBtn) loadMoreBtn.style.display = "none";
  allJobMatches = [];
  jobMatchesShown = 0;

  btn.disabled = true;
  btn.innerHTML =
    '<span class="spinner"></span> Running Job Queries &amp; AI Match Rankings...';

  try {
    await doCall("GET", `/jobs/matches/${uid}`, null, "matches", (data) => {
      if (data && Array.isArray(data.matches)) {
        if (data.matches.length === 0) {
          listContainer.innerHTML =
            '<div style="font-size:13px; color:#64748b; padding:12px;">No active matches found for your profile signature. Try adding more skills or uploading an updated resume.</div>';
          return;
        }
        allJobMatches = data.matches;
        renderNextJobMatchesPage();
      }
    });
  } finally {
    btn.disabled = false;
    btn.innerHTML =
      '<i class="ti ti-bolt"></i> Compute &amp; Display Ranked Matches';
  }
}

// ==========================================
// 8. AI CAREER ROADMAP GENERATION
// ==========================================

async function generateAiRoadmap() {
  const uid = activeUserId;
  const goal = document.getElementById("airm-goal").value.trim();
  const display = document.getElementById("ai-roadmap-steps");
  const btn = document.getElementById("btn-generate-roadmap");

  if (!uid) {
    alert("Please log in first to generate your AI career roadmap.");
    return;
  }
  if (!goal) {
    alert("Please enter a target career goal (e.g., Full Stack Engineer).");
    return;
  }

  display.innerHTML = "";
  display.classList.remove("visible");

  btn.disabled = true;
  btn.innerHTML =
    '<span class="spinner"></span> Synthesizing Career Path Matrix...';

  try {
    await doCall(
      "POST",
      "/roadmaps/generate-ai",
      { userId: uid, title: goal },
      "ai-roadmap",
      (data) => {
        if (data && data.roadmap && Array.isArray(data.roadmap.steps)) {
          data.roadmap.steps.forEach((step, idx) => {
            const card = document.createElement("div");
            card.className = "step-card";
            card.innerHTML = `
              <div class="step-num">${idx + 1}</div>
              <div class="step-content">
                <div class="step-title">${step.title}</div>
                <div class="step-desc">${step.description}</div>
              </div>
            `;
            display.appendChild(card);
          });
          display.classList.add("visible");
        }
      },
    );
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-wand"></i> Synthesize Career Path Matrix';
  }
}

// ==========================================
// 9. AI COVER LETTER GENERATION
// ==========================================

async function generateCoverLetter() {
  const uid = activeUserId;
  const title = document.getElementById("aicl-title").value.trim();
  const company = document.getElementById("aicl-company").value.trim();
  const fallbackDesc = document.getElementById("aicl-desc").value.trim();
  const display = document.getElementById("cover-letter-display");
  const btn = document.getElementById("btn-generate-cover");

  if (!uid) {
    alert("Please log in first before generating a cover letter.");
    return;
  }
  if (!title || !company) {
    alert("Please specify target Job Title and Company Name.");
    return;
  }

  display.innerText = "";
  display.classList.remove("visible");

  btn.disabled = true;
  btn.innerHTML =
    '<span class="spinner"></span> Drafting Custom Cover Letter...';

  try {
    await doCall(
      "POST",
      "/resumes/cover-letter",
      {
        userId: uid,
        jobTitle: title,
        company: company,
        jobDescription: fallbackDesc,
      },
      "ai-cover",
      (data) => {
        if (data && data.coverLetter) {
          display.innerText = data.coverLetter;
          display.classList.add("visible");
        }
      },
    );
  } finally {
    btn.disabled = false;
    btn.innerHTML =
      '<i class="ti ti-file-text"></i> Generate Tailored Document';
  }
}

// ==========================================
// 10. AI INTERVIEW PREPARATION
// ==========================================

function renderQuestionCard(q) {
  const typeClass =
    q.type && q.type.toLowerCase() === "technical" ? "technical" : "behavioral";
  const card = document.createElement("div");
  card.className = "question-card";
  card.innerHTML = `
    <div class="q-header">
      <span class="q-type-badge ${typeClass}">${q.type || "General"}</span>
    </div>
    <div class="q-text">${q.question}</div>
    <div class="q-tip">
      <i class="ti ti-bulb"></i>
      <span><strong>Suggested Answer Strategy:</strong> ${q.idealAnswerGuideline || q.idealAnswer}</span>
    </div>
  `;
  return card;
}

function renderNextQuestionsPage() {
  const display = document.getElementById("ai-questions-display");
  const loadMoreBtn = document.getElementById("btn-load-more-questions");
  const nextBatch = allInterviewQuestions.slice(
    questionsShown,
    questionsShown + QUESTIONS_PAGE_SIZE,
  );

  nextBatch.forEach((q) => display.appendChild(renderQuestionCard(q)));
  questionsShown += nextBatch.length;
  display.classList.add("visible");

  if (loadMoreBtn) {
    loadMoreBtn.style.display =
      questionsShown < allInterviewQuestions.length ? "inline-flex" : "none";
  }
}

function loadMoreQuestions() {
  renderNextQuestionsPage();
}

async function generateInterviewPrep() {
  const uid = activeUserId;
  const contextDesc = document.getElementById("aiip-desc").value.trim();
  const display = document.getElementById("ai-questions-display");
  const loadMoreBtn = document.getElementById("btn-load-more-questions");
  const btn = document.getElementById("btn-generate-interview");

  if (!uid) {
    alert("Please log in first to generate interview questions.");
    return;
  }
  if (!contextDesc) {
    alert("Please enter a target job description or industry context.");
    return;
  }

  display.innerHTML = "";
  display.classList.remove("visible");
  if (loadMoreBtn) loadMoreBtn.style.display = "none";

  allInterviewQuestions = [];
  questionsShown = 0;

  btn.disabled = true;
  btn.innerHTML =
    '<span class="spinner"></span> Generating Interview Scenarios...';

  try {
    await doCall(
      "POST",
      "/resumes/interview-prep",
      { userId: uid, jobDescription: contextDesc },
      "ai-interview",
      (data) => {
        if (data && Array.isArray(data.interviewPrep)) {
          allInterviewQuestions = data.interviewPrep;
          renderNextQuestionsPage();
        }
      },
    );
  } finally {
    btn.disabled = false;
    btn.innerHTML =
      '<i class="ti ti-brain"></i> Construct Adaptive Questions Bank';
  }
}
