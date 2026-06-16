const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, ".data");
const JOBS_FILE = path.join(DATA_DIR, "jobs.json");
const TOKEN_FILE = path.join(DATA_DIR, "token.txt");
const PUBLIC_DIR = path.join(__dirname, "public");
const DESKTOP_ACTIONS_DISABLED =
  process.env.DISABLE_DESKTOP_ACTIONS === "1" || process.env.CONTAINER_MODE === "1";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

fs.mkdirSync(DATA_DIR, { recursive: true });

function getToken() {
  if (process.env.DOWNLOADER_TOKEN) {
    return process.env.DOWNLOADER_TOKEN.trim();
  }

  if (fs.existsSync(TOKEN_FILE)) {
    return fs.readFileSync(TOKEN_FILE, "utf8").trim();
  }

  const token = crypto.randomBytes(12).toString("hex");
  fs.writeFileSync(TOKEN_FILE, token, "utf8");
  return token;
}

const ACCESS_TOKEN = getToken();

function loadJobs() {
  try {
    return JSON.parse(fs.readFileSync(JOBS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveJobs(jobs) {
  fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2), "utf8");
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function isAuthenticated(req, url) {
  const headerToken = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  return headerToken === ACCESS_TOKEN || url.searchParams.get("token") === ACCESS_TOKEN;
}

function requireAuth(req, res, url) {
  if (isAuthenticated(req, url)) return true;
  sendJson(res, 401, { error: "Unauthorized." });
  return false;
}

function getLanAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        addresses.push(entry.address);
      }
    }
  }

  return addresses;
}

function configuredRoots() {
  const rawRoots = String(process.env.DOWNLOAD_ROOTS || "").trim();
  if (!rawRoots) return [];

  return rawRoots
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [label, rootPath] = item.includes("=") ? item.split(/=(.*)/s).filter(Boolean) : [item, item];
      return {
        name: label.trim(),
        path: path.resolve(rootPath.trim())
      };
    })
    .filter((item) => {
      try {
        return fs.existsSync(item.path) && fs.statSync(item.path).isDirectory();
      } catch {
        return false;
      }
    });
}

function isPathInside(childPath, parentPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function allowedRoots() {
  return configuredRoots();
}

function roots() {
  const configured = allowedRoots();
  if (configured.length) {
    return configured;
  }

  const home = os.homedir();
  const candidates = [
    path.join(home, "Downloads"),
    path.join(home, "Desktop"),
    path.join(home, "Documents")
  ];

  if (process.platform === "win32") {
    for (let code = 67; code <= 90; code += 1) {
      candidates.push(`${String.fromCharCode(code)}:\\`);
    }
  } else {
    candidates.push(home, "/");
  }

  return [...new Set(candidates)]
    .filter((candidate) => {
      try {
        return fs.existsSync(candidate) && fs.statSync(candidate).isDirectory();
      } catch {
        return false;
      }
    })
    .map((candidate) => ({
      name: candidate,
      path: candidate
    }));
}

function browseDirectory(targetPath) {
  const configured = allowedRoots();
  const resolved = targetPath ? path.resolve(targetPath) : null;
  const isAllowed =
    !configured.length || (resolved && configured.some((root) => isPathInside(resolved, root.path)));

  if (!resolved || !isAllowed || !fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return {
      path: "",
      parent: "",
      entries: roots()
    };
  }

  const entries = fs
    .readdirSync(resolved, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("$"))
    .map((entry) => {
      const fullPath = path.join(resolved, entry.name);
      return {
        name: entry.name,
        path: fullPath
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const rawParent = path.dirname(resolved);
  const parent =
    configured.length && !configured.some((root) => isPathInside(rawParent, root.path)) ? "" : rawParent;
  return {
    path: resolved,
    parent: parent === resolved ? "" : parent,
    entries
  };
}

function providerFromUrl(rawUrl) {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    if (hostname.includes("quark") || hostname.includes("uc.cn")) return "quark";
    if (hostname.includes("baidu") || hostname.includes("pan.baidu")) return "baidu";
  } catch {
    return "other";
  }

  return "other";
}

function runPowerShell(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command, ...args],
      { windowsHide: true }
    );
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `PowerShell exited with code ${code}.`));
    });
  });
}

