const BASE_URL = "http://localhost:3000";
let activeUserId = localStorage.getItem("tracker_userId") || "";
let activeUserName = localStorage.getItem("tracker_userName") || "";

// Pagination state for "Load More" panels
let allJobMatches = [];
let jobMatchesShown = 0;
const JOB_MATCHES_PAGE_SIZE = 5;

let allInterviewQuestions = [];
let questionsShown = 0;
const QUESTIONS_PAGE_SIZE = 5;

// Initialize System on Payload Load Frame
window.addEventListener("DOMContentLoaded", () => {
  updateActiveUserUIState();
  fetchUsersDropdownOptions();
  fetchSkillsDropdowns();
  fetchUserSkillsList(activeUserId);
});

// Simple Short Alias Helper Element Fetchers
function g(id) {
  return document.getElementById(id).value
    ? document.getElementById(id).value.trim()
    : "";
}
function clearInput(id) {
  document.getElementById(id).value = "";
}

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

// Core View System Controller Router Panel Switcher
function showPage(pageId) {
  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.remove("active"));
  document
    .querySelectorAll(".nav-item")
    .forEach((n) => n.classList.remove("active"));

  document.getElementById(`page-${pageId}`).classList.add("active");
  document.getElementById(`nav-${pageId}`).classList.add("active");
}

// UI Active Configuration Synchronization State Management
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
    chip.classList.add("visible");
    avatar.innerText = activeUserName.charAt(0).toUpperCase();
    nameLabel.innerText = activeUserName;

    lockedUserFields.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.innerText = `${activeUserName} (logged in)`;
        el.style.color = "#107c41";
      }
    });

    // Auto fill every native select instance class parameter across elements loop tracker
    setTimeout(() => {
      document.querySelectorAll(".user-select-dropdown").forEach((dropdown) => {
        dropdown.value = activeUserId;
      });
    }, 300);
  } else {
    chip.classList.remove("visible");
    lockedUserFields.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.innerText = "Not logged in — please log in first";
        el.style.color = "#3c3c43";
      }
    });
  }
}

// Dynamic Options Lists Synchronizers
async function fetchUsersDropdownOptions() {
  try {
    const res = await fetch(`${BASE_URL}/users`);
    if (!res.ok) return;
    const users = await res.json();
    populateUsersLists(users);
  } catch (e) {
    console.error("Dropdown fetch error sync mapping failure context:", e);
  }
}

function populateUsersLists(usersArray) {
  if (!Array.isArray(usersArray)) return;
  document.querySelectorAll(".user-select-dropdown").forEach((dropdown) => {
    // Keep base framework option placeholder
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
    console.error("Skills select population process context halt failure:", e);
  }
}

// Add the currently selected skill to the logged-in user's profile
async function addSkillToMe() {
  const skillId = g("sk-id");
  if (!activeUserId) {
    alert("Please log in first before adding skills.");
    return;
  }
  if (!skillId) {
    alert("Please select a skill to add.");
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

// Fetch and render the skills currently assigned to the logged-in user
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
        '<div style="font-size:12px; color:#8e8e93;">No skills added yet.</div>';
      return;
    }
    userSkills.forEach((us) => {
      const chip = document.createElement("span");
      chip.className = "skill-chip";
      chip.innerHTML = `<i class="ti ti-check"></i> ${us.skill.name}`;
      container.appendChild(chip);
    });
  } catch (e) {
    console.error("Failed to fetch user skills:", e);
  }
}

// Standard Base Centralized Promise Pipeline Fetch Wrapper Native Request Logic
async function doCall(
  method,
  route,
  bodyData,
  sectionKey,
  successCallback = null,
) {
  const dot = document.getElementById(`dot-${sectionKey}`);
  const pre = document.getElementById(`res-${sectionKey}`);

  if (dot) {
    dot.className = "status-dot loading";
  }
  if (pre) {
    pre.innerText =
      "Query executing natively across network stream interfaces...";
  }

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
        pre.innerText = `Error State Detected (${response.status}):\n${JSON.stringify(parsedData, null, 2)}`;
    }
  } catch (err) {
    if (dot) dot.className = "status-dot err";
    if (pre)
      pre.innerText = `Network Pipe Framework Interrupted Communication Failure State Stack:\n${err.message}`;
  }
}

