const express = require("express");
const cors = require("cors");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const videosDir = path.join(__dirname, "videos");
const cookiesPath = path.join(__dirname, "cookies.txt");
const PYTHON_CMD = process.env.RENDER ? "python3" : "python";

if (!fs.existsSync(videosDir)) {
  fs.mkdirSync(videosDir);
}

// ─────────────────────────────────────────
//  INSTABULK — rutas originales
// ─────────────────────────────────────────

let jobs = {};

app.post("/download", (req, res) => {
  const { urls } = req.body;
  if (!urls || !urls.length) return res.status(400).json({ ok: false });

  const jobId = Date.now().toString();
  jobs[jobId] = {
    id: jobId,
    status: "queued",
    progress: 0,
    items: urls.map(url => ({ url, status: "pending", title: null, file: null }))
  };

  processJob(jobId);
  res.json({ ok: true, jobId });
});

function processJob(jobId) {
  const job = jobs[jobId];
  let i = 0;

  function next() {
    if (i >= job.items.length) {
      job.status = "done";
      job.progress = 100;
      return;
    }

    const item = job.items[i];
    item.status = "downloading";
    job.status = "downloading";

    const titleCmd = `${PYTHON_CMD} -m yt_dlp --cookies "${cookiesPath}" --get-title "${item.url}"`;

    exec(titleCmd, (err, stdout) => {
      let title = `video_${Date.now()}_${i}`;
      if (!err && stdout) {
        title = stdout.toString().trim().replace(/[^\w\s\-]/g, "").slice(0, 60);
      }

      const safeTitle = `${title}_${Date.now()}`;
      const finalFile = path.join(videosDir, `${safeTitle}.mp4`);
      item.title = safeTitle;
      item.file = `${safeTitle}.mp4`;

      const cmd = `${PYTHON_CMD} -m yt_dlp --cookies "${cookiesPath}" -o "${finalFile}" "${item.url}"`;
      exec(cmd, (err2) => {
        item.status = err2 ? "error" : "done";
        i++;
        job.progress = Math.floor((i / job.items.length) * 100);
        next();
      });
    });
  }

  next();
}

app.get("/status/:id", (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).json({ error: "not found" });
  res.json(job);
});

app.get("/video/:name", (req, res) => {
  const file = path.join(videosDir, req.params.name);
  if (!fs.existsSync(file)) return res.status(404).send("File not found");
  res.sendFile(file);
});

app.get("/download-zip/:id", (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).send("Job not found");

  res.attachment(`videos_${job.id}.zip`);
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.pipe(res);

  job.items.forEach(item => {
    if (item.status === "done") {
      const filePath = path.join(videosDir, item.file);
      if (fs.existsSync(filePath)) archive.file(filePath, { name: item.file });
    }
  });

  archive.finalize();
});

// ─────────────────────────────────────────
//  INSTATS — rutas nuevas
// ─────────────────────────────────────────

const RAPIDAPI_KEY = "d8816fc522msha1fbd9fec121d80p1c7333jsn745e1baa7ae7";
const RAPIDAPI_HOST = "starapi1.p.rapidapi.com";
const RAPIDAPI_HEADERS = {
  "x-rapidapi-key": RAPIDAPI_KEY,
  "x-rapidapi-host": RAPIDAPI_HOST,
  "Content-Type": "application/json"
};

async function igPost(endpoint, body) {
  const res = await fetch(`https://${RAPIDAPI_HOST}${endpoint}`, {
    method: "POST",
    headers: RAPIDAPI_HEADERS,
    body: JSON.stringify(body)
  });
  return res.json();
}

async function getUserInfo(username) {
  try {
    const data = await igPost("/instagram/user/get_web_profile_info", { username });
    const user = data?.response?.body?.data?.user || {};
    const uid = user.id || user.pk;
    return { uid, user };
  } catch (e) {
    console.error("Error getUserInfo:", e);
    return { uid: null, user: null };
  }
}

