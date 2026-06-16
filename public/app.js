const token = new URLSearchParams(window.location.search).get("token") || localStorage.getItem("downloaderToken") || "";

if (token) {
  localStorage.setItem("downloaderToken", token);
}

const state = {
  currentPath: "",
  parentPath: "",
  mobileUrl: "",
  jobs: [],
  desktopActions: true
};

const elements = {
  connectionStatus: document.querySelector("#connectionStatus"),
  hostName: document.querySelector("#hostName"),
  mobileUrl: document.querySelector("#mobileUrl"),
  mobileUrlButton: document.querySelector("#mobileUrlButton"),
  jobForm: document.querySelector("#jobForm"),
  shareUrl: document.querySelector("#shareUrl"),
  downloadDir: document.querySelector("#downloadDir"),
  note: document.querySelector("#note"),
  folderList: document.querySelector("#folderList"),
  currentPath: document.querySelector("#currentPath"),
  upButton: document.querySelector("#upButton"),
  copyFolderButton: document.querySelector("#copyFolderButton"),
  queueAndOpenButton: document.querySelector("#queueAndOpenButton"),
  refreshButton: document.querySelector("#refreshButton"),
  jobs: document.querySelector("#jobs"),
  toast: document.querySelector("#toast")
};

function apiUrl(path) {
  const url = new URL(path, window.location.origin);
  if (token) url.searchParams.set("token", token);
  return url.toString();
}

async function api(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => {
    elements.toast.classList.remove("visible");
  }, 2600);
}

async function copyText(text) {
  await navigator.clipboard.writeText(text);
  toast("Copied");
}

function selectedProvider() {
  return new FormData(elements.jobForm).get("provider") || "quark";
}

async function loadStatus() {
  const status = await api("/api/status");
  state.desktopActions = status.desktopActions;
  elements.connectionStatus.textContent = status.desktopActions ? "Connected" : "Container mode";
  elements.hostName.textContent = status.host;
  state.mobileUrl = status.lanUrls[0] || `${window.location.origin}/?token=${status.token}`;
  elements.mobileUrl.textContent = state.mobileUrl;
  elements.queueAndOpenButton.disabled = !status.desktopActions;
  elements.queueAndOpenButton.title = status.desktopActions
    ? "Queue and open on the laptop browser"
    : "Disabled in Docker because containers cannot open the Windows desktop browser";
}

async function browse(path = "") {
  const suffix = path ? `?path=${encodeURIComponent(path)}` : "";
  const result = await api(`/api/browse${suffix}`);
  state.currentPath = result.path;
  state.parentPath = result.parent;
  elements.currentPath.textContent = result.path || "Roots";
  elements.upButton.disabled = !result.parent && !result.path;

  if (!result.entries.length) {
    elements.folderList.innerHTML = '<p class="empty" style="padding: 12px;">No child folders.</p>';
    return;
  }

  elements.folderList.innerHTML = result.entries
    .map(
      (entry) => `
        <button class="folder-row" type="button" data-path="${escapeHtml(entry.path)}">
          <span aria-hidden="true">DIR</span>
          <span>${escapeHtml(entry.name)}</span>
          <small>Open</small>
        </button>
      `
    )
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function titleForJob(job) {
  if (job.note) return job.note;
  try {
    return new URL(job.url).hostname;
  } catch {
    return job.url;
  }
}

function renderJobs() {
  if (!state.jobs.length) {
    elements.jobs.innerHTML = '<p class="empty">No tasks yet. Queue a link above and open it on the laptop browser.</p>';
    return;
  }

  elements.jobs.innerHTML = state.jobs
    .map(
      (job) => `
        <article class="job" data-id="${job.id}">
          <div class="job-main">
            <div class="job-title">
              <span class="badge">${job.provider === "baidu" ? "Baidu" : job.provider === "quark" ? "Quark" : "Link"}</span>
              <h3>${escapeHtml(titleForJob(job))}</h3>
            </div>
            <p>${escapeHtml(job.url)}</p>
            <p>Save to: ${escapeHtml(job.downloadDir)}</p>
          </div>
          <div class="job-controls">
            <button class="job-action" type="button" data-action="open" ${state.desktopActions ? "" : "disabled"}>Open</button>
            <button class="job-action" type="button" data-action="copy-folder" ${state.desktopActions ? "" : "disabled"}>Copy path</button>
            <select class="status-select" data-action="status" aria-label="Task status">
              ${["queued", "opened", "downloading", "done", "failed"]
                .map((status) => `<option value="${status}" ${job.status === status ? "selected" : ""}>${status}</option>`)
                .join("")}
            </select>
          </div>
        </article>
      `
    )
    .join("");
}

async function loadJobs() {
  state.jobs = await api("/api/jobs");
  renderJobs();
}

async function createJob(openAfterCreate = false) {
  const job = await api("/api/jobs", {
    method: "POST",
    body: JSON.stringify({
      provider: selectedProvider(),
      url: elements.shareUrl.value,
      downloadDir: elements.downloadDir.value,
      note: elements.note.value
    })
  });

  elements.shareUrl.value = "";
  elements.note.value = "";
  await loadJobs();
  toast(openAfterCreate ? "Queued and opening on laptop" : "Queued");

  if (openAfterCreate) {
    await jobAction(job.id, "open");
  }
}

async function jobAction(jobId, action, status) {
  const path = action === "status" ? `/api/jobs/${jobId}/status` : `/api/jobs/${jobId}/${action}`;
  const options =
    action === "status"
      ? {
          method: "POST",
          body: JSON.stringify({ status })
        }
      : { method: "POST" };
  await api(path, options);
  await loadJobs();

  if (action === "open") toast("Opened on laptop; folder path copied");
  if (action === "copy-folder") toast("Folder path copied");
}

elements.folderList.addEventListener("click", (event) => {
  const row = event.target.closest(".folder-row");
  if (!row) return;
  const selectedPath = row.dataset.path;
  elements.downloadDir.value = selectedPath;
  browse(selectedPath).catch((error) => toast(error.message));
});

elements.upButton.addEventListener("click", () => {
  browse(state.parentPath || "").catch((error) => toast(error.message));
});

elements.copyFolderButton.addEventListener("click", () => {
  if (!elements.downloadDir.value) {
    toast("Choose a folder first");
    return;
  }
  copyText(elements.downloadDir.value).catch((error) => toast(error.message));
});

elements.mobileUrlButton.addEventListener("click", () => {
  copyText(state.mobileUrl).catch((error) => toast(error.message));
});

elements.jobForm.addEventListener("submit", (event) => {
  event.preventDefault();
  createJob(false).catch((error) => toast(error.message));
});

elements.queueAndOpenButton.addEventListener("click", () => {
  createJob(true).catch((error) => toast(error.message));
});

elements.refreshButton.addEventListener("click", () => {
  loadJobs().catch((error) => toast(error.message));
});

elements.jobs.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const job = button.closest(".job");
  jobAction(job.dataset.id, button.dataset.action).catch((error) => toast(error.message));
});

elements.jobs.addEventListener("change", (event) => {
  if (!event.target.matches('select[data-action="status"]')) return;
  const job = event.target.closest(".job");
  jobAction(job.dataset.id, "status", event.target.value).catch((error) => toast(error.message));
});

Promise.all([loadStatus(), browse(), loadJobs()]).catch((error) => {
  elements.connectionStatus.textContent = "Locked";
  toast(error.message);
});
