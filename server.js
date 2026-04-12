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

// Detectar comando Python automáticamente
const PYTHON_CMD = process.env.RENDER ? "python3" : "python";

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

    // 🔥 GET TITLE
    const titleCmd = `${PYTHON_CMD} -m yt_dlp --cookies "${cookiesPath}" --get-title "${item.url}"`;

    exec(titleCmd, (err, stdout, stderr) => {
      let title = `video_${Date.now()}_${i}`;

      if (!err && stdout) {
        title = stdout.toString().trim()
          .replace(/[^\w\s\-]/g, "")
          .slice(0, 60);
      } else {
        console.error("ERROR TITLE:", stderr);
      }

      const safeTitle = `${title}_${Date.now()}`;
      const finalFile = path.join(videosDir, `${safeTitle}.mp4`);

      item.title = safeTitle;
      item.file = `${safeTitle}.mp4`;

      // 🔥 DOWNLOAD VIDEO CON COOKIES
      const cmd = `${PYTHON_CMD} -m yt_dlp --cookies "${cookiesPath}" --sleep-interval 2 --max-sleep-interval 5 -o "${finalFile}" "${item.url}"`;

      exec(cmd, (err2, stdout2, stderr2) => {
        if (err2) {
          console.error("ERROR DOWNLOAD:", stderr2);
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
      html += `<p><a href="/video/${file}" target="_blank">${file}</a></p>`;
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

  if (!fs.existsSync(file)) {
    return res.status(404).send("File not found");
  }

  res.sendFile(file);
});

/*
----------------------------------------
📦 DOWNLOAD ZIP
----------------------------------------
*/
app.get("/download-zip/:id", (req, res) => {
  const job = jobs[req.params.id];

  if (!job) {
    return res.status(404).send("Job not found");
  }

  res.attachment(`videos_${job.id}.zip`);

  const archive = archiver("zip", {
    zlib: { level: 9 }
  });

  archive.pipe(res);

  job.items.forEach(item => {
    if (item.status === "done") {
      const filePath = path.join(videosDir, item.file);
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name: item.file });
      }
    }
  });

  archive.finalize();
});

/*
----------------------------------------
🚀 START
----------------------------------------
*/
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});