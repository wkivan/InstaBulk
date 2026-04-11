const express = require("express");
const cors = require("cors");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const videosDir = path.join(__dirname, "videos");

if (!fs.existsSync(videosDir)) {
  fs.mkdirSync(videosDir);
}

/*
----------------------------------------
📦 JOBS
----------------------------------------
*/
let jobs = {};

/*
----------------------------------------
📥 CREATE DOWNLOAD JOB
----------------------------------------
*/
app.post("/download", (req, res) => {
  const { urls } = req.body;

  if (!urls || !urls.length) {
    return res.status(400).json({ ok: false });
  }

  const jobId = Date.now().toString();

  jobs[jobId] = {
    id: jobId,
    status: "queued",
    progress: 0,
    items: urls.map(url => ({
      url,
      status: "pending",
      title: null,
      file: null
    }))
  };

  processJob(jobId);

  res.json({ ok: true, jobId });
});

/*
----------------------------------------
⚙️ PROCESS JOB
----------------------------------------
*/
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

    const tempFile = path.join(videosDir, `${jobId}_${i}.mp4`);

    // 🔥 GET TITLE
    const titleCmd = `yt-dlp --get-title "${item.url}"`;

    exec(titleCmd, (err, stdout) => {
      let title = `video_${Date.now()}_${i}`;

      if (!err && stdout) {
        title = stdout.toString().trim()
          .replace(/[^\w\s\-]/g, "")
          .slice(0, 80);
      }

      item.title = title;
      const finalFile = path.join(videosDir, `${title}.mp4`);
      item.file = `${title}.mp4`;

      // 🔥 DOWNLOAD VIDEO
      const cmd = `yt-dlp -o "${finalFile}" "${item.url}"`;

      exec(cmd, (err2) => {
        if (err2) {
          item.status = "error";
        } else {
          item.status = "done";
        }

        i++;
        job.progress = Math.floor((i / job.items.length) * 100);

        next();
      });
    });
  }

  next();
}

/*
----------------------------------------
📊 STATUS
----------------------------------------
*/
app.get("/status/:id", (req, res) => {
  const job = jobs[req.params.id];

  if (!job) return res.status(404).json({ error: "not found" });

  res.json(job);
});

/*
----------------------------------------
📁 LIST VIDEOS
----------------------------------------
*/
app.get("/videos", (req, res) => {
  fs.readdir(videosDir, (err, files) => {
    if (err) return res.send("error");

    let html = "<h1>📁 Videos</h1>";

    files.forEach(file => {
      html += `
        <p>
          <a href="/video/${file}">${file}</a>
        </p>
      `;
    });

    res.send(html);
  });
});

/*
----------------------------------------
🎬 STREAM VIDEO
----------------------------------------
*/
app.get("/video/:name", (req, res) => {
  const file = path.join(videosDir, req.params.name);
  res.sendFile(file);
});

/*
----------------------------------------
🚀 START
----------------------------------------
*/
app.listen(PORT, () => {
  console.log(`🚀 http://localhost:${PORT}`);
});