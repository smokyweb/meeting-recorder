// app/server.js — tiny web UI for the meeting-recorder skill.
//
// Shares data/recordings.json with the OpenClaw skill, so a booking made
// here is visible to the agent, and vice versa.
//
// Run: RECALL_API_KEY=xxx node server.js   (then open http://localhost:3100)

const express = require("express");
const path = require("path");
const { recallApi, loadState, saveState } = require("./_lib");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---- List all recordings (with live status from Recall) ----
app.get("/api/recordings", async (_req, res) => {
  const state = loadState();
  const out = [];
  for (const r of state.recordings) {
    // Normalise field names — agent scripts use start/stop, web form uses start_at/stop_at
    const entry = {
      ...r,
      start_at: r.start_at || r.start || null,
      stop_at:  r.stop_at  || r.stop  || null,
    };
    if (entry.bot_id) {
      try {
        const bot = await recallApi("GET", `/bot/${entry.bot_id}`);
        const last = bot.status_changes?.[bot.status_changes.length - 1];
        entry.status = last?.code || entry.status || "unknown";
        const rec = bot.recordings?.[0];
        entry.video_url = rec?.media_shortcuts?.video_mixed?.data?.download_url || null;
        entry.transcript_url = rec?.media_shortcuts?.transcript?.data?.download_url || null;
      } catch (err) {
        entry.status = entry.status || "lookup_failed";
      }
    }
    out.push(entry);
  }
  // Sort: upcoming first (by start_at), then past most-recent first
  const now = Date.now();
  const upcoming = out.filter(r => new Date(r.start_at) >= now).sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
  const past     = out.filter(r => new Date(r.start_at) <  now).sort((a, b) => new Date(b.start_at) - new Date(a.start_at));
  res.json({ upcoming, past });
});

// ---- Schedule a new recording ----
app.post("/api/recordings", async (req, res) => {
  try {
    const { meeting_url, start_at, stop_at, label } = req.body;
    if (!meeting_url || !start_at || !stop_at) {
      return res.status(400).json({ error: "meeting_url, start_at, stop_at required" });
    }
    const start = new Date(start_at);
    const stop = new Date(stop_at);
    if (stop <= start) {
      return res.status(400).json({ error: "stop must be after start" });
    }
    const minutesOut = (start - new Date()) / 60_000;
    if (minutesOut < 10) {
      return res.status(400).json({
        error: `Start is only ${Math.round(minutesOut)} min away. Recall needs at least 10 min lead time.`,
      });
    }

    const finalLabel = (label && label.trim()) || `recording-${Date.now()}`;

    const bot = await recallApi("POST", "/bot", {
      meeting_url,
      bot_name: "Recorder",
      join_at: start.toISOString(),
      metadata: { label: finalLabel, stop_at: stop.toISOString() },
      recording_config: {
        video_mixed_mp4: {},
        video_mixed_layout: "speaker_view",
        video_mixed_participant_video_when_screenshare: "overlap",
        start_recording_on: "bot_join_or_participant_join",
        include_bot_in_recording: { audio: false },
        transcript: { provider: { meeting_captions: {} } },
      },
    });

    const state = loadState();
    const record = {
      bot_id: bot.id,
      label: finalLabel,
      meeting_url,
      start_at: start.toISOString(),
      stop_at: stop.toISOString(),
      booked_at: new Date().toISOString(),
    };
    state.recordings.push(record);
    saveState(state);

    res.status(201).json(record);
  } catch (err) {
    console.error("POST /api/recordings failed:", err);
    res.status(500).json({ error: err.message, detail: err.body || null });
  }
});

// ---- Agent sync endpoint (Axel pushes recordings.json here) ----
app.post("/api/sync", (req, res) => {
  const key = req.headers["x-sync-key"];
  if (key !== (process.env.RECORDER_SYNC_KEY || "axel-sync-2026")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const state = req.body;
    if (!Array.isArray(state.recordings)) {
      return res.status(400).json({ error: "Invalid payload" });
    }
    saveState(state);
    res.json({ ok: true, count: state.recordings.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Cancel / stop ----
app.delete("/api/recordings/:botId", async (req, res) => {
  const botId = req.params.botId;
  try {
    try {
      await recallApi("POST", `/bot/${botId}/leave_call`);
      return res.json({ ok: true, action: "left_call" });
    } catch (err) {
      if (err.status === 400) {
        await recallApi("DELETE", `/bot/${botId}`);
        return res.json({ ok: true, action: "deleted_schedule" });
      }
      throw err;
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const port = process.env.PORT || 3100;
app.listen(port, () => {
  console.log(`Meeting Recorder UI → http://localhost:${port}`);
});
