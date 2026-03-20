const express = require("express");
const cors = require("cors");
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public")); // serves index.html from /public folder

// =============================================
// Set these in Render's Environment Variables
// (never paste them directly here)
// =============================================
const BOT_TOKEN  = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const API_KEY    = process.env.API_KEY;
// =============================================

const DISCORD_API = "https://discord.com/api/v10";

// ─── Rate limiting (5 requests per IP per minute) ────────────────────────────
const rateLimitMap = new Map();
const RATE_LIMIT  = 5;
const RATE_WINDOW = 60000;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (now - entry.windowStart > RATE_WINDOW) rateLimitMap.delete(ip);
  }
}, 5 * 60 * 1000);

// ─── Middleware ───────────────────────────────────────────────────────────────
function requireApiKey(req, res, next) {
  const key = req.headers["x-api-key"];
  if (!key || key !== API_KEY) return res.status(401).json({ error: "Unauthorized" });
  next();
}

function requireRateLimit(req, res, next) {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress;
  if (isRateLimited(ip)) return res.status(429).json({ error: "Too many requests. Please wait a minute." });
  next();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

// ─── POST /send ───────────────────────────────────────────────────────────────
// Only accepts an email — command is built server-side, cannot be changed by client
app.post("/send", requireApiKey, requireRateLimit, async (req, res) => {
  const { email } = req.body;

  if (!email || typeof email !== "string")
    return res.status(400).json({ error: "Email is required." });

  const cleanEmail = email.trim().toLowerCase();
  if (!isValidEmail(cleanEmail))
    return res.status(400).json({ error: "Invalid email address." });

  const command = `/mail inbox ${cleanEmail}`;

  try {
    const response = await fetch(`${DISCORD_API}/channels/${CHANNEL_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: command }),
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(500).json({ error: err.message || "Discord API error" });
    }

    const message = await response.json();
    return res.json({ messageId: message.id, timestamp: message.timestamp });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /poll ────────────────────────────────────────────────────────────────
app.get("/poll", requireApiKey, requireRateLimit, async (req, res) => {
  const { after } = req.query;

  if (!after || !/^\d+$/.test(after))
    return res.status(400).json({ error: "Invalid message ID." });

  try {
    const response = await fetch(
      `${DISCORD_API}/channels/${CHANNEL_ID}/messages?after=${after}&limit=10`,
      { headers: { Authorization: `Bot ${BOT_TOKEN}` } }
    );

    if (!response.ok) {
      const err = await response.json();
      return res.status(500).json({ error: err.message || "Discord API error" });
    }

    const messages = await response.json();
    const formatted = messages
      .map((m) => ({
        id: m.id,
        content: m.content,
        author: m.author.username,
        avatar: m.author.avatar
          ? `https://cdn.discordapp.com/avatars/${m.author.id}/${m.author.avatar}.png`
          : `https://cdn.discordapp.com/embed/avatars/0.png`,
        timestamp: m.timestamp,
        isBot: m.author.bot || false,
      }))
      .reverse();

    return res.json({ messages: formatted });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