// Authorization Dedicated Call Processor Custom Action Route Logic
async function authCall(typePath) {
  const payload =
    typePath === "register"
      ? { name: g("r-name"), email: g("r-email"), password: g("r-pass") }
      : { email: g("l-email"), password: g("l-pass") };

  const feedback = document.getElementById("auth-feedback");
  let succeeded = false;

  await doCall("POST", `/auth/${typePath}`, payload, "auth", (data) => {
    // Login responses are wrapped as { user }; register returns the raw user object
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

      feedback.style.display = "block";
      feedback.style.background = "#e1fbf2";
      feedback.style.color = "#107c41";
      feedback.innerText =
        typePath === "register"
          ? `✅ Registered and logged in as ${user.name}`
          : `✅ Logged in as ${user.name}`;

      // Wipe forms out clean cleanly
      clearInput("r-name");
      clearInput("r-email");
      clearInput("r-pass");
      clearInput("l-email");
      clearInput("l-pass");
    }
  });

  if (!succeeded) {
    feedback.style.display = "block";
    feedback.style.background = "#ffe5e5";
    feedback.style.color = "#c0392b";
    feedback.innerText =
      typePath === "register"
        ? "❌ Registration failed — that email may already be registered."
        : "❌ Login failed — check your email and password.";
  }
}

// File Input Helper Label Rendering Core Track Logic
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

// Multipart File Processing Custom Pipeline Engine Target
async function uploadResume() {
  const userId = activeUserId;
  const fileInput = document.getElementById("res-file");
  const dot = document.getElementById("dot-resumes");
  const pre = document.getElementById("res-resumes");
  const btn = document.getElementById("btn-upload-resume");
  const card = document.getElementById("ats-result-card");

  if (!userId || fileInput.files.length === 0) {
    alert(
      "Please select a valid user target context identity and point to a local PDF resume element artifact structure first.",
    );
    return;
  }

  // Setup loading states UI
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Processing AI Extraction...';
  card.classList.remove("visible");
  dot.className = "status-dot loading";
  pre.innerText =
    "Uploading raw binary buffers... Running Gemini Document Parsing Analysis Context Blocks...";

  const formData = new FormData();
  formData.append("userId", userId);
  formData.append("resume", fileInput.files[0]);

  try {
    const res = await fetch(`${BASE_URL}/resumes/upload`, {
      method: "POST",
      body: formData,
    });
    const data = await res.json();

    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-upload"></i> Upload &amp; Analyze';

    if (res.ok) {
      dot.className = "status-dot ok";
      pre.innerText = JSON.stringify(data, null, 2);

      // Map the processed engine analysis variables right onto our beautiful system display tracking dashboard card structure parameters natively!
      // Map the processed engine analysis variables right onto our beautiful system display tracking dashboard card structure parameters natively!
      if (data.resume && data.resume.analysis) {
        const analysis = data.resume.analysis;
        document.getElementById("score-ats").innerText =
          `${data.resume.atsScore || 0}`;
        document.getElementById("bar-ats").style.width =
          `${data.resume.atsScore || 0}%`;

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

        // Render explicit list tracking arrays collections loops safely
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
        card.classList.add("visible");
      }
    } else {
      dot.className = "status-dot err";
      pre.innerText = `Pipeline Rejection Halt Response Event Status (${res.status}):\n${JSON.stringify(data, null, 2)}`;
    }
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-upload"></i> Upload &amp; Analyze';
    dot.className = "status-dot err";
    pre.innerText = `File stream data pipeline link connection fatal breakdown stack track crash logs:\n${err.message}`;
  }
}

// Match Dashboard Aggregator Processing Logic
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
            <strong>🤖 AI Analytics Reasoning Metric:</strong> ${job.matchReason}
          </div>
          <a href="${job.applyLink === "Internal Application System" ? "#" : job.applyLink}" target="_blank" class="apply-btn">
            ${job.source === "Local Database" ? "Execute Internal Direct Application" : "Open External Web Target Link ↗"}
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

  loadMoreBtn.style.display =
    jobMatchesShown < allJobMatches.length ? "inline-flex" : "none";
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
    alert(
      "Select target user identity context parameter step trace vector first.",
    );
    return;
  }

  listContainer.innerHTML = "";
  loadMoreBtn.style.display = "none";
  allJobMatches = [];
  jobMatchesShown = 0;
  btn.disabled = true;
  btn.innerHTML =
    '<span class="spinner"></span> Running Internet Queries &amp; Core Model Cross Rankings Calculations...';

  await doCall("GET", `/jobs/matches/${uid}`, null, "matches", (data) => {
    btn.disabled = false;
    btn.innerHTML =
      '<i class="ti ti-bolt"></i> Compute &amp; Display Ranked Matches';

    if (data && Array.isArray(data.matches)) {
      if (data.matches.length === 0) {
        listContainer.innerHTML =
          '<div style="font-size:13px; color:#636366; padding:12px;">No active matches located inside structural processing vectors matching this profile data signature currently. Upload a clean distinct resume profile structure or broaden target system constraints.</div>';
        return;
      }
      allJobMatches = data.matches;
      renderNextJobMatchesPage();
    }
  });
  btn.disabled = false;
  btn.innerHTML =
    '<i class="ti ti-bolt"></i> Compute &amp; Display Ranked Matches';
}

