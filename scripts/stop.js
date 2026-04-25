#!/usr/bin/env node
// scripts/stop.js — cancel or force-leave a bot.
//
// Usage:
//   node stop.js <bot_id>

const { recallApi } = require("./_lib");

async function main() {
  const botId = process.argv[2];
  if (!botId) {
    console.error("Usage: node stop.js <bot_id>");
    process.exit(1);
  }

  // Try leave_call first (works for active bots). If that fails with
  // cannot_leave_call, the bot is still scheduled — DELETE it instead.
  try {
    await recallApi("POST", `/bot/${botId}/leave_call`);
    console.log(JSON.stringify({ ok: true, action: "left_call", bot_id: botId }));
    return;
  } catch (err) {
    const code = err.body?.code;
    if (code === "cannot_leave_call" || err.status === 400) {
      try {
        await recallApi("DELETE", `/bot/${botId}`);
        console.log(JSON.stringify({ ok: true, action: "deleted_schedule", bot_id: botId }));
        return;
      } catch (err2) {
        console.error(`Both leave_call and delete failed: ${err2.message}`);
        process.exit(1);
      }
    }
    console.error(`Stop failed: ${err.message}`);
    if (err.body) console.error("Detail:", JSON.stringify(err.body));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
