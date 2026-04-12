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

let jobs = {};

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
        title = stdout.toString().trim()
          .replace(/[^\w\s\-]/g, "")
          .slice(0, 60);
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
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name: item.file });
      }
    }
  });

  archive.finalize();
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});