// AI Features Path Roadmap Matrix Generation Core Engine Pipeline Link
async function generateAiRoadmap() {
  const uid = activeUserId;
  const goal = document.getElementById("airm-goal").value.trim();
  const display = document.getElementById("ai-roadmap-steps");
  const btn = document.getElementById("btn-generate-roadmap");

  if (!uid || !goal) {
    alert(
      "Target identity verification ID code and objective matrix fields required parameter variables framework missing.",
    );
    return;
  }

  display.innerHTML = "";
  display.classList.remove("visible");
  btn.disabled = true;
  btn.innerHTML =
    '<span class="spinner"></span> Deep Path Compiling Tracking Mapping...';

  await doCall(
    "POST",
    "/roadmaps/generate-ai",
    { userId: uid, title: goal },
    "ai-roadmap",
    (data) => {
      btn.disabled = false;
      btn.innerHTML =
        '<i class="ti ti-wand"></i> Synthesize Career Path Matrix';

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
  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-wand"></i> Synthesize Career Path Matrix';
}

// AI Document Assembly Processing Pipeline Block Router Trigger
async function generateCoverLetter() {
  const uid = activeUserId;
  const title = document.getElementById("aicl-title").value.trim();
  const company = document.getElementById("aicl-company").value.trim();
  const fallbackDesc = document.getElementById("aicl-desc").value.trim();
  const display = document.getElementById("cover-letter-display");
  const btn = document.getElementById("btn-generate-cover");

  if (!uid || !title || !company) {
    alert(
      "Ensure user target profile selection, title fields, and target firm variable context constraints parameters parameters match correctly.",
    );
    return;
  }

  display.innerText = "";
  display.classList.remove("visible");
  btn.disabled = true;
  btn.innerHTML =
    '<span class="spinner"></span> Framing Contextual Document Structuring Engines...';

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
      btn.disabled = false;
      btn.innerHTML =
        '<i class="ti ti-file-text"></i> Generate Tailored Document';

      if (data && data.coverLetter) {
        display.innerText = data.coverLetter;
        display.classList.add("visible");
      }
    },
  );
  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-file-text"></i> Generate Tailored Document';
}

// AI Prediction Interview Grid Bank Simulator Layout Frame Process Tracker
function renderQuestionCard(q) {
  const typeClass =
    q.type && q.type.toLowerCase() === "technical" ? "technical" : "behavioral";
  const card = document.createElement("div");
  card.className = "question-card";
  card.innerHTML = `
          <div class="q-header">
            <span class="q-type-badge ${typeClass}">${q.type || "General CheckPoint"}</span>
          </div>
          <div class="q-text">${q.question}</div>
          <div class="q-tip">
            <i class="ti ti-bulb"></i>
            <span><strong>Optimal Approach Strategy Recommendation Blueprint:</strong> ${q.idealAnswerGuideline || q.idealAnswer}</span>
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

  loadMoreBtn.style.display =
    questionsShown < allInterviewQuestions.length ? "inline-flex" : "none";
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

  if (!uid || !contextDesc) {
    alert(
      "Missing target applicant reference context identifier values or target verification criteria string blocks.",
    );
    return;
  }

  display.innerHTML = "";
  display.classList.remove("visible");
  loadMoreBtn.style.display = "none";
  allInterviewQuestions = [];
  questionsShown = 0;
  btn.disabled = true;
  btn.innerHTML =
    '<span class="spinner"></span> Processing Predictive Interview Simulation Scenarios Framework...';

  await doCall(
    "POST",
    "/resumes/interview-prep",
    { userId: uid, jobDescription: contextDesc },
    "ai-interview",
    (data) => {
      btn.disabled = false;
      btn.innerHTML =
        '<i class="ti ti-brain"></i> Construct Adaptive Questions Bank';

      if (data && Array.isArray(data.interviewPrep)) {
        allInterviewQuestions = data.interviewPrep;
        renderNextQuestionsPage();
      }
    },
  );
  btn.disabled = false;
  btn.innerHTML =
    '<i class="ti ti-brain"></i> Construct Adaptive Questions Bank';
}
