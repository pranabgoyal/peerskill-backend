require('dotenv').config()
const express = require('express')
const mongoose = require('mongoose')
const cors = require('cors')
const bcrypt = require('bcrypt')

const jwt = require('jsonwebtoken')
const JWT_SECRET = process.env.JWT_SECRET || "peerskill_secret_key_123"

const app = express()
app.use(cors())
app.use(express.json())

// Database Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("DB Connected"))
  .catch(err => console.error("DB Error", err))

const ADMIN_EMAIL = "admin@peerskill.com"
const ADMIN_PASS = "admin123"

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

const sessionSchema = new mongoose.Schema({
  scheduler: String,
  peer: String,
  skill: String,
  dateTime: String, // "YYYY-MM-DD at HH:MM"
  link: String
})
const Session = mongoose.model("Session", sessionSchema)

const notificationSchema = new mongoose.Schema({
  recipient: String, // email
  message: String,
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
})
const Notification = mongoose.model("Notification", notificationSchema)

// ================= MIDDLEWARE =================
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1] // Bearer TOKEN

  if (!token) return res.sendStatus(401)

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403)
    req.user = user // { email, role }
    next()
  })
}

const authorizeAdmin = (req, res, next) => {
  authenticateToken(req, res, () => {
    if (req.user.role === 'admin') {
      next()
    } else {
      res.sendStatus(403)
    }
  })
}

// ================= API ROUTES =================

app.get("/", (req, res) => {
  res.send("PeerSkill V3 Backend Running")
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

    // Auto-login after signup? For now just success.
    // Ideally return token here too, but let's stick to flow: Signup -> Login
    res.send("Signup successful")
  } catch (err) {
    console.error("Signup Error:", err)
    res.status(500).send("Error creating user")
  }
})

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body

    // ADMIN LOGIN
    if (email === ADMIN_EMAIL && password === ADMIN_PASS) {
      const token = jwt.sign({ email, role: 'admin' }, JWT_SECRET, { expiresIn: '24h' })
      return res.json({ status: "ok", role: "admin", name: "Admin", token })
    }

    // Use regex for case-insensitive lookup
    const user = await User.findOne({ email: { $regex: new RegExp(`^${email}$`, 'i') } })
    if (!user) {
      return res.status(401).send("Invalid email or password")
    }

    const match = await bcrypt.compare(password, user.password)
    if (match) {
      const token = jwt.sign({ email: user.email, role: 'student' }, JWT_SECRET, { expiresIn: '24h' })
      return res.json({ status: "ok", role: "student", name: user.name, email: user.email, token })
    } else {
      return res.status(401).send("Invalid email or password")
    }
  } catch (err) {
    res.status(500).send("Error")
  }
})

// --- PEER RATING SYSTEM ---
app.post("/rate-peer", authenticateToken, async (req, res) => {
  try {
    const { targetEmail, rating } = req.body
    const raterEmail = req.user.email

    if (targetEmail === raterEmail) return res.status(400).json({ status: "error", error: "Cannot rate yourself" })
    if (rating < 1 || rating > 5) return res.status(400).json({ status: "error", error: "Invalid rating" })

    // Give points: Base 10 points per rating for simplicity
    // In real app we would check if session exists
    const user = await User.findOne({ email: targetEmail })
    if (!user) return res.status(404).json({ error: "User not found" })

    user.skillPoints = (user.skillPoints || 0) + 10
    await user.save()

    // Notify
    await Notification.create({
      recipient: targetEmail,
      message: `You received a ${rating}-star rating! +10 Skill Points.`
    })

    res.json({ status: "ok" })
  } catch (e) {
    res.status(500).json({ status: "error", error: "Server Error" })
  }
})
// --- DASHBOARD & USER DATA (Protected) ---

app.post("/me", authenticateToken, async (req, res) => {
  try {
    // Rely on token, but also check if body matches (optional, but good)
    // Actually, stick to body.email for logic, but verify against req.user.email
    if (req.body.email !== req.user.email && req.user.role !== 'admin') {
      return res.status(403).json({ error: "Unauthorized access to profile" })
    }

    const user = await User.findOne({ email: req.body.email }).select("-password")
    if (user) res.json(user)
    else res.status(404).json({ error: "User not found" })
  } catch (err) {
    res.status(500).json({ error: "Server error" })
  }
})

