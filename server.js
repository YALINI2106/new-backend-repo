require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const client = require("prom-client");

const app = express();
const PORT = process.env.PORT || 5001;
const SECRET_KEY = process.env.JWT_SECRET || "your-secret-key";

// ================= PROMETHEUS METRICS =================

// Create a Registry to register metrics
const register = new client.Registry();

// Add default metrics (CPU, memory, event loop, etc.)
client.collectDefaultMetrics({ register });

// HTTP request counter
const httpRequestCounter = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status"],
});

// HTTP request duration
const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status"],
  buckets: [0.1, 0.3, 0.5, 1, 1.5, 2, 5],
});

register.registerMetric(httpRequestCounter);
register.registerMetric(httpRequestDuration);


// Middleware
app.use(express.json({ limit: "2mb" }));

// CORS configuration to allow Authorization header
app.use(cors({
  origin: "http://localhost:5173",
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
}));

app.options('*', cors());

// mongoose.connect(process.env.MONGO_URI, {
//   useNewUrlParser: true,
//   useUnifiedTopology: true,
// })


// MongoDB connection
mongoose.connect(process.env.MONGO_URI)

.then(() => console.log("MongoDB Connected"))
.catch((err) => console.error("DB connection error:", err));

// Schemas and Models

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  number: { type: String, required: true },
  password: { type: String, required: true },
});

const User = mongoose.model("User", userSchema);

const blogSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  image: { type: String },
  createdAt: { type: Date, default: Date.now },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
});

const Blog = mongoose.model('Blog', blogSchema);

const mentalHealthAppointmentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  date: { type: Date, required: true },
  time: { type: String, required: true },
  counselorType: { 
    type: String, 
    required: true,
    enum: ['psychologist', 'therapist', 'counselor']
  },
  status: { 
    type: String, 
    default: 'pending',
    enum: ['pending', 'confirmed', 'cancelled']
  },
  createdAt: { type: Date, default: Date.now }
}, { collection: "counseling_appointments" });

const MentalHealthAppointment = mongoose.model("MentalHealthAppointment", mentalHealthAppointmentSchema);

// Authentication middleware
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: 'Authentication required' });

  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Authentication required' });

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};


// Prometheus middleware to track requests
app.use((req, res, next) => {
  const start = Date.now();

  res.on("finish", () => {
    const duration = (Date.now() - start) / 1000;

    httpRequestCounter.inc({
      method: req.method,
      route: req.route?.path || req.path,
      status: res.statusCode,
    });

    httpRequestDuration.observe(
      {
        method: req.method,
        route: req.route?.path || req.path,
        status: res.statusCode,
      },
      duration
    );
  });

  next();
});


// Routes

// Test route
app.get("/", (req, res) => {
  res.send("Server is running");
});

// Signup
app.post("/api/signup", async (req, res) => {
  const { name, email, number, password } = req.body;

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ name, email, number, password: hashedPassword });
    await newUser.save();

    res.status(201).json({ message: "User registered successfully" });
  } catch (err) {
    console.error("Error in registration:", err);
    res.status(500).json({ message: "Error during registration" });
  }
});

// Login
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign({ userId: user._id }, SECRET_KEY, { expiresIn: "1h" });

    res.status(200).json({ message: "Login successful", token });
  } catch (err) {
    console.error("Error in login:", err);
    res.status(500).json({ message: "Server error during login" });
  }
});

