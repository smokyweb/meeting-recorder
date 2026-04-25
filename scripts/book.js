#!/usr/bin/env node
// scripts/book.js — schedule one recording bot.
//
// Usage:
//   node book.js --url <MEETING_URL> --start <ISO8601> --stop <ISO8601> [--label <LABEL>]
//
// Exits 0 on success, 1 on failure. Prints a single JSON object to stdout on
// success so the agent can parse it if needed.

const { recallApi, loadState, saveState, parseArgs } = require("./_lib");

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
  const stop = new Date(args.stop);
  if (isNaN(start) || isNaN(stop)) {
    console.error("--start and --stop must be valid ISO-8601 timestamps");
    process.exit(1);
  }
  if (stop <= start) {
    console.error("--stop must be after --start");
    process.exit(1);
  }
  const minutesOut = (start - new Date()) / 60_000;
  if (minutesOut < 10) {
    console.error(`WARNING: start is ${Math.round(minutesOut)} min out. Recall requires >=10 min for scheduled bots.`);
    console.error("The booking will still be attempted but may fail with a 507 error from the ad-hoc pool.");
  }

  const label = args.label || `recording-${Date.now()}`;

  const botPayload = {
    meeting_url: args.url,
    bot_name: args["bot-name"] || "Recorder",
    join_at: start.toISOString(),
    metadata: { label, stop_at: stop.toISOString() },
    recording_config: {
      video_mixed_mp4: {},
      video_mixed_layout: "speaker_view",
      video_mixed_participant_video_when_screenshare: "overlap",
      start_recording_on: "bot_join_or_participant_join",
      include_bot_in_recording: { audio: false },
      transcript: { provider: { meeting_captions: {} } },
    },
  };

  let bot;
  try {
    bot = await recallApi("POST", "/bot", botPayload);
  } catch (err) {
    console.error(`Recall booking failed: ${err.message}`);
    if (err.body) console.error("Detail:", JSON.stringify(err.body));
    process.exit(1);
  }

  const state = loadState();
  state.recordings.push({
    bot_id: bot.id,
    label,
    meeting_url: args.url,
    start_at: start.toISOString(),
    stop_at: stop.toISOString(),
    booked_at: new Date().toISOString(),
  });
  saveState(state);

  const result = {
    ok: true,
    bot_id: bot.id,
    label,
    start_at: start.toISOString(),
    stop_at: stop.toISOString(),
  };
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
