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
  studyYear: String,
  branch: String,
  teach: [String],
  learn: [String],
  skillPoints: { type: Number, default: 0 },
  rating: { type: Number, default: 0 },
  reviews: { type: Number, default: 0 },
  avatar: { type: String, default: 'profile_pictures/bot.png' }
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
    const { name, email, contact, password, teach, learn, studyYear, branch, avatar } = req.body

    // Check existing
    if (await User.findOne({ email })) {
      return res.status(400).send("User already exists")
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    await User.create({
      name, email, contact, password: hashedPassword,
      teach, learn, studyYear, branch,
      avatar: avatar || 'profile_pictures/bot.png'
    })

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

app.post("/update-profile", async (req, res) => {
  try {
    const { email, name, contact, studyYear, branch, teach, learn, avatar } = req.body

    // Updates
    const updateData = { name, contact, studyYear, branch, teach, learn }
    if (avatar) updateData.avatar = avatar

    await User.findOneAndUpdate({ email }, updateData)
    res.json({ status: "ok" })
  } catch (err) {
    console.error("Update Error:", err)
    res.status(500).json({ error: "Failed to update profile" })
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
    }).select("name teach contact email skillPoints avatar")

    res.json(matches)
  } catch (err) {
    console.error("Reco Error:", err)
    res.status(500).json([])
  }
})

// Get Random Peers (for "Available Peers" section)
app.post("/peers/random", async (req, res) => {
  try {
    const { email } = req.body

    // Get all users except self
    const allUsers = await User.find({ email: { $ne: email } }).select("name teach learn skillPoints email studyYear branch avatar")

    // Shuffle array (Fisher-Yates or simple random sort)
    const shuffled = allUsers.sort(() => 0.5 - Math.random())

    // Return top 5
    res.json(shuffled.slice(0, 5))
  } catch (err) {
    console.error("Random Peers Error:", err)
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

    res.json({ status: "ok" })
  } catch (err) {
    console.error("Token Request Error:", err)
    res.status(500).json({ status: "error" })
  }
})

app.post("/rate-peer", async (req, res) => {
  try {
    const { peerEmail, rating } = req.body
    const user = await User.findOne({ email: peerEmail })
    if (!user) return res.status(404).json({ error: "User not found" })

    // Calculate new average
    const currentRating = user.rating || 0
    const currentReviews = user.reviews || 0

    // Weighted Average: ((old * N) + new) / (N + 1)
    const newRating = ((currentRating * currentReviews) + parseFloat(rating)) / (currentReviews + 1)

    // Bonus points for getting rated
    const bonus = 10

    user.rating = newRating.toFixed(1)
    user.reviews = currentReviews + 1
    user.skillPoints = (user.skillPoints || 0) + bonus

    await user.save()

    console.log(`Rated ${peerEmail}: New Avg ${user.rating}, Points ${user.skillPoints}`)
    res.json({ status: "ok", newPoints: user.skillPoints })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Rating failed" })
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

    res.json({ status: "ok", link })
  } catch (err) {
    console.error("Schedule Error:", err)
    res.status(500).json({ error: "Failed to schedule" })
  }
})

app.post("/my-sessions", async (req, res) => {
  try {
    const { email } = req.body
    const sessions = await Session.find({
      $or: [{ scheduler: email }, { peer: email }]
    }).sort({ dateTime: 1 }) // Sort by date/time (string sort is basic but works for ISO/consistent formats)
    res.json(sessions)
  } catch (err) {
    res.status(500).json([])
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

app.get("/peers/leaderboard", async (req, res) => {
  try {
    // Top 5 users by points
    const leaders = await User.find().sort({ skillPoints: -1 }).limit(5).select("name skillPoints studyYear branch")
    res.json(leaders)
  } catch (err) {
    res.status(500).json([])
  }
})

app.delete("/admin/user", async (req, res) => {
  try {
    const { email } = req.body
    await User.deleteOne({ email })
    res.json({ status: "ok" })
  } catch (err) {
    res.status(500).json({ error: "Failed delete" })
  }
})

const PORT = process.env.PORT || 5000
app.listen(PORT, () => console.log(`Server running on port ${PORT}`))