// Get all blogs (public)
app.get('/api/blogs', async (req, res) => {
  try {
    const blogs = await Blog.find().populate('author', 'name').sort({ createdAt: -1 });
    res.json(blogs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all jobs
app.get("/api/jobs", async (req, res) => {
  try {
    const jobs = await Job.find().sort({ createdAt: -1 });
    res.json(jobs);
  } catch (err) {
    console.error("Error fetching jobs:", err);
    res.status(500).json({ message: "Error fetching jobs" });
  }
});

// Add a new job
app.post("/api/jobs", async (req, res) => {
  try {
    const { title, company, location, description, type } = req.body;

    if (!title || !company || !location || !description) {
      return res.status(400).json({ message: "All fields except type are required" });
    }

    const newJob = new Job({
      title,
      company,
      location,
      description,
      type: type || "full-time"
    });

    await newJob.save();

    res.status(201).json({ message: "Job added successfully", job: newJob });
  } catch (err) {
    console.error("Error adding job:", err);
    res.status(500).json({ message: "Error adding job" });
  }
});


// Create new blog (protected)
app.post('/api/blogs', authenticate, async (req, res) => {
  console.log("Authenticated userId:", req.userId);
  console.log("Request body:", req.body);

  try {
    const { title, content, image } = req.body;
    if (!title || !content) {
      return res.status(400).json({ message: "Title and content are required" });
    }
    const newBlog = new Blog({
      title,
      content,
      image,
      author: req.userId
    });
    await newBlog.save();
    res.status(201).json(newBlog);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete a blog (protected)
app.delete('/api/blogs/:id', authenticate, async (req, res) => {
  try {
    const blog = await Blog.findOneAndDelete({
      _id: req.params.id,
      author: req.userId
    });
    if (!blog) return res.status(404).json({ message: 'Blog not found' });
    res.json({ message: 'Blog deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create appointment
app.post("/api/appointments", async (req, res) => {
  try {
    const { name, email, phone, date, time, counselorType } = req.body;

    if (!name || !email || !phone || !date || !time) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const appointment = new MentalHealthAppointment({
      name,
      email,
      phone,
      date,
      time,
      counselorType: counselorType || 'psychologist'
    });

    await appointment.save();

    res.status(201).json({
      message: "Appointment scheduled successfully",
      appointment: {
        id: appointment._id,
        name: appointment.name,
        date: appointment.date,
        time: appointment.time,
        counselorType: appointment.counselorType
      }
    });
  } catch (error) {
    console.error("Error creating appointment:", error);
    res.status(500).json({ message: "Error scheduling appointment" });
  }
});

// Get all appointments
app.get("/api/appointments", async (req, res) => {
  try {
    const appointments = await MentalHealthAppointment.find()
      .sort({ date: 1, time: 1 })
      .select('name email phone date time counselorType status createdAt')
      .lean();

    res.json(appointments);
  } catch (error) {
    console.error("Error fetching appointments:", error);
    res.status(500).json({ message: "Error fetching appointments" });
  }
});



app.post('/api/events/:id/register', async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    if (event.availableSeats <= 0) {
      return res.status(400).json({ message: 'No available seats' });
    }

    // Validate userId
    if (!mongoose.Types.ObjectId.isValid(req.body.userId)) {
      return res.status(400).json({ message: "Invalid userId" });
    }

    // Push ObjectId, not string
    event.registrations.push(mongoose.Types.ObjectId(req.body.userId));
    event.availableSeats -= 1;

    await event.save();

    res.json({ message: 'Registration successful', event });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error registering for event' });
  }
});


// Health check
app.get("/health", (req, res) => {
  res.status(200).json({ status: "OK", timestamp: new Date() });
});

// Prometheus metrics endpoint
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});


// Event Schema
const eventSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  category: { 
    type: String, 
    required: true,
    enum: ['workshop', 'seminar', 'conference', 'social']
  },
  date: { type: Date, required: true },
  time: { type: String, required: true },
  location: { type: String, required: true },
  imageUrl: { type: String },
  availableSeats: { type: Number, required: true, min: 0 },
  registrations: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  createdAt: { type: Date, default: Date.now }
}, { collection: 'events' });

const Event = mongoose.model('Event', eventSchema);

// Create a new event
app.post("/api/events", async (req, res) => {
  try {
    const {
      title,
      description,
      category,
      date,
      time,
      location,
      imageUrl,
      availableSeats
    } = req.body;

    const newEvent = new Event({
      title,
      description,
      category,
      date,
      time,
      location,
      imageUrl,
      availableSeats,
    });

    await newEvent.save();

    res.status(201).json({ message: "Event created successfully", event: newEvent });
  } catch (err) {
    console.error("Error creating event:", err);
    res.status(500).json({ message: "Error creating event" });
  }
});


app.get('/api/events', async (req, res) => {
  try {
    const events = await Event.find().sort({ date: 1 });
    res.json(events);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching events' });
  }
});

app.post('/api/events/:id/register', async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    if (event.availableSeats <= 0) {
      return res.status(400).json({ message: 'No available seats' });
    }

    // In a real app, you would check if user is already registered
    event.availableSeats -= 1;
    event.registrations.push(req.body.userId);
    await event.save();

    res.json({ message: 'Registration successful', event });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error registering for event' });
  }
});


app.get("/error", (req, res) => {
  res.status(500).send("Forced error");
});


const jobSchema = new mongoose.Schema({
  title: String,
  company: String, 
  location: String,
  description: String,
  type: { type: String, enum: ['full-time', 'part-time', 'internship'], default: 'full-time' },
  createdAt: { type: Date, default: Date.now }
});

const Job = mongoose.model("Job", jobSchema);

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
