# meeting-recorder (OpenClaw skill)

Schedule unattended recordings of Zoom, Google Meet, or Microsoft Teams meetings via the Recall.ai API. Drops into OpenClaw as a skill so you can say "record tomorrow's Zoom at 9am" and it just works.

## Install

1. Drop this folder into your OpenClaw skills directory. Common locations:
   - Workspace override: `<project>/skills/meeting-recorder/`
   - User-level: `~/.openclaw/skills/meeting-recorder/`
   - Managed: `~/.openclaw/managed/skills/meeting-recorder/`

   Workspace > user > bundled in OpenClaw's precedence.

2. Set environment variables (in `~/.openclaw/openclaw.json`, systemd unit, or shell profile — wherever your gateway reads env from):

   ```bash
   export RECALL_API_KEY="your-recall-api-key"
   export RECALL_REGION="us-east-1"   # optional, defaults to us-east-1
   ```

   Get the API key from recall.ai → dashboard → API keys.

3. Restart the OpenClaw gateway so it picks up the new skill and env:

   ```bash
   openclaw gateway restart
   ```

4. Verify it loaded:

   ```bash
   openclaw skill inspect meeting-recorder
   ```

## Usage

Natural language — the skill's `description` field makes it trigger on phrases like:

- "Record my Zoom tomorrow at 9am until 5pm, the URL is https://zoom.us/j/123..."
- "Schedule a recorder for Sunday's service, same time and link as last week"
- "Where's the download for Saturday's meeting?"
- "Cancel the Sunday recording"

The agent reads `SKILL.md`, gathers the meeting URL and times, converts to ISO-8601 in your time zone, and calls the relevant script.

## Direct script use (outside OpenClaw)

```bash
# book one
RECALL_API_KEY=xxx node scripts/book.js \
  --url "https://zoom.us/j/123..." \
  --start "2026-04-25T09:00:00-04:00" \
  --stop  "2026-04-25T17:00:00-04:00" \
  --label "Saturday conference"

# see status of everything booked through this skill
RECALL_API_KEY=xxx node scripts/status.js

# filter
RECALL_API_KEY=xxx node scripts/status.js --label "Saturday"

# cancel or force-leave
RECALL_API_KEY=xxx node scripts/stop.js <bot_id>
```

## Data

State lives at `data/recordings.json` inside the skill directory. Each booking appends one entry. Deleting this file forgets bot IDs locally but doesn't affect anything on Recall's side — you'd still find the bots in their dashboard.

## Requirements

- Node 20+ (uses built-in `fetch`, no npm deps)
- A Recall.ai account with API access
- OpenClaw's `exec` tool enabled (for the agent to run the scripts)

## Web app

There's also a simple web UI in `app/` that talks to the same Recall API and shares the same `data/recordings.json` state. So a booking made in the UI shows up to the OpenClaw agent, and vice versa.

```bash
cd app
npm install
RECALL_API_KEY=xxx node server.js
# open http://localhost:3100
```

See `INSTALL.md` for OpenClaw-agent install prompts and systemd/LaunchAgent setup.

## File layout

```
meeting-recorder/
├── SKILL.md              # runbook the agent reads
├── README.md             # this file
├── INSTALL.md            # copy-paste prompts for your OpenClaw agent
├── scripts/
│   ├── _lib.js           # shared helpers
│   ├── book.js           # schedule a bot
│   ├── status.js         # list + get download URLs
│   └── stop.js           # cancel / force leave
├── data/
│   └── recordings.json   # shared state (skill + app)
└── app/
    ├── server.js         # Express backend
    ├── package.json
    └── public/
        └── index.html    # single-page UI
```