app.post("/update-profile", authenticateToken, async (req, res) => {
  try {
    const { email, name, contact, studyYear, branch, teach, learn, avatar } = req.body

    // SECURITY CHECK: User can only update their own profile
    if (email !== req.user.email && req.user.role !== 'admin') {
      return res.status(403).json({ error: "Unauthorized update" })
    }

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

// Smart Peer Recommendations (Protected)
app.post("/recommendations", authenticateToken, async (req, res) => {
  try {
    const { email } = req.body
    const currentUser = await User.findOne({ email })
    if (!currentUser || !currentUser.learn) return res.json([])

    const learnSkills = currentUser.learn.map(s => new RegExp(s, 'i'))

    const matches = await User.find({
      email: { $ne: email },
      teach: { $in: learnSkills }
    }).select("name teach contact email skillPoints avatar")

    res.json(matches)
  } catch (err) {
    res.status(500).json([])
  }
})

// Get Random Peers (Protected)
app.post("/peers/random", authenticateToken, async (req, res) => {
  try {
    const { email } = req.body
    const allUsers = await User.find({ email: { $ne: email } }).select("name teach learn skillPoints email studyYear branch avatar")
    const shuffled = allUsers.sort(() => 0.5 - Math.random())
    res.json(shuffled.slice(0, 5))
  } catch (err) {
    res.status(500).json([])
  }
})

// Search Peers (Protected)
app.post("/peers/search", authenticateToken, async (req, res) => {
  try {
    const { email, query } = req.body
    if (!query) return res.json([])

    const regex = new RegExp(query, 'i')

    const matches = await User.find({
      email: { $ne: email },
      $or: [
        { name: regex },
        { teach: { $in: [regex] } },
        { branch: regex },
        { studyYear: regex }
      ]
    }).select("name teach learn skillPoints email studyYear branch avatar")

    res.json(matches)
  } catch (err) {
    res.status(500).json([])
  }
})

// --- FEATURES (Protected) ---

app.post("/request-skill", authenticateToken, async (req, res) => {
  try {
    const { email, skill } = req.body
    // Check if sending email matches token
    if (email !== req.user.email) return res.status(403).json({ status: "error" })

    const user = await User.findOne({ email })
    if (!user) return res.status(404).json({ error: "User not found" })

    await SkillRequest.create({ email, name: user.name, skill })
    res.json({ status: "ok" })
  } catch (err) {
    res.status(500).json({ status: "error" })
  }
})

app.post("/rate-peer", authenticateToken, async (req, res) => {
  // Anyone with a token can rate for now (logic improvement: verify session existed)
  try {
    const { peerEmail, rating } = req.body
    const user = await User.findOne({ email: peerEmail })
    if (!user) return res.status(404).json({ error: "User not found" })

    const currentRating = user.rating || 0
    const currentReviews = user.reviews || 0
    const newRating = ((currentRating * currentReviews) + parseFloat(rating)) / (currentReviews + 1)
    const bonus = 10

    user.rating = newRating.toFixed(1)
    user.reviews = currentReviews + 1
    user.skillPoints = (user.skillPoints || 0) + bonus

    await user.save()
    res.json({ status: "ok", newPoints: user.skillPoints })
  } catch (err) {
    res.status(500).json({ error: "Rating failed" })
  }
})

app.post("/schedule-session", authenticateToken, async (req, res) => {
  try {
    const { scheduler, peer, skill, dateTime } = req.body

    if (scheduler !== req.user.email) return res.status(403).json({ error: "Identity Mismatch" })

    const rand = () => Math.random().toString(36).substring(2, 6)
    const link = `https://meet.jit.si/PeerSkill-${rand()}-${rand()}-${Date.now()}`

    await Session.create({ scheduler, peer, skill, dateTime, link })
    res.json({ status: "ok", link })
  } catch (err) {
    res.status(500).json({ error: "Failed to schedule" })
  }
})

app.post("/my-sessions", authenticateToken, async (req, res) => {
  try {
    const { email } = req.body
    if (email !== req.user.email) return res.status(403).json([])

    const sessions = await Session.find({
      $or: [{ scheduler: email }, { peer: email }]
    }).sort({ dateTime: 1 })
    res.json(sessions)
  } catch (err) {
    res.status(500).json([])
  }
})

// --- ADMIN ROUTES (Protected by authorizeAdmin) ---

app.get("/admin/users", authorizeAdmin, async (req, res) => {
  try {
    const users = await User.find().select("-password")
    res.json(users)
  } catch (err) {
    res.status(500).json([])
  }
})

app.get("/admin/requests", authorizeAdmin, async (req, res) => {
  try {
    const requests = await SkillRequest.find().sort({ date: -1 })
    res.json(requests)
  } catch (err) {
    res.status(500).json([])
  }
})

// Public accessible requests (for Dashboard) BUT we can protect it too if we want
// Dashboard needs it. Dashboard has token. So protect it.
app.get("/active-requests", authenticateToken, async (req, res) => {
  try {
    const requests = await SkillRequest.find({ status: "Open" }).sort({ date: -1 }).limit(20)
    res.json(requests)
  } catch (err) {
    res.status(500).json([])
  }
})

app.get("/admin/sessions", authorizeAdmin, async (req, res) => {
  try {
    const sessions = await Session.find().sort({ created: -1 })
    res.json(sessions)
  } catch (err) {
    res.status(500).json([])
  }
})

app.delete("/admin/user", authorizeAdmin, async (req, res) => {
  try {
    const { email } = req.body
    await User.deleteOne({ email })
    await SkillRequest.deleteMany({ email })
    await Session.deleteMany({ $or: [{ scheduler: email }, { peer: email }] })
    await Notification.deleteMany({ recipient: email })
    res.json({ status: "ok" })
  } catch (err) {
    res.status(500).json({ error: "Failed delete" })
  }
})

app.post("/admin/update-points", authorizeAdmin, async (req, res) => {
  try {
    const { email, points } = req.body
    await User.findOneAndUpdate({ email }, { skillPoints: points })
    res.json({ status: "ok" })
  } catch (e) { res.status(500).json({ error: "Error" }) }
})


// Notifications
app.post("/notifications", authenticateToken, async (req, res) => {
  // Return user notifications
  try {
    const { email } = req.body
    if (email !== req.user.email) return res.json([])
    const n = await Notification.find({ recipient: email, read: false })
    res.json(n)
  } catch (e) { res.json([]) }
})

app.post("/notifications/mark-read", authenticateToken, async (req, res) => {
  try {
    const { ids } = req.body
    await Notification.updateMany({ _id: { $in: ids } }, { read: true })
    res.json({ status: "ok" })
  } catch (e) { res.json({ status: "error" }) }
})

app.get("/peers/leaderboard", authenticateToken, async (req, res) => {
  try {
    const leaders = await User.find().sort({ skillPoints: -1 }).limit(5).select("name skillPoints studyYear branch")
    res.json(leaders)
  } catch (err) {
    res.status(500).json([])
  }
})

const PORT = process.env.PORT || 5000
app.listen(PORT, () => console.log(`Server running on port ${PORT}`))
