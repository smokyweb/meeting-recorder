// app/server.js — Meeting Recorder web UI
// Source of truth: Recall.ai API. Completed recordings link to Google Drive.

const express = require("express");
const path    = require("path");
const { recallApi, uploadRecordingToDrive } = require("./_lib");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const DONE_STATUSES = ["done", "completed", "call_ended"];
const ACTIVE_STATUSES = ["scheduled", "ready", "joining_call", "in_call_not_recording", "in_call_recording", "recording"];

// ── List all bots from Recall, split into upcoming/past; auto-upload completed ones ──
app.get("/api/recordings", async (_req, res) => {
  try {
    const data = await recallApi("GET", "/bot/?limit=50");
    const bots = data.results || data || [];
    const out  = [];

    for (const bot of bots) {
      const lastStatus = bot.status_changes?.[bot.status_changes.length - 1];
      const status     = lastStatus?.code || "scheduled";
      const rec        = bot.recordings?.[0];
      let driveLink    = bot.metadata?.drive_link || null;
      let transcriptLink = bot.metadata?.transcript_link || null;

      // Auto-upload to Drive if done and not yet uploaded
      if (DONE_STATUSES.includes(status) && !driveLink) {
        const videoUrl = rec?.media_shortcuts?.video_mixed?.data?.download_url;
        if (videoUrl) {
          try {
            const result = await uploadRecordingToDrive(bot.id, bot.metadata?.label || bot.id);
            if (result.uploaded) {
              driveLink = result.driveLink;
              transcriptLink = result.transcriptLink || null;
              // Persist links back to Recall bot metadata
              await recallApi("PATCH", `/bot/${bot.id}`, {
                metadata: { ...bot.metadata, drive_link: driveLink, transcript_link: transcriptLink },
              }).catch(() => {});
            }
          } catch (uploadErr) {
            console.error(`Auto-upload failed for ${bot.id}:`, uploadErr.message);
          }
        }
      }

      out.push({
        bot_id:          bot.id,
        label:           bot.metadata?.label || bot.id,
        status,
        start_at:        bot.join_at,
        stop_at:         bot.metadata?.stop_at || null,
        drive_link:      driveLink,
        transcript_link: transcriptLink,
      });
    }

    const upcoming = out
      .filter(r => ACTIVE_STATUSES.includes(r.status))
      .sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
    const past = out
      .filter(r => !upcoming.includes(r))
      .sort((a, b) => new Date(b.start_at) - new Date(a.start_at));

    res.json({ upcoming, past });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Schedule a new recording ─────────────────────────────────────────────────
app.post("/api/recordings", async (req, res) => {
  try {
    const { meeting_url, start_at, stop_at, label } = req.body;
    if (!meeting_url || !start_at || !stop_at)
      return res.status(400).json({ error: "meeting_url, start_at, stop_at required" });

    const start = new Date(start_at);
    const stop  = new Date(stop_at);
    if (stop <= start) return res.status(400).json({ error: "stop must be after start" });

    const minutesOut = (start - new Date()) / 60_000;
    if (minutesOut < 10)
      return res.status(400).json({ error: `Start is ${Math.round(minutesOut)} min away — Recall needs ≥10 min.` });

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
        start_recording_on: "call_starts",
        include_bot_in_recording: { audio: false },
        transcript: { provider: { meeting_captions: {} } },
      },
    });

    res.status(201).json({ bot_id: bot.id, label: finalLabel, start_at: start.toISOString(), stop_at: stop.toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message, detail: err.body || null });
  }
});

// ── Upload a finished recording to Google Drive ──────────────────────────────
app.post("/api/recordings/:botId/upload", async (req, res) => {
  try {
    const { botId } = req.params;
    const bot = await recallApi("GET", `/bot/${botId}`);
    const label = bot.metadata?.label || botId;
    const result = await uploadRecordingToDrive(botId, label);
    if (!result.uploaded) return res.status(202).json({ ok: false, reason: result.reason });

    // Store Drive links back in bot metadata so they persist
    await recallApi("PATCH", `/bot/${botId}`, {
      metadata: {
        ...bot.metadata,
        drive_link: result.driveLink,
        transcript_link: result.transcriptLink || null,
      },
    }).catch(() => {}); // best-effort

    res.json({ ok: true, drive_link: result.driveLink, transcript_link: result.transcriptLink, file: result.fileName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Cancel / leave call ──────────────────────────────────────────────────────
app.delete("/api/recordings/:botId", async (req, res) => {
  const { botId } = req.params;
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
app.listen(port, () => console.log(`Meeting Recorder UI → http://localhost:${port}`));
