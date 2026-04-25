#!/usr/bin/env node
// scripts/book.js — schedule one recording bot via Recall.ai.
// No local state stored. Recall is the source of truth.
//
// Usage:
//   node book.js --url <MEETING_URL> --start <ISO8601> --stop <ISO8601> [--label <LABEL>]

const { recallApi, parseArgs } = require("./_lib");

async function main() {
  const args = parseArgs(process.argv);
  const required = ["url", "start", "stop"];
  for (const k of required) {
    if (!args[k]) {
      console.error(`Missing required arg: --${k}`);
      console.error("Usage: node book.js --url <URL> --start <ISO> --stop <ISO> [--label <LABEL>]");
      process.exit(1);
    }
  }

  const start = new Date(args.start);
  const stop  = new Date(args.stop);
  if (isNaN(start) || isNaN(stop)) { console.error("Invalid ISO timestamps"); process.exit(1); }
  if (stop <= start) { console.error("--stop must be after --start"); process.exit(1); }

  const minutesOut = (start - new Date()) / 60_000;
  if (minutesOut < 10) {
    console.warn(`WARNING: start is ${Math.round(minutesOut)} min out — Recall needs >=10 min lead time.`);
  }

  const label = args.label || `recording-${Date.now()}`;

  const bot = await recallApi("POST", "/bot", {
    meeting_url: args.url,
    bot_name: args["bot-name"] || "Recorder",
    join_at: start.toISOString(),
    metadata: { label, stop_at: stop.toISOString() },
    recording_config: {
      video_mixed_mp4: {},
      video_mixed_layout: "speaker_view",
      include_bot_in_recording: { audio: false },
      transcript: { provider: { meeting_captions: {} } },
    },
  }).catch((err) => {
    console.error(`Recall booking failed: ${err.message}`);
    if (err.body) console.error("Detail:", JSON.stringify(err.body));
    process.exit(1);
  });

  console.log(JSON.stringify({
    ok: true,
    bot_id: bot.id,
    label,
    start_at: start.toISOString(),
    stop_at:  stop.toISOString(),
    message: "Booked. When the meeting ends, run: node status.js --upload --bot " + bot.id,
  }, null, 2));
}

main().catch((err) => { console.error("Unexpected error:", err); process.exit(1); });
