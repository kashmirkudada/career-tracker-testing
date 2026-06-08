require("dotenv").config();
const express = require("express");
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const PDFParser = require("pdf2json");

const app = express();
const prisma = new PrismaClient();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─────────────────────────────────────────────
// CLOUDINARY CONFIG
// ─────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Store file in memory before uploading to Cloudinary
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────
// HELPER — parse strengths/weaknesses back to arrays
// ─────────────────────────────────────────────
function parseAnalysis(analysis) {
  if (!analysis) return analysis;
  return {
    ...analysis,
    strengths:
      typeof analysis.strengths === "string"
        ? JSON.parse(analysis.strengths || "[]")
        : (analysis.strengths ?? []),
    weaknesses:
      typeof analysis.weaknesses === "string"
        ? JSON.parse(analysis.weaknesses || "[]")
        : (analysis.weaknesses ?? []),
  };
}

// ─────────────────────────────────────────────
// AUTH / USER
// ─────────────────────────────────────────────

// POST /auth/register
app.post("/auth/register", async (req, res) => {
  try {
    const { name, email, password, profilePic } = req.body;
    if (!name || !email || !password)
      return res
        .status(400)
        .json({ error: "name, email and password are required" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, password: hashedPassword, profilePic },
      select: {
        id: true,
        name: true,
        email: true,
        profilePic: true,
        createdAt: true,
      },
    });
    res.status(201).json(user);
  } catch (err) {
    if (err.code === "P2002")
      return res.status(409).json({ error: "Email already exists" });
    res.status(500).json({ error: err.message });
  }
});

// POST /auth/login
app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "email and password are required" });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    const { password: _, ...safeUser } = user;
    res.json({ message: "Login successful", user: safeUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /users
app.get("/users", async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        profilePic: true,
        createdAt: true,
      },
    });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /users/:id
app.get("/users/:id", async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        name: true,
        email: true,
        profilePic: true,
        createdAt: true,
        resumes: { include: { analysis: true } },
        skills: { include: { skill: true } },
        jobMatches: { include: { job: true } },
        roadmaps: true,
      },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    // Parse analyses inside each resume
    const parsed = {
      ...user,
      resumes: user.resumes.map((r) => ({
        ...r,
        analysis: r.analysis ? parseAnalysis(r.analysis) : r.analysis,
      })),
    };
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /users/:id
app.put("/users/:id", async (req, res) => {
  try {
    const { name, profilePic } = req.body;
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { name, profilePic },
      select: {
        id: true,
        name: true,
        email: true,
        profilePic: true,
        updatedAt: true,
      },
    });
    res.json(user);
  } catch (err) {
    if (err.code === "P2025")
      return res.status(404).json({ error: "User not found" });
    res.status(500).json({ error: err.message });
  }
});

