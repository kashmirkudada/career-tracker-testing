require("dotenv").config();
const express = require("express");
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const PDFParser = require("pdf2json");
const axios = require("axios");

const app = express();
const prisma = new PrismaClient();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

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

/**
 * Robust helper to call Gemini with a fallback model if the primary is overloaded.
 */
async function generateWithFallback(
  prompt,
  primaryModel = "gemini-3.5-flash",
  fallbackModel = "gemini-3.1-flash-lite",
) {
  try {
    const model = genAI.getGenerativeModel({ model: primaryModel });
    const result = await model.generateContent(prompt);
    return result;
  } catch (err) {
    // Check if the error is related to high demand (503) or overload
    const errMsg = err.message ? err.message.toLowerCase() : "";
    if (
      errMsg.includes("503") ||
      errMsg.includes("high demand") ||
      errMsg.includes("overloaded") ||
      errMsg.includes("temporarily unavailable")
    ) {
      console.warn(
        `Primary model ${primaryModel} overloaded, falling back to ${fallbackModel}`,
      );
      const model = genAI.getGenerativeModel({ model: fallbackModel });
      return await model.generateContent(prompt);
    }
    throw err; // Re-throw if it's a different kind of error
  }
}

// ─────────────────────────────────────────────
// AUTH / USER
// ─────────────────────────────────────────────

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

