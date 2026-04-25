// scripts/_lib.js — shared helpers for book/status/stop.

const fs = require("fs");
const path = require("path");

const REGION = process.env.RECALL_REGION || "us-east-1";
const API_KEY = process.env.RECALL_API_KEY;
const BASE = `https://${REGION}.recall.ai/api/v1`;

// State file sits at skill-root/data/recordings.json.
const STATE_PATH = path.join(__dirname, "..", "data", "recordings.json");

function requireApiKey() {
  if (!API_KEY) {
    console.error("ERROR: RECALL_API_KEY env var not set.");
    console.error("Get one at https://recall.ai and export it before running this skill.");
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

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return { recordings: [] };
    throw err;
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
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

module.exports = { recallApi, loadState, saveState, parseArgs, REGION, STATE_PATH };
