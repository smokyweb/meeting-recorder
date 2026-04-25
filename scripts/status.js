#!/usr/bin/env node
// scripts/status.js — report on booked recordings.
//
// Usage:
//   node status.js                       # all recordings
//   node status.js --label "<label>"     # filter by label (substring match)
//   node status.js --bot <bot_id>        # single bot
//   node status.js --json                # raw JSON for machine parsing

const { recallApi, loadState, parseArgs } = require("./_lib");

async function main() {
  const args = parseArgs(process.argv);
  const state = loadState();
  let records = state.recordings;

  if (args.bot) {
    records = records.filter((r) => r.bot_id === args.bot);
  }
  if (args.label) {
    const needle = args.label.toLowerCase();
    records = records.filter((r) => r.label.toLowerCase().includes(needle));
  }

  if (records.length === 0) {
    console.log("No matching recordings found.");
    return;
  }

  const results = [];
  for (const r of records) {
    const entry = { ...r };
    try {
      const bot = await recallApi("GET", `/bot/${r.bot_id}`);
      const lastChange = bot.status_changes?.[bot.status_changes.length - 1];
      entry.status = lastChange?.code || "unknown";
      entry.status_time = lastChange?.created_at || null;

      const recording = bot.recordings?.[0];
      entry.video_url =
        recording?.media_shortcuts?.video_mixed?.data?.download_url || null;
      entry.transcript_url =
        recording?.media_shortcuts?.transcript?.data?.download_url || null;
    } catch (err) {
      entry.status = "lookup_failed";
      entry.error = err.message;
    }
    results.push(entry);
  }

  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  // Human-readable table.
  for (const r of results) {
    console.log(`\n━━ ${r.label} ━━`);
    console.log(`  bot_id:   ${r.bot_id}`);
    console.log(`  scheduled: ${r.start_at} → ${r.stop_at}`);
    console.log(`  status:   ${r.status}`);
    if (r.video_url) {
      console.log(`  video:    ${r.video_url}`);
    } else if (["completed", "done", "call_ended"].includes(r.status)) {
      console.log(`  video:    (none — bot may have joined but not recorded)`);
    } else {
      console.log(`  video:    not ready yet`);
    }
    if (r.transcript_url) console.log(`  transcript: ${r.transcript_url}`);
    if (r.error) console.log(`  error:    ${r.error}`);
  }
  console.log();
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
