#!/usr/bin/env node
// scripts/status.js — check bot status and optionally upload finished recording to Drive.
//
// Usage:
//   node status.js --bot <BOT_ID>              # check single bot
//   node status.js --list                      # list all bots from Recall
//   node status.js --bot <BOT_ID> --upload     # check + upload to Google Drive if ready
//   node status.js --list --upload             # check all + upload any that are done

const { recallApi, uploadRecordingToDrive, parseArgs } = require("./_lib");

async function checkBot(botId, upload) {
  const bot = await recallApi("GET", `/bot/${botId}`);
  const lastStatus = bot.status_changes?.[bot.status_changes.length - 1];
  const status = lastStatus?.code || "unknown";
  const rec = bot.recordings?.[0];
  const videoUrl = rec?.media_shortcuts?.video_mixed?.data?.download_url || null;
  const label = bot.metadata?.label || botId;

  const entry = {
    bot_id: botId,
    label,
    status,
    join_at: bot.join_at,
    video_url: videoUrl,
    drive_link: null,
    transcript_link: null,
  };

  if (upload && videoUrl) {
    console.log(`Uploading "${label}" to Google Drive...`);
    const result = await uploadRecordingToDrive(botId, label);
    if (result.uploaded) {
      entry.drive_link = result.driveLink;
      entry.transcript_link = result.transcriptLink;
      console.log(`✅ Uploaded: ${result.driveLink}`);
    } else {
      console.log(`⚠️  Not uploaded: ${result.reason}`);
    }
  }

  return entry;
}

async function main() {
  const args = parseArgs(process.argv);
  const upload = !!args.upload;

  if (args.bot) {
    const entry = await checkBot(args.bot, upload);
    console.log(JSON.stringify(entry, null, 2));
    return;
  }

  if (args.list) {
    const data = await recallApi("GET", "/bot/?limit=20");
    const bots = data.results || data;
    if (!bots.length) { console.log("No bots found."); return; }
    const results = [];
    for (const bot of bots) {
      const entry = await checkBot(bot.id, upload);
      results.push(entry);
      console.log(`\n━━ ${entry.label} ━━`);
      console.log(`  bot_id: ${entry.bot_id}`);
      console.log(`  status: ${entry.status}`);
      console.log(`  join_at: ${entry.join_at}`);
      if (entry.drive_link) console.log(`  drive: ${entry.drive_link}`);
      else if (entry.video_url) console.log(`  video_url: ${entry.video_url}`);
    }
    return;
  }

  console.error("Usage: node status.js --bot <BOT_ID> [--upload] | --list [--upload]");
  process.exit(1);
}

main().catch((err) => { console.error("Unexpected error:", err); process.exit(1); });