// DELETE /users/:id
app.delete("/users/:id", async (req, res) => {
  try {
    await prisma.user.delete({ where: { id: req.params.id } });
    res.json({ message: "User deleted" });
  } catch (err) {
    if (err.code === "P2025")
      return res.status(404).json({ error: "User not found" });
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// RESUMES
// ─────────────────────────────────────────────

// POST /resumes/upload  — multipart/form-data (file upload + AI analysis)
app.post("/resumes/upload", upload.single("resume"), async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId is required" });
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    // 1. Upload to Cloudinary
    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "resumes", resource_type: "raw" },
        (err, result) => (err ? reject(err) : resolve(result)),
      );
      stream.end(req.file.buffer);
    });

    // 2. Extract text from PDF using pdf2json (pure Node, no Python needed)
    let extractedText = "";
    await new Promise((resolve) => {
      const pdfParser = new PDFParser();
      pdfParser.on("pdfParser_dataError", () => {
        extractedText = "Could not extract text from PDF";
        resolve();
      });
      pdfParser.on("pdfParser_dataReady", (pdfData) => {
        try {
          extractedText = pdfData.Pages.map((page) =>
            page.Texts.map((t) =>
              decodeURIComponent(t.R.map((r) => r.T).join("")),
            ).join(" "),
          )
            .join("\n")
            .trim();
        } catch {
          extractedText = "Could not extract text from PDF";
        }
        resolve();
      });
      pdfParser.parseBuffer(req.file.buffer);
    });

    // 3. Ask Gemini to analyze resume and give ATS score
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = `
You are an ATS (Applicant Tracking System) expert. Analyze this resume text and respond ONLY with valid JSON, no markdown, no backticks.

Resume text:
"""
${extractedText.slice(0, 4000)}
"""

Format:
{
  "atsScore": <0-100 number>,
  "grammarScore": <0-100>,
  "formattingScore": <0-100>,
  "keywordScore": <0-100>,
  "strengths": ["...", "..."],
  "weaknesses": ["...", "..."]
}
    `.trim();

    const result = await model.generateContent(prompt);
    const rawText = result.response
      .text()
      .replace(/```json|```/g, "")
      .trim();
    const analysis = JSON.parse(rawText);

    // 4. Save resume to DB
    const resume = await prisma.resume.create({
      data: {
        fileName: req.file.originalname,
        fileUrl: uploadResult.secure_url,
        atsScore: analysis.atsScore,
        userId,
      },
    });

    // 5. Save analysis to DB — stringify arrays so Prisma (String field) accepts them
    const savedAnalysis = await prisma.resumeAnalysis.create({
      data: {
        grammarScore: analysis.grammarScore,
        formattingScore: analysis.formattingScore,
        keywordScore: analysis.keywordScore,
        strengths: JSON.stringify(analysis.strengths ?? []),
        weaknesses: JSON.stringify(analysis.weaknesses ?? []),
        resumeId: resume.id,
      },
    });

    res.status(201).json({
      message: "Resume uploaded and analyzed",
      resume: { ...resume, analysis: parseAnalysis(savedAnalysis) },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /resumes  (manual entry without file)
app.post("/resumes", async (req, res) => {
  try {
    const { fileName, fileUrl, atsScore, userId } = req.body;
    if (!fileName || !fileUrl || !userId)
      return res
        .status(400)
        .json({ error: "fileName, fileUrl and userId are required" });

    const resume = await prisma.resume.create({
      data: { fileName, fileUrl, atsScore, userId },
    });
    res.status(201).json(resume);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /resumes/user/:userId  ← must be BEFORE /resumes/:id to avoid route conflict
app.get("/resumes/user/:userId", async (req, res) => {
  try {
    const resumes = await prisma.resume.findMany({
      where: { userId: req.params.userId },
      include: { analysis: true }, // one-to-one → singular
      orderBy: { createdAt: "desc" },
    });
    const parsed = resumes.map((r) => ({
      ...r,
      analysis: r.analysis ? parseAnalysis(r.analysis) : r.analysis,
    }));
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /resumes/:id
app.get("/resumes/:id", async (req, res) => {
  try {
    const resume = await prisma.resume.findUnique({
      where: { id: req.params.id },
      include: { analysis: true }, // one-to-one → singular
    });
    if (!resume) return res.status(404).json({ error: "Resume not found" });
    res.json({
      ...resume,
      analysis: resume.analysis
        ? parseAnalysis(resume.analysis)
        : resume.analysis,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /resumes/:id
app.put("/resumes/:id", async (req, res) => {
  try {
    const { fileName, fileUrl, atsScore } = req.body;
    const resume = await prisma.resume.update({
      where: { id: req.params.id },
      data: { fileName, fileUrl, atsScore },
    });
    res.json(resume);
  } catch (err) {
    if (err.code === "P2025")
      return res.status(404).json({ error: "Resume not found" });
    res.status(500).json({ error: err.message });
  }
});

// DELETE /resumes/:id
app.delete("/resumes/:id", async (req, res) => {
  try {
    await prisma.resume.delete({ where: { id: req.params.id } });
    res.json({ message: "Resume deleted" });
  } catch (err) {
    if (err.code === "P2025")
      return res.status(404).json({ error: "Resume not found" });
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// RESUME ANALYSIS
// ─────────────────────────────────────────────

// POST /resume-analysis
app.post("/resume-analysis", async (req, res) => {
  try {
    const {
      grammarScore,
      formattingScore,
      keywordScore,
      strengths,
      weaknesses,
      resumeId,
    } = req.body;
    if (!resumeId)
      return res.status(400).json({ error: "resumeId is required" });

    const analysis = await prisma.resumeAnalysis.create({
      data: {
        grammarScore,
        formattingScore,
        keywordScore,
        strengths: JSON.stringify(Array.isArray(strengths) ? strengths : []),
        weaknesses: JSON.stringify(Array.isArray(weaknesses) ? weaknesses : []),
        resumeId,
      },
    });
    res.status(201).json(parseAnalysis(analysis));
  } catch (err) {
    if (err.code === "P2002")
      return res
        .status(409)
        .json({ error: "Analysis already exists for this resume" });
    res.status(500).json({ error: err.message });
  }
});

// GET /resume-analysis/:resumeId
app.get("/resume-analysis/:resumeId", async (req, res) => {
  try {
    const analysis = await prisma.resumeAnalysis.findUnique({
      where: { resumeId: req.params.resumeId },
    });
    if (!analysis) return res.status(404).json({ error: "Analysis not found" });
    res.json(parseAnalysis(analysis));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /resume-analysis/:resumeId
app.put("/resume-analysis/:resumeId", async (req, res) => {
  try {
    const {
      grammarScore,
      formattingScore,
      keywordScore,
      strengths,
      weaknesses,
    } = req.body;
    const analysis = await prisma.resumeAnalysis.update({
      where: { resumeId: req.params.resumeId },
      data: {
        grammarScore,
        formattingScore,
        keywordScore,
        strengths: JSON.stringify(Array.isArray(strengths) ? strengths : []),
        weaknesses: JSON.stringify(Array.isArray(weaknesses) ? weaknesses : []),
      },
    });
    res.json(parseAnalysis(analysis));
  } catch (err) {
    if (err.code === "P2025")
      return res.status(404).json({ error: "Analysis not found" });
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// SKILLS
// ─────────────────────────────────────────────

// POST /skills
app.post("/skills", async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });

    const skill = await prisma.skill.create({ data: { name } });
    res.status(201).json(skill);
  } catch (err) {
    if (err.code === "P2002")
      return res.status(409).json({ error: "Skill already exists" });
    res.status(500).json({ error: err.message });
  }
});

// GET /skills
app.get("/skills", async (req, res) => {
  try {
    const skills = await prisma.skill.findMany({ orderBy: { name: "asc" } });
    res.json(skills);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /skills/:id
app.delete("/skills/:id", async (req, res) => {
  try {
    await prisma.skill.delete({ where: { id: req.params.id } });
    res.json({ message: "Skill deleted" });
  } catch (err) {
    if (err.code === "P2025")
      return res.status(404).json({ error: "Skill not found" });
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// USER SKILLS
// ─────────────────────────────────────────────

// POST /user-skills
app.post("/user-skills", async (req, res) => {
  try {
    const { userId, skillId, level } = req.body;
    if (!userId || !skillId)
      return res.status(400).json({ error: "userId and skillId are required" });

    const userSkill = await prisma.userSkill.create({
      data: { userId, skillId, level: level ?? 1 },
      include: { skill: true },
    });
    res.status(201).json(userSkill);
  } catch (err) {
    if (err.code === "P2002")
      return res.status(409).json({ error: "User already has this skill" });
    res.status(500).json({ error: err.message });
  }
});

// GET /user-skills/:userId
app.get("/user-skills/:userId", async (req, res) => {
  try {
    const skills = await prisma.userSkill.findMany({
      where: { userId: req.params.userId },
      include: { skill: true },
    });
    res.json(skills);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /user-skills/:id
app.put("/user-skills/:id", async (req, res) => {
  try {
    const { level } = req.body;
    const userSkill = await prisma.userSkill.update({
      where: { id: req.params.id },
      data: { level },
      include: { skill: true },
    });
    res.json(userSkill);
  } catch (err) {
    if (err.code === "P2025")
      return res.status(404).json({ error: "UserSkill not found" });
    res.status(500).json({ error: err.message });
  }
});

// DELETE /user-skills/:id
app.delete("/user-skills/:id", async (req, res) => {
  try {
    await prisma.userSkill.delete({ where: { id: req.params.id } });
    res.json({ message: "Skill removed from user" });
  } catch (err) {
    if (err.code === "P2025")
      return res.status(404).json({ error: "UserSkill not found" });
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// JOBS
// ─────────────────────────────────────────────

// POST /jobs
app.post("/jobs", async (req, res) => {
  try {
    const { title, company, location, salaryMin, salaryMax, description } =
      req.body;
    if (!title || !company || !location)
      return res
        .status(400)
        .json({ error: "title, company and location are required" });

    const job = await prisma.job.create({
      data: { title, company, location, salaryMin, salaryMax, description },
    });
    res.status(201).json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /jobs
app.get("/jobs", async (req, res) => {
  try {
    const { search, location } = req.query;
    const jobs = await prisma.job.findMany({
      where: {
        ...(search && { title: { contains: search, mode: "insensitive" } }),
        ...(location && {
          location: { contains: location, mode: "insensitive" },
        }),
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /jobs/:id
app.get("/jobs/:id", async (req, res) => {
  try {
    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: {
        matches: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /jobs/:id
app.put("/jobs/:id", async (req, res) => {
  try {
    const { title, company, location, salaryMin, salaryMax, description } =
      req.body;
    const job = await prisma.job.update({
      where: { id: req.params.id },
      data: { title, company, location, salaryMin, salaryMax, description },
    });
    res.json(job);
  } catch (err) {
    if (err.code === "P2025")
      return res.status(404).json({ error: "Job not found" });
    res.status(500).json({ error: err.message });
  }
});

// DELETE /jobs/:id
app.delete("/jobs/:id", async (req, res) => {
  try {
    await prisma.job.delete({ where: { id: req.params.id } });
    res.json({ message: "Job deleted" });
  } catch (err) {
    if (err.code === "P2025")
      return res.status(404).json({ error: "Job not found" });
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// JOB MATCHES
// ─────────────────────────────────────────────

// POST /job-matches
app.post("/job-matches", async (req, res) => {
  try {
    const { userId, jobId, matchScore } = req.body;
    if (!userId || !jobId || matchScore === undefined)
      return res
        .status(400)
        .json({ error: "userId, jobId and matchScore are required" });

    const match = await prisma.jobMatch.create({
      data: { userId, jobId, matchScore },
      include: { job: true },
    });
    res.status(201).json(match);
  } catch (err) {
    if (err.code === "P2002")
      return res.status(409).json({ error: "Match already exists" });
    res.status(500).json({ error: err.message });
  }
});

// GET /job-matches/user/:userId
app.get("/job-matches/user/:userId", async (req, res) => {
  try {
    const matches = await prisma.jobMatch.findMany({
      where: { userId: req.params.userId },
      include: { job: true },
      orderBy: { matchScore: "desc" },
    });
    res.json(matches);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /job-matches/:id
app.put("/job-matches/:id", async (req, res) => {
  try {
    const { matchScore } = req.body;
    const match = await prisma.jobMatch.update({
      where: { id: req.params.id },
      data: { matchScore },
      include: { job: true },
    });
    res.json(match);
  } catch (err) {
    if (err.code === "P2025")
      return res.status(404).json({ error: "Match not found" });
    res.status(500).json({ error: err.message });
  }
});

// DELETE /job-matches/:id
app.delete("/job-matches/:id", async (req, res) => {
  try {
    await prisma.jobMatch.delete({ where: { id: req.params.id } });
    res.json({ message: "Job match removed" });
  } catch (err) {
    if (err.code === "P2025")
      return res.status(404).json({ error: "Match not found" });
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// ROADMAPS
// ─────────────────────────────────────────────

// POST /roadmaps
app.post("/roadmaps", async (req, res) => {
  try {
    const { title, userId } = req.body;
    if (!title || !userId)
      return res.status(400).json({ error: "title and userId are required" });

    const roadmap = await prisma.roadmap.create({
      data: { title, userId },
      include: { steps: true },
    });
    res.status(201).json(roadmap);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /roadmaps/user/:userId
app.get("/roadmaps/user/:userId", async (req, res) => {
  try {
    const roadmaps = await prisma.roadmap.findMany({
      where: { userId: req.params.userId },
      include: { steps: { orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(roadmaps);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /roadmaps/:id
app.get("/roadmaps/:id", async (req, res) => {
  try {
    const roadmap = await prisma.roadmap.findUnique({
      where: { id: req.params.id },
      include: { steps: { orderBy: { createdAt: "asc" } } },
    });
    if (!roadmap) return res.status(404).json({ error: "Roadmap not found" });
    res.json(roadmap);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /roadmaps/:id
app.put("/roadmaps/:id", async (req, res) => {
  try {
    const { title } = req.body;
    const roadmap = await prisma.roadmap.update({
      where: { id: req.params.id },
      data: { title },
    });
    res.json(roadmap);
  } catch (err) {
    if (err.code === "P2025")
      return res.status(404).json({ error: "Roadmap not found" });
    res.status(500).json({ error: err.message });
  }
});

// DELETE /roadmaps/:id
app.delete("/roadmaps/:id", async (req, res) => {
  try {
    await prisma.roadmap.delete({ where: { id: req.params.id } });
    res.json({ message: "Roadmap deleted" });
  } catch (err) {
    if (err.code === "P2025")
      return res.status(404).json({ error: "Roadmap not found" });
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// ROADMAP STEPS
// ─────────────────────────────────────────────

// POST /roadmap-steps
app.post("/roadmap-steps", async (req, res) => {
  try {
    const { title, description, status, progress, roadmapId } = req.body;
    if (!title || !roadmapId)
      return res
        .status(400)
        .json({ error: "title and roadmapId are required" });

    const step = await prisma.roadmapStep.create({
      data: {
        title,
        description,
        status: status ?? "PENDING",
        progress: progress ?? 0,
        roadmapId,
      },
    });
    res.status(201).json(step);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /roadmap-steps/:roadmapId
app.get("/roadmap-steps/:roadmapId", async (req, res) => {
  try {
    const steps = await prisma.roadmapStep.findMany({
      where: { roadmapId: req.params.roadmapId },
      orderBy: { createdAt: "asc" },
    });
    res.json(steps);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /roadmap-steps/:id
app.put("/roadmap-steps/:id", async (req, res) => {
  try {
    const { title, description, status, progress } = req.body;
    const step = await prisma.roadmapStep.update({
      where: { id: req.params.id },
      data: { title, description, status, progress },
    });
    res.json(step);
  } catch (err) {
    if (err.code === "P2025")
      return res.status(404).json({ error: "Step not found" });
    res.status(500).json({ error: err.message });
  }
});

// DELETE /roadmap-steps/:id
app.delete("/roadmap-steps/:id", async (req, res) => {
  try {
    await prisma.roadmapStep.delete({ where: { id: req.params.id } });
    res.json({ message: "Step deleted" });
  } catch (err) {
    if (err.code === "P2025")
      return res.status(404).json({ error: "Step not found" });
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// AI — GEMINI ROADMAP GENERATOR
// ─────────────────────────────────────────────

// POST /ai/generate-roadmap
app.post("/ai/generate-roadmap", async (req, res) => {
  try {
    const { userId, title, currentSkills } = req.body;
    if (!userId || !title)
      return res.status(400).json({ error: "userId and title are required" });

    const skillsText =
      currentSkills && currentSkills.length > 0
        ? `The user already knows: ${currentSkills.join(", ")}.`
        : "The user is a beginner with no prior skills listed.";

    const prompt = `
You are a career advisor. A user wants to achieve this career goal: "${title}".
${skillsText}

Generate a practical step-by-step career roadmap with exactly 6 steps.
Respond ONLY with a valid JSON array, no explanation, no markdown, no backticks.
Format:
[
  { "title": "Step title", "description": "What to learn or do in 1-2 sentences" },
  ...
]
    `.trim();

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const clean = text.replace(/```json|```/g, "").trim();
    const steps = JSON.parse(clean);

    const roadmap = await prisma.roadmap.create({
      data: { title, userId },
    });

    const savedSteps = await Promise.all(
      steps.map((step) =>
        prisma.roadmapStep.create({
          data: {
            title: step.title,
            description: step.description,
            status: "PENDING",
            progress: 0,
            roadmapId: roadmap.id,
          },
        }),
      ),
    );

    res.status(201).json({
      message: "Roadmap generated by Gemini AI",
      roadmap: { ...roadmap, steps: savedSteps },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// AI — GEMINI COVER LETTER GENERATOR
// ─────────────────────────────────────────────

// POST /ai/generate-cover-letter
app.post("/ai/generate-cover-letter", async (req, res) => {
  try {
    const { userName, jobTitle, company, skills, experience } = req.body;
    if (!userName || !jobTitle || !company)
      return res
        .status(400)
        .json({ error: "userName, jobTitle and company are required" });

    const skillsText =
      skills && skills.length > 0
        ? `Their skills include: ${skills.join(", ")}.`
        : "";
    const expText = experience ? `Experience: ${experience}.` : "";

    const prompt = `
Write a professional cover letter for ${userName} applying for the role of ${jobTitle} at ${company}.
${skillsText}
${expText}
Keep it concise (3 paragraphs), professional, and enthusiastic.
Respond ONLY with the cover letter text, no subject line, no extra commentary.
    `.trim();

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(prompt);
    const coverLetter = result.response.text().trim();

    res.status(200).json({
      message: "Cover letter generated by Gemini AI",
      coverLetter,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// AI — GEMINI INTERVIEW QUESTIONS GENERATOR
// ─────────────────────────────────────────────

// POST /ai/generate-interview-questions
app.post("/ai/generate-interview-questions", async (req, res) => {
  try {
    const { jobTitle, skills, difficulty } = req.body;
    if (!jobTitle)
      return res.status(400).json({ error: "jobTitle is required" });

    const skillsText =
      skills && skills.length > 0
        ? `Focus on these skills: ${skills.join(", ")}.`
        : "";
    const level = difficulty || "intermediate";

    const prompt = `
Generate 8 ${level}-level interview questions for a ${jobTitle} position.
${skillsText}
Mix technical and behavioral questions.
Respond ONLY with a valid JSON array, no explanation, no markdown, no backticks.
Format:
[
  { "type": "technical" or "behavioral", "question": "The question text", "tip": "A short answer tip in 1 sentence" },
  ...
]
    `.trim();

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const clean = text.replace(/```json|```/g, "").trim();
    const questions = JSON.parse(clean);

    res.status(200).json({
      message: "Interview questions generated by Gemini AI",
      questions,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// SERVER
// ─────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Career Tracker API running on port ${PORT}`),
);