app.post("/resumes/upload", upload.single("resume"), async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId is required" });
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "resumes", resource_type: "raw" },
        (err, result) => (err ? reject(err) : resolve(result)),
      );
      stream.end(req.file.buffer);
    });

    let extractedText = "";
    await new Promise((resolve) => {
      const pdfParser = new PDFParser();
      pdfParser.on("pdfParser_dataError", (errData) => {
        console.error("pdf2json Error:", errData.parserError);
        extractedText = "Could not extract text from PDF";
        resolve();
      });
      pdfParser.on("pdfParser_dataReady", (pdfData) => {
        try {
          const pagesText = [];
          for (const page of pdfData.Pages) {
            const pageLines = [];
            for (const textObj of page.Texts) {
              if (textObj.R && Array.isArray(textObj.R)) {
                const runText = textObj.R.map((r) => {
                  try {
                    return decodeURIComponent(r.T || "");
                  } catch {
                    return r.T || "";
                  }
                }).join("");
                pageLines.push(runText);
              }
            }
            pagesText.push(pageLines.join(" "));
          }
          extractedText = pagesText.join("\n").trim();
        } catch (parseError) {
          console.error("Structural processing error:", parseError);
          extractedText = "Could not extract text from PDF";
        }
        resolve();
      });
      pdfParser.parseBuffer(req.file.buffer);
    });

    if (!extractedText || extractedText === "Could not extract text from PDF") {
      return res.status(422).json({
        error:
          "The file text structure could not be parsed. Please verify this is a non-encrypted, text-based PDF document.",
      });
    }

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

    const result = await generateWithFallback(prompt);
    const rawText = result.response
      .text()
      .replace(/```json|```/g, "")
      .trim();
    const analysis = JSON.parse(rawText);

    const resume = await prisma.resume.create({
      data: {
        fileName: req.file.originalname,
        fileUrl: uploadResult.secure_url,
        atsScore: analysis.atsScore,
        userId,
      },
    });

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

    const parsedAnalysis = parseAnalysis(savedAnalysis);

    res.status(201).json({
      message: "Resume uploaded and analyzed",
      resume: {
        ...resume,
        analysis: {
          ...parsedAnalysis,
          formatScore: parsedAnalysis.formattingScore,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/resumes/cover-letter", async (req, res) => {
  try {
    const { userId, jobTitle, company, jobDescription } = req.body;
    if (!userId || !jobTitle || !company)
      return res
        .status(400)
        .json({ error: "userId, jobTitle and company are required" });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { skills: { include: { skill: true } } },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    const skillsText =
      user.skills.length > 0
        ? `Their skills include: ${user.skills.map((s) => s.skill.name).join(", ")}.`
        : "";
    const descText = jobDescription ? `Job Description: ${jobDescription}` : "";

    const prompt = `
Write a professional cover letter for ${user.name} applying for the role of ${jobTitle} at ${company}.
${skillsText}
${descText}
Keep it concise (3 paragraphs), professional, and enthusiastic.
Respond ONLY with the cover letter text, no subject line, no extra commentary.
    `.trim();

    const result = await generateWithFallback(prompt);
    const coverLetter = result.response.text().trim();

    res.status(200).json({ message: "Cover letter generated", coverLetter });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/resumes/interview-prep", async (req, res) => {
  try {
    const { userId, jobDescription } = req.body;
    if (!userId || !jobDescription)
      return res
        .status(400)
        .json({ error: "userId and jobDescription are required" });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { skills: { include: { skill: true } } },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    const skillsText =
      user.skills.length > 0
        ? `Candidate skills: ${user.skills.map((s) => s.skill.name).join(", ")}.`
        : "";

    const prompt = `
Generate 15 intermediate-level interview questions for this job description:
"${jobDescription}"
${skillsText}
Mix technical and behavioral questions (roughly 60% technical, 40% behavioral).
Respond ONLY with a valid JSON array, no explanation, no markdown, no backticks.
Format:
[
  { "type": "technical" or "behavioral", "question": "The question text", "idealAnswerGuideline": "A short answer tip in 1 sentence" }
]
    `.trim();

    const result = await generateWithFallback(prompt);
    const clean = result.response
      .text()
      .replace(/```json|```/g, "")
      .trim();
    const interviewPrep = JSON.parse(clean);

    res
      .status(200)
      .json({ message: "Interview prep generated", interviewPrep });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

app.get("/resumes/user/:userId", async (req, res) => {
  try {
    const resumes = await prisma.resume.findMany({
      where: { userId: req.params.userId },
      include: { analysis: true },
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

app.get("/resumes/:id", async (req, res) => {
  try {
    const resume = await prisma.resume.findUnique({
      where: { id: req.params.id },
      include: { analysis: true },
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

app.get("/skills", async (req, res) => {
  try {
    const skills = await prisma.skill.findMany({ orderBy: { name: "asc" } });
    res.json(skills);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/skills/assign", async (req, res) => {
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

app.get("/jobs/matches/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const userData = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        resumes: { orderBy: { createdAt: "desc" }, take: 1 },
        skills: { include: { skill: true } },
      },
    });

    if (!userData || userData.resumes.length === 0) {
      return res.status(404).json({
        error: "Please upload a resume first to extract qualifications.",
      });
    }

    const latestResume = userData.resumes[0];
    const parsedSkills =
      userData.skills.map((s) => s.skill.name).join(", ") || "Developer skills";
    const userLocationQuery = req.query.location || "India";

    const localJobs = await prisma.job.findMany({
      orderBy: { createdAt: "desc" },
    });

    const structuredLocalJobs = localJobs.map((job) => ({
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
      description: job.description || "No description specified.",
      applyLink: "Internal Application System",
      source: "Local Database",
    }));

    let internetJobs = [];
    if (process.env.USE_LIVE_JOBS === "true") {
      try {
        const apiResponse = await axios.get(
          "https://jsearch.p.rapidapi.com/search",
          {
            params: {
              query: `${parsedSkills.split(",")[0].trim()} jobs in ${userLocationQuery}`,
              page: "1",
              num_pages: "2",
              date_posted: "week",
            },
            headers: {
              "X-RapidAPI-Key": process.env.RAPIDAPI_KEY,
              "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
            },
          },
        );

        if (apiResponse.data && apiResponse.data.data) {
          internetJobs = apiResponse.data.data.slice(0, 15).map((j) => ({
            id: j.job_id,
            title: j.job_title,
            company: j.employer_name,
            location:
              `${j.job_city || ""} ${j.job_country || ""}`.trim() || "Remote",
            description: (
              j.job_description || "No description available."
            ).slice(0, 500),
            applyLink: j.job_apply_link,
            source: "Internet Web Scrape",
          }));
        }
      } catch (apiErr) {
        console.error("JSearch API error:", apiErr.message);
      }
    } else {
      internetJobs = [
        {
          id: "mock-internet-1",
          title: "React Developer",
          company: "Global Development Agency",
          location: "Remote",
          description:
            "Seeking a frontend developer proficient in JavaScript, React, and modern CSS layout stacks.",
          applyLink: "https://example.com/apply-mock",
          source: "Mock Internet File",
        },
        {
          id: "mock-internet-2",
          title: "Full Stack Developer",
          company: "Tech Startup Inc",
          location: "Remote",
          description:
            "Looking for a full stack developer with Node.js, Express, and React experience.",
          applyLink: "https://example.com/apply-mock-2",
          source: "Mock Internet File",
        },
      ];
    }

    const combinedJobListings = [...structuredLocalJobs, ...internetJobs];

    if (combinedJobListings.length === 0) {
      return res
        .status(200)
        .json({ message: "No jobs available for matching.", matches: [] });
    }

    const evaluationPrompt = `
You are an advanced recruitment matching engine. Rank these jobs against the candidate's profile.

Candidate Profile:
Known Skills: ${parsedSkills}
ATS Score: ${latestResume.atsScore}/100

Available Job Listings:
${JSON.stringify(combinedJobListings.map((j) => ({ id: j.id, title: j.title, description: j.description })))}

Evaluate suitability on a scale from 0 to 100 based on how well the candidate matches each job.
Respond ONLY with a valid JSON array, no markdown, no backticks.
Format:
[
  { "id": "job_id_here", "score": 92, "reason": "One sentence explaining the match." }
]
    `.trim();

    const aiResponse = await generateWithFallback(evaluationPrompt);
    const cleanedText = aiResponse.response
      .text()
      .replace(/```json|```/g, "")
      .trim();
    const scoredList = JSON.parse(cleanedText);

    const finalRankedMatches = scoredList
      .map((scoreItem) => {
        const originalDetails = combinedJobListings.find(
          (j) => j.id === scoreItem.id,
        );
        if (!originalDetails) return null;
        return {
          ...originalDetails,
          matchScore: scoreItem.score,
          matchReason: scoreItem.reason,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.matchScore - a.matchScore);

    res.status(200).json({
      totalAnalyzed: finalRankedMatches.length,
      matches: finalRankedMatches,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
// JOB MATCHES (saved to DB)
// ─────────────────────────────────────────────

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

app.post("/roadmaps/generate-ai", async (req, res) => {
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

    const result = await generateWithFallback(prompt);
    const clean = result.response
      .text()
      .replace(/```json|```/g, "")
      .trim();
    const steps = JSON.parse(clean);

    const roadmap = await prisma.roadmap.create({ data: { title, userId } });

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

app.post("/ai/generate-roadmap", async (req, res) => {
  req.url = "/roadmaps/generate-ai";
  app.handle(req, res);
});

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

app.post("/roadmaps/step", async (req, res) => {
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
// SERVER
// ─────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Career Tracker API running on port ${PORT}`),
);
