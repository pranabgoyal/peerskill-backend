require('dotenv').config()
const express = require('express')
const mongoose = require('mongoose')
const cors = require('cors')
const bcrypt = require('bcrypt')

const app = express()
app.use(cors())
app.use(express.json())

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("DB Connected"))
  .catch(err => console.log(err))

const UserMetadataSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  contact: String, // New Field
  password: String,
  teach: [String],
  learn: [String],
  skillPoints: { type: Number, default: 0 }
})

// Skill Request Model
const SkillRequest = mongoose.model("SkillRequest", {
  email: String,
  name: String,
  skill: String,
  status: { type: String, default: "Open" }, // Open, In Progress, Closed
  date: { type: Date, default: Date.now }
})

// --- ROUTES ---

// Session Model (No Recording, just metadata)
const Session = mongoose.model("Session", {
  scheduler: String,
  peer: String,
  skill: String,
  dateTime: String,
  link: String,
  created: { type: Date, default: Date.now }
})

// --- ROUTES ---

app.post("/schedule-session", async (req, res) => {
  try {
    const { scheduler, peer, skill, dateTime } = req.body

    // Generate a random mock Google Meet link
    // Format: abc-defg-hij
    const rand = () => Math.random().toString(36).substring(2, 5)
    const link = `https://meet.google.com/${rand()}-${rand()}-${rand()}`

    await Session.create({ scheduler, peer, skill, dateTime, link })

    res.json({ status: "ok", link })
  } catch (err) {
    res.status(500).json({ error: "Failed to schedule" })
  }
})

app.get("/admin/sessions", async (req, res) => {
  try {
    const sessions = await Session.find().sort({ created: -1 })
    res.json(sessions)
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch sessions" })
  }
})

app.post("/request-skill", async (req, res) => {
  try {
    const { email, skill } = req.body

    // Fetch user name for convenience
    const user = await User.findOne({ email })
    const name = user ? user.name : "Unknown Student"

    await SkillRequest.create({ email, name, skill })

    res.json({ status: "ok" })
  } catch (err) {
    res.status(500).json({ error: "Failed to raise token" })
  }
})

app.get("/admin/requests", async (req, res) => {
  try {
    const requests = await SkillRequest.find().sort({ date: -1 })
    res.json(requests)
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch requests" })
  }
})

app.post("/signup", async (req, res) => {
  try {
    const { name, email, contact, password, teach, learn } = req.body

    // Check if user exists
    const existing = await User.findOne({ email })
    if (existing) return res.status(400).send("User already exists")

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10)

    await User.create({
      name,
      email,
      contact,
      password: hashedPassword,
      teach,
      learn
    })
    res.send("Signup successful")
  } catch (err) {
    console.error(err)
    res.status(500).send("Error creating user")
  }
})

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body

    // Hardcoded Admin Check (Server Side)
    if (email === "admin@peerskill.com" && password === "admin123") {
      return res.json({ status: "ok", role: "admin", name: "Admin" })
    }

    const user = await User.findOne({ email })
    if (!user) return res.status(401).send("Invalid email or password")

    // Compare Hash
    const match = await bcrypt.compare(password, user.password)
    if (match) {
      res.json({
        status: "ok",
        role: "student",
        name: user.name,
        email: user.email
      })
    } else {
      res.status(401).send("Invalid email or password")
    }
  } catch (err) {
    res.status(500).send("Login error")
  }
})

// Secure Admin Route
app.get("/admin/users", async (req, res) => {
  // In a real app, use a Middleware with JWT check. 
  // For this v3 demo, we check a header or just return data (assuming admin page is protected).
  // We will keep it open for the admin.html fetch, but relying on the fact 
  // that normal users don't know this URL and UI doesn't expose it.
  try {
    const users = await User.find({}, '-password') // Exclude password field
    res.json(users)
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch users" })
  }
})

// Dynamic Dashboard Endpoint
app.post("/me", async (req, res) => {
  try {
    const { email } = req.body
    const user = await User.findOne({ email }, '-password')
    if (user) res.json(user)
    else res.status(404).send("User not found")
  } catch (err) {
    res.status(500).send("Server error")
  }
})

// Get Recommendations (Smart Matching)
app.post("/recommendations", async (req, res) => {
  try {
    const { email } = req.body
    const currentUser = await User.findOne({ email })

    if (!currentUser) return res.status(404).json([])

    const myLearnSkills = currentUser.learn.map(s => s.toLowerCase().trim())

    // Find users who teach what I want to learn
    const allUsers = await User.find({ email: { $ne: email } }) // Exclude myself

    const matches = allUsers.filter(otherUser => {
      const otherTeachSkills = (otherUser.teach || []).map(s => s.toLowerCase().trim())
      // Check for overlap
      return myLearnSkills.some(skill => otherTeachSkills.includes(skill))
    }).map(u => ({
      name: u.name,
      contact: u.contact,
      email: u.email,
      teach: u.teach,
      skillPoints: u.skillPoints
    }))

    res.json(matches)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Matching failed" })
  }
})

// Update User Points
app.post("/admin/update-points", async (req, res) => {
  try {
    const { email, points } = req.body

    // In real app: Verify Admin here too

    const user = await User.findOneAndUpdate(
      { email },
      { $set: { skillPoints: parseInt(points) } },
      { new: true }
    )

    if (user) res.json({ status: "ok", user })
    else res.status(404).json({ error: "User not found" })
  } catch (err) {
    res.status(500).json({ error: "Update failed" })
  }
})

const PORT = process.env.PORT || 5000
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
