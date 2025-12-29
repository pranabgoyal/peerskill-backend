const express = require('express')
const mongoose = require('mongoose')
const cors = require('cors')

const app = express()
app.use(cors())
app.use(express.json())

mongoose.connect(
  "mongodb+srv://Pranab:Pranab4324@database.c6aonfj.mongodb.net/peerskill?retryWrites=true&w=majority"
)
.then(() => console.log("DB Connected"))
.catch(err => console.log(err))

const User = mongoose.model("User", {
  name: String,
  email: String,
  password: String,
  teach: [String],
  learn: [String]
})

app.post("/signup", async (req, res) => {
  await User.create(req.body)
  res.send("Signup saved")
})

app.post("/login", async (req, res) => {
  const user = await User.findOne(req.body)
  if (user) res.send("Login OK")
  else res.send("Invalid login")
})

/* ✅ ADD THIS ROUTE — THIS IS WHAT WAS MISSING */
app.get("/admin/users", async (req, res) => {
  try {
    const users = await User.find({})
    res.json(users)
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch users" })
  }
})

app.listen(5000, () => {
  console.log("Server running")
})
