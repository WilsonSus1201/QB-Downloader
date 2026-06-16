# Remote Downloader Console

Mobile-friendly control panel for an RDP laptop used to download from Quark Cloud Drive and Baidu Netdisk.

## Recommended install paths

### Option A: Docker, easiest and repeatable

Use this when you want a simple install that is easy to recreate.

```powershell
.\start-docker.ps1
```

The script builds the image, starts the app, creates a private token in `.env`, and prints phone URLs like:

```text
http://192.168.1.20:4173/?token=...
```

By default Docker exposes your Windows Downloads folder inside the app as:

```text
Downloads=/downloads
```

Edit `docker-compose.yml` if you want to mount more folders.

Important Docker limitation: Docker containers cannot directly open the Windows desktop browser or write to the Windows clipboard. Docker mode is best for queueing links and choosing mounted download folders from your phone. You still open the link manually in the RDP desktop browser.

Useful Docker commands:

```powershell
docker compose logs -f
docker compose down
docker compose up --build -d
```

### Option B: Native Node, best desktop control

Use this when you want the phone UI to open the link on the RDP laptop browser and copy the selected folder path to the Windows clipboard.

```powershell
npm start
```

The terminal prints a URL like:

```text
http://192.168.1.20:4173/?token=...
```

Open that URL on your phone while it is on the same network as the laptop.

## What it does

- Runs on the download laptop.
- Lets your phone submit Quark or Baidu share links.
- Lets your phone browse and choose a local folder.
- Keeps a simple queue with task status.
- In native Node mode, opens the selected share URL in the laptop desktop browser.
- In native Node mode, copies the chosen folder path to the laptop clipboard.

This first version intentionally uses the real desktop browser session instead of unofficial cloud-drive APIs. That keeps WeChat login, QR codes, captchas, and site changes under your control.

## Configuration

Native mode:

```powershell
$env:PORT = "4173"
$env:DOWNLOADER_TOKEN = "choose-a-private-token"
npm start
```

Docker mode:

```powershell
# .env
DOWNLOADER_TOKEN=choose-a-private-token
```

Mounted folder roots are configured with semicolon-separated entries:

```text
DOWNLOAD_ROOTS=Downloads=/downloads;Media=/media
```

## Security notes

- Keep the token private.
- Anyone with the token on your network can browse the folders exposed to this tool.
- In Docker mode, only mounted folders are visible.
- Windows Firewall may ask whether Docker or Node.js can accept private-network connections. Allow private network access if you want to use the phone UI.
