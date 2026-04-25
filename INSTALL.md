# OpenClaw install prompts

Two prompts below. Copy-paste them into your OpenClaw chat one at a time.

---

## PROMPT 1 — Install the skill

Paste this after you've extracted the `meeting-recorder/` folder somewhere readable (e.g. `~/Downloads/meeting-recorder/`):

```
I have a new OpenClaw skill I want to install from ~/Downloads/meeting-recorder/.
It's called meeting-recorder and schedules Zoom/Meet/Teams recordings via the Recall.ai API.

Please do the following, showing me each command before you run it:

1. Copy the folder to ~/.openclaw/skills/meeting-recorder/ (create the parent dir if needed)
2. Read the SKILL.md to confirm it's valid — show me the YAML frontmatter
3. Run `openclaw skill inspect meeting-recorder` and show me the output
4. Check that `node --version` returns 20 or higher
5. Tell me where to add the RECALL_API_KEY env var so the gateway picks it up
   (show me the exact file/line to edit for my OS)
6. Restart the gateway after I confirm the env var is set
7. Run `openclaw skill list | grep meeting-recorder` to verify it loaded

Stop and wait for my confirmation before the gateway restart. If any step fails,
explain the failure and stop — don't try to fix it automatically.
```

---

## PROMPT 2 — Install and run the web app

After prompt 1 succeeds:

```
The meeting-recorder skill also has a companion web app in its app/ folder.
Please install and start it:

1. cd ~/.openclaw/skills/meeting-recorder/app
2. Run `npm install` (only dep is express)
3. Create a systemd user service (Linux) or LaunchAgent (macOS) that:
   - Starts `node server.js` in that directory
   - Sets RECALL_API_KEY from my environment (same one the skill uses)
   - Restarts on crash
   - Starts on boot
4. Show me the service file before you install it so I can review
5. After I confirm, install and start the service
6. Verify it's listening by curl-ing http://localhost:3100/api/recordings
7. Tell me the URL to open in my browser

If I'm on Windows, skip the service setup — instead give me a .bat file
I can drop in my startup folder.
```

---

## Notes

- **The agent may ask where to put RECALL_API_KEY.** On Linux, `~/.openclaw/openclaw.json` under an `env` block is common, or a systemd `Environment=` line. On macOS, `launchctl setenv` or a LaunchAgent. Whatever your agent uses for other API keys.

- **If the skill fails to load** with a frontmatter parse error, the `requires:` block may not match your OpenClaw version's schema. Remove those lines from SKILL.md — the scripts still check for RECALL_API_KEY at runtime as a fallback.

- **To test without waiting for a real meeting**, schedule a recording for 12 minutes in the future against a Zoom meeting you control, then watch it in the web app's recordings list as the status progresses.