async function getClips(userId) {
  const posts = [];
  let endCursor = null;

  for (let page = 0; page < 10; page++) {
    try {
      const body = { id: parseInt(userId), count: 12 };
      if (endCursor) body.end_cursor = endCursor;

      const data = await igPost("/instagram/user/get_clips", body);
      const bodyData = data?.response?.body || {};
      const items = bodyData.items || data.items || data?.data?.items || [];

      if (!items.length) break;

      for (const item of items) {
        const media = item.media || item;

        let thumb = "";
        if (media.image_versions2?.candidates?.length) {
          thumb = media.image_versions2.candidates[0].url || "";
        } else if (media.thumbnail_url) {
          thumb = media.thumbnail_url;
        }

        const takenAt = media.taken_at || media.timestamp || 0;
        let dateStr, weekday, hour;
        if (takenAt > 0) {
          const d = new Date(takenAt * 1000);
          dateStr = d.toISOString().replace("T", " ").slice(0, 19);
          weekday = d.toLocaleDateString("en-US", { weekday: "long" });
          hour = d.getUTCHours();
        } else {
          dateStr = new Date().toISOString().replace("T", " ").slice(0, 19);
          weekday = "";
          hour = 0;
        }

        let caption = "";
        const capObj = media.caption;
        if (typeof capObj === "object" && capObj) caption = (capObj.text || "").slice(0, 150);
        else if (typeof capObj === "string") caption = capObj.slice(0, 150);

        const code = media.code || media.shortcode || "";
        const likes = media.like_count || media.likes || 0;
        const views = media.play_count || media.view_count || media.views || 0;
        const comments = media.comment_count || media.comments || 0;
        const engagement = views > 0 ? Math.round((likes / views) * 10000) / 100 : 0;

        posts.push({
          shortcode: code,
          likes, views, comments, engagement,
          date: dateStr, weekday, hour,
          caption, thumbnail: thumb,
          post_url: code ? `https://www.instagram.com/reel/${code}/` : ""
        });
      }

      const pageInfo = bodyData.page_info || data.page_info || {};
      if (pageInfo.has_next_page) {
        endCursor = pageInfo.end_cursor;
      } else break;

    } catch (e) {
      console.error(`Error página ${page + 1}:`, e);
      break;
    }
  }

  return posts;
}

app.get("/analyze", async (req, res) => {
  const username = (req.query.username || "").trim().replace(/^@/, "");
  const period = req.query.period || "all";
  const sortBy = req.query.sort || "views";
  const minViews = parseInt(req.query.min_views) || 0;
  const minLikes = parseInt(req.query.min_likes) || 0;

  if (!username) return res.status(400).json({ error: "Falta el parámetro 'username'" });

  const { uid, user } = await getUserInfo(username);
  if (!uid) return res.status(400).json({ error: `No se encontró el usuario '${username}'` });

  const posts = await getClips(uid);
  if (!posts.length) return res.status(404).json({ error: "No se encontraron videos para este perfil" });

  // Filtro de tiempo
  const now = new Date();
  const cutoffs = { "1m": 30, "3m": 90, "6m": 180, "1y": 365 };
  const days = cutoffs[period];
  const cutoff = days ? new Date(now - days * 86400000) : new Date("2000-01-01");

  const filtered = posts.filter(p => {
    try {
      return new Date(p.date) >= cutoff && p.views >= minViews && p.likes >= minLikes;
    } catch { return true; }
  });

  if (!filtered.length) return res.status(404).json({ error: "No hay videos con los filtros aplicados" });

  // Ordenar
  const sortKey = { engagement: "engagement", likes: "likes", comments: "comments" }[sortBy] || "views";
  const sorted = [...filtered].sort((a, b) => b[sortKey] - a[sortKey]);

  // Mejor día y hora
  const dayCounts = {}, hourCounts = {};
  filtered.forEach(p => {
    if (p.weekday) dayCounts[p.weekday] = (dayCounts[p.weekday] || 0) + 1;
    hourCounts[p.hour] = (hourCounts[p.hour] || 0) + 1;
  });
  const bestDay = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "N/A";
  const bestHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "N/A";

  const avgViews = Math.round(filtered.reduce((s, p) => s + p.views, 0) / filtered.length);
  const avgLikes = Math.round(filtered.reduce((s, p) => s + p.likes, 0) / filtered.length);
  const avgEngagement = Math.round(filtered.reduce((s, p) => s + p.engagement, 0) / filtered.length * 100) / 100;

  const chartData = [...filtered].sort((a, b) => a.date.localeCompare(b.date))
    .map(p => ({ date: p.date.slice(0, 10), views: p.views, likes: p.likes }));

  res.json({
    profile: {
      username: user.username || username,
      full_name: user.full_name || "",
      biography: user.biography || "",
      followers: user.edge_followed_by?.count || 0,
      following: user.edge_follow?.count || 0,
      profile_pic: user.profile_pic_url_hd || user.profile_pic_url || "",
      is_verified: user.is_verified || false
    },
    stats: {
      total_videos: posts.length,
      filtered_videos: filtered.length,
      avg_views: avgViews,
      avg_likes: avgLikes,
      avg_engagement: avgEngagement,
      best_day: bestDay,
      best_hour: typeof bestHour === "number" ? `${bestHour}:00` : bestHour
    },
    chart_data: chartData,
    posts: sorted.slice(0, 20)
  });
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

// ─────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
