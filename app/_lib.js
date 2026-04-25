// scripts/_lib.js — shared helpers for book/status/stop.
// Architecture: Recall.ai is source of truth. No local recordings.json.
// Completed recordings are uploaded to Google Drive "meeting-recordings/" folder.

const fs = require("fs");
const path = require("path");
const https = require("https");

const REGION = process.env.RECALL_REGION || "us-east-1";
const API_KEY = process.env.RECALL_API_KEY;
const BASE = `https://${REGION}.recall.ai/api/v1`;

// Google Drive
const DRIVE_CREDS_PATH = process.env.GOOGLE_DRIVE_CREDS ||
  "C:\\Users\\kevin\\.openclaw\\workspace\\google-drive-creds.json";
const DRIVE_FOLDER_NAME = "meeting-recordings";

function requireApiKey() {
  if (!API_KEY) {
    console.error("ERROR: RECALL_API_KEY env var not set.");
    process.exit(1);
  }
}

async function recallApi(method, pathSegment, body) {
  requireApiKey();
  const res = await fetch(`${BASE}${pathSegment}`, {
    method,
    headers: {
      Authorization: `Token ${API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) {
    const err = new Error(`Recall ${method} ${pathSegment} → ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

// ── Google Drive helpers ──────────────────────────────────────────────────────

async function getDriveToken() {
  let creds;
  try {
    creds = JSON.parse(fs.readFileSync(DRIVE_CREDS_PATH, "utf8"));
  } catch {
    throw new Error("Could not read Google Drive credentials from " + DRIVE_CREDS_PATH);
  }

  // Refresh if expired (with 60s buffer)
  if (!creds.access_token || (creds.expiry_date && Date.now() > creds.expiry_date - 60000)) {
    const params = new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: creds.refresh_token,
      grant_type: "refresh_token",
    });
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const tok = await r.json();
    if (!tok.access_token) throw new Error("Token refresh failed: " + JSON.stringify(tok));
    creds.access_token = tok.access_token;
    creds.expiry_date = Date.now() + (tok.expires_in * 1000);
    fs.writeFileSync(DRIVE_CREDS_PATH, JSON.stringify(creds, null, 2));
  }
  return creds.access_token;
}

async function driveApi(method, path, body, token) {
  const res = await fetch(`https://www.googleapis.com/drive/v3${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Drive ${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function getOrCreateDriveFolder(token) {
  // Search for existing folder
  const q = encodeURIComponent(`name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const list = await driveApi("GET", `/files?q=${q}&fields=files(id,name)`, null, token);
  if (list.files && list.files.length > 0) return list.files[0].id;
  // Create it
  const folder = await driveApi("POST", "/files", {
    name: DRIVE_FOLDER_NAME,
    mimeType: "application/vnd.google-apps.folder",
  }, token);
  return folder.id;
}

/**
 * Download a URL and upload it to Google Drive.
 * Returns the Drive file id and webViewLink.
 */
async function uploadUrlToDrive(downloadUrl, fileName, folderId, token) {
  // Step 1: download the file into memory
  const fileRes = await fetch(downloadUrl);
  if (!fileRes.ok) throw new Error(`Failed to download recording: ${fileRes.status}`);
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  const mimeType = fileRes.headers.get("content-type") || "video/mp4";

  // Step 2: upload via multipart to Drive
  const metadata = JSON.stringify({ name: fileName, parents: [folderId] });
  const boundary = "axel_upload_boundary";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`),
    Buffer.from(metadata),
    Buffer.from(`\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink,name", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
      "Content-Length": body.length.toString(),
    },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Drive upload failed: ${res.status}: ${JSON.stringify(data)}`);
  return data; // { id, webViewLink, name }
}

/**
 * Check a bot for completed recording, upload to Drive if found.
 * Returns { uploaded: true, driveLink } or { uploaded: false, reason }
 */
async function uploadRecordingToDrive(botId, label) {
  const bot = await recallApi("GET", `/bot/${botId}`);
  const rec = bot.recordings?.[0];
  const videoUrl = rec?.media_shortcuts?.video_mixed?.data?.download_url;

  if (!videoUrl) {
    const lastStatus = bot.status_changes?.[bot.status_changes.length - 1]?.code;
    return { uploaded: false, reason: `No video URL yet (status: ${lastStatus || "unknown"})` };
  }

  const token = await getDriveToken();
  const folderId = await getOrCreateDriveFolder(token);
  const safeLabel = (label || botId).replace(/[^a-zA-Z0-9 _-]/g, "_");
  const fileName = `${safeLabel}_${new Date().toISOString().slice(0, 10)}.mp4`;

  console.log(`Uploading "${fileName}" to Google Drive...`);
  const driveFile = await uploadUrlToDrive(videoUrl, fileName, folderId, token);

  // Also upload transcript if available
  let transcriptLink = null;
  const transcriptUrl = rec?.media_shortcuts?.transcript?.data?.download_url;
  if (transcriptUrl) {
    const tName = `${safeLabel}_${new Date().toISOString().slice(0, 10)}_transcript.txt`;
    const tRes = await fetch(transcriptUrl);
    const tBuf = Buffer.from(await tRes.arrayBuffer());
    const tMeta = JSON.stringify({ name: tName, parents: [folderId] });
    const tb = "axel_t_boundary";
    const tBody = Buffer.concat([
      Buffer.from(`--${tb}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`),
      Buffer.from(tMeta),
      Buffer.from(`\r\n--${tb}\r\nContent-Type: text/plain\r\n\r\n`),
      tBuf,
      Buffer.from(`\r\n--${tb}--`),
    ]);
    const tUp = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${tb}` },
      body: tBody,
    });
    const tData = await tUp.json();
    transcriptLink = tData.webViewLink || null;
  }

  return {
    uploaded: true,
    driveLink: driveFile.webViewLink,
    transcriptLink,
    fileName: driveFile.name,
    driveFileId: driveFile.id,
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

module.exports = { recallApi, uploadRecordingToDrive, getDriveToken, getOrCreateDriveFolder, parseArgs, REGION };
