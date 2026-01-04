require('dotenv').config()
const express = require('express')
const mongoose = require('mongoose')
const cors = require('cors')
const bcrypt = require('bcrypt')

const app = express()
app.use(cors())
app.use(express.json())

// Database Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("DB Connected"))
  .catch(err => console.log("DB Error", err))

// ================= SCHEMA DEFINITIONS =================

const UserMetadataSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  contact: String,
  password: String,
  teach: [String],
  learn: [String],
  skillPoints: { type: Number, default: 0 }
})
const User = mongoose.model("UserMetadata", UserMetadataSchema)

const SkillRequest = mongoose.model("SkillRequest", {
  email: String,
  name: String,
  skill: String,
  status: { type: String, default: "Open" }, // Open, In Progress, Closed
  date: { type: Date, default: Date.now }
})

const Session = mongoose.model("Session", {
  scheduler: String,
  peer: String,
  skill: String,
  dateTime: String,
  link: String,
  created: { type: Date, default: Date.now }
})

// ================= API ROUTES =================

app.get("/", (req, res) => {
  res.send("PeerSkill Backend Running v3.0")
})

// --- AUTHENTICATION ---

app.post("/signup", async (req, res) => {
  try {
    const { name, email, contact, password, teach, learn } = req.body

    // Check existing
    if (await User.findOne({ email })) {
      return res.status(400).send("User already exists")
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    await User.create({ name, email, contact, password: hashedPassword, teach, learn })

    res.send("Signup successful")
  } catch (err) {
    console.error("Signup Error:", err)
    res.status(500).send("Error creating user")
  }
})

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body

    // HARDCODED ADMIN LOGIN
    if (email === "admin@peerskill.com" && password === "admin123") {
      return res.json({ status: "ok", role: "admin", name: "Admin" })
    }

    // Use regex for case-insensitive lookup
    const user = await User.findOne({ email: { $regex: new RegExp(`^${email}$`, 'i') } })
    if (!user) {
      console.log("User not found (case-insensitive search)")
      return res.status(401).send("Invalid email or password")
    }

    const match = await bcrypt.compare(password, user.password)
    if (match) {
      return res.json({ status: "ok", role: "student", name: user.name, email: user.email })
    } else {
      return res.status(401).send("Invalid email or password")
    }
  } catch (err) {
    console.error("Login Error:", err)
    res.status(500).send("Login error")
  }
})

// --- DASHBOARD & USER DATA ---

app.post("/me", async (req, res) => {
  try {
    const user = await User.findOne({ email: req.body.email }).select("-password")
    if (user) res.json(user)
    else res.status(404).json({ error: "User not found" })
  } catch (err) {
    res.status(500).json({ error: "Server error" })
  }
})

// Smart Peer Recommendations
app.post("/recommendations", async (req, res) => {
  try {
    const { email } = req.body
    const currentUser = await User.findOne({ email })
    if (!currentUser || !currentUser.learn) return res.json([])

    // Normalize skills to regex for flexible matching
    const learnSkills = currentUser.learn.map(s => new RegExp(s, 'i'))

    // Find users who teach what I want to learn
    const matches = await User.find({
      email: { $ne: email },
      teach: { $in: learnSkills }
    }).select("name teach contact email skillPoints")

    res.json(matches)
  } catch (err) {
    console.error("Reco Error:", err)
    res.status(500).json([])
  }
})

// --- FEATURES ---

app.post("/request-skill", async (req, res) => {
  try {
    const { email, skill } = req.body
    console.log(`Received Token Request from: ${email} for skill: ${skill}`)

    const user = await User.findOne({ email })
    if (!user) {
      console.log("Token Request failed: User not found")
      return res.status(404).json({ error: "User not found" })
    }

    await SkillRequest.create({
      email,
      name: user.name,
      skill
    })

    console.log("Token saved successfully")
    res.json({ status: "ok" })
  } catch (err) {
    console.error("Token Request Error:", err)
    res.status(500).json({ status: "error" })
  }
})

app.post("/schedule-session", async (req, res) => {
  try {
    const { scheduler, peer, skill, dateTime } = req.body
    console.log(`Scheduling Session: ${scheduler} with ${peer} at ${dateTime}`)

    // Generate mock meeting link
    const rand = () => Math.random().toString(36).substring(2, 5)
    const link = `https://meet.google.com/${rand()}-${rand()}-${rand()}`

    await Session.create({ scheduler, peer, skill, dateTime, link })

    console.log(`Session Scheduled! Link: ${link}`)
    res.json({ status: "ok", link })
  } catch (err) {
    console.error("Schedule Error:", err)
    res.status(500).json({ error: "Failed to schedule" })
  }
})

// --- ADMIN ROUTES ---

app.get("/admin/users", async (req, res) => {
  try {
    const users = await User.find().select("-password")
    res.json(users)
  } catch (err) {
    res.status(500).json([])
  }
})

app.get("/admin/requests", async (req, res) => {
  try {
    const requests = await SkillRequest.find().sort({ date: -1 })
    res.json(requests)
  } catch (err) {
    res.status(500).json([])
  }
})

app.get("/admin/sessions", async (req, res) => {
  try {
    const sessions = await Session.find().sort({ created: -1 })
    res.json(sessions)
  } catch (err) {
    res.status(500).json([])
  }
})

app.post("/admin/update-points", async (req, res) => {
  try {
    const { email, points } = req.body
    await User.findOneAndUpdate({ email }, { skillPoints: parseInt(points) })
    res.json({ status: "ok" })
  } catch (err) {
    res.status(500).json({ error: "Failed update" })
  }
})

const PORT = process.env.PORT || 5000
app.listen(PORT, () => console.log(`Server running on port ${PORT}`))