async function copyToClipboard(text) {
  if (DESKTOP_ACTIONS_DISABLED) {
    throw new Error("Desktop clipboard actions are disabled in container mode.");
  }
  if (process.platform !== "win32") return;
  await runPowerShell("Set-Clipboard -Value $args[0]", [text]);
}

async function openDesktopUrl(url) {
  if (DESKTOP_ACTIONS_DISABLED) {
    throw new Error("Opening the host desktop browser is disabled in container mode.");
  }

  if (process.platform === "win32") {
    await runPowerShell("Start-Process -FilePath $args[0]", [url]);
    return;
  }

  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(opener, [url], { detached: true, stdio: "ignore" }).unref();
}

function withUpdatedJob(jobId, update) {
  const jobs = loadJobs();
  const index = jobs.findIndex((job) => job.id === jobId);
  if (index < 0) return null;
  jobs[index] = {
    ...jobs[index],
    ...update,
    updatedAt: new Date().toISOString()
  };
  saveJobs(jobs);
  return jobs[index];
}

async function handleApi(req, res, url) {
  if (!requireAuth(req, res, url)) return;

  if (req.method === "GET" && url.pathname === "/api/status") {
    sendJson(res, 200, {
      host: os.hostname(),
      platform: process.platform,
      containerMode: DESKTOP_ACTIONS_DISABLED,
      desktopActions: !DESKTOP_ACTIONS_DISABLED,
      configuredRoots: roots(),
      token: ACCESS_TOKEN,
      port: PORT,
      lanUrls: getLanAddresses().map((address) => `http://${address}:${PORT}/?token=${ACCESS_TOKEN}`)
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/browse") {
    sendJson(res, 200, browseDirectory(url.searchParams.get("path")));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/jobs") {
    sendJson(res, 200, loadJobs());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/jobs") {
    const body = await readRequestBody(req);
    const shareUrl = String(body.url || "").trim();
    const downloadDir = String(body.downloadDir || "").trim();
    const provider = body.provider || providerFromUrl(shareUrl);

    if (!/^https?:\/\//i.test(shareUrl)) {
      sendJson(res, 400, { error: "Please enter a valid http or https share URL." });
      return;
    }

    if (!downloadDir || !fs.existsSync(downloadDir) || !fs.statSync(downloadDir).isDirectory()) {
      sendJson(res, 400, { error: "Please choose an existing download folder." });
      return;
    }

    const jobs = loadJobs();
    const job = {
      id: crypto.randomUUID(),
      provider,
      url: shareUrl,
      downloadDir,
      note: String(body.note || "").trim(),
      status: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    jobs.unshift(job);
    saveJobs(jobs);
    sendJson(res, 201, job);
    return;
  }

  const actionMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/(open|copy-folder|status)$/);
  if (req.method === "POST" && actionMatch) {
    const [, jobId, action] = actionMatch;
    const jobs = loadJobs();
    const job = jobs.find((item) => item.id === jobId);

    if (!job) {
      sendJson(res, 404, { error: "Job not found." });
      return;
    }

    if (action === "open") {
      await copyToClipboard(job.downloadDir);
      await openDesktopUrl(job.url);
      const updated = withUpdatedJob(jobId, { status: "opened" });
      sendJson(res, 200, updated);
      return;
    }

    if (action === "copy-folder") {
      await copyToClipboard(job.downloadDir);
      const updated = withUpdatedJob(jobId, { status: job.status });
      sendJson(res, 200, updated);
      return;
    }

    const body = await readRequestBody(req);
    const status = ["queued", "opened", "downloading", "done", "failed"].includes(body.status)
      ? body.status
      : "queued";
    const updated = withUpdatedJob(jobId, { status });
    sendJson(res, 200, updated);
    return;
  }

  sendJson(res, 404, { error: "API route not found." });
}

function serveStatic(req, res, url) {
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "content-type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Unexpected server error." });
  }
});

server.listen(PORT, HOST, () => {
  const urls = getLanAddresses().map((address) => `http://${address}:${PORT}/?token=${ACCESS_TOKEN}`);
  console.log(`Remote Downloader Console running on http://localhost:${PORT}/?token=${ACCESS_TOKEN}`);
  if (urls.length) {
    console.log("Open from your phone on the same network:");
    urls.forEach((item) => console.log(`  ${item}`));
  }
});
