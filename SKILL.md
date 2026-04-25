---
name: meeting-recorder
description: Schedule unattended cloud recordings of Zoom, Google Meet, or Microsoft Teams sessions via the Recall.ai API. Use whenever the user wants to record an online meeting at a specific future time without being present to start/stop it, or wants to retrieve past recordings that were scheduled through this skill. Handles booking the bot (single or multiple sessions), checking status, and fetching signed download URLs. Meetings must be at least ~10 minutes in the future when booked.
requires:
  env:
    - RECALL_API_KEY
  binaries:
    - node
---

# Meeting Recorder

Schedule unattended meeting recordings using Recall.ai bots. The bot joins the call at `start_at`, records audio+video, and leaves when the host ends the meeting (or at a hard stop if specified).

## When to invoke

- "Record my Zoom tomorrow at 9am"
- "Schedule a recording for the Sunday service"
- "Book a recorder for this meeting: <url>"
- "Where's the video from Saturday's meeting?"
- "Cancel the Sunday recording"

## Preflight

1. Confirm `RECALL_API_KEY` is set. If not, stop and ask the user to export it. Do not proceed without it.
2. Confirm `node --version` is 20+. Scripts use the built-in `fetch`.

## Workflow: book a recording

Required from the user:
- **Meeting URL** — a Zoom, Meet, or Teams link
- **Start time** — exact local clock time + date. Convert to ISO-8601 with offset. User is in East TN (America/New_York) unless they say otherwise.
- **Stop time** — same format. If the user just gives a duration ("8 hours"), compute stop = start + duration.
- **Label** *(optional)* — short name like "Sunday service" for later lookup

If `start_at` is less than 12 minutes from now, warn the user: Recall requires ~10 min lead time for scheduled bots.

Run:
```bash
node scripts/book.js --url "<MEETING_URL>" --start "<ISO8601>" --stop "<ISO8601>" --label "<LABEL>"
```

The script writes to `data/recordings.json` and prints the Recall bot ID. Present the bot ID and confirm the schedule back to the user in plain language ("Booked. Bot will join at 9:00 AM Saturday and record until 5:00 PM. Bot ID: abc-123").

For multi-session bookings (e.g. "record Saturday and Sunday both"), call book.js once per session. Do not try to batch.

## Workflow: check status / get recordings

Run:
```bash
node scripts/status.js
```

This lists every recording ever booked via this skill with:
- label
- scheduled times
- current status (scheduled / joining / recording / processing / completed / failed)
- download URL for video + transcript if available

When presenting to the user:
- If a recording is `completed`, give the signed download URL as a plain clickable link
- If `processing`, tell them to check back in ~10 minutes
- If `failed`, show the error code from Recall

To filter to one: `node scripts/status.js --label "Sunday service"` or `node scripts/status.js --bot <bot_id>`

## Workflow: cancel or hard-stop

For a bot that hasn't joined yet, or to force a bot out of an active call:
```bash
node scripts/stop.js <bot_id>
```

Confirm with the user before calling stop — this is destructive.

## Time zone handling

The user rarely types ISO-8601. They say "tomorrow at 9am" or "Sunday 10:30 to 5". Always:
1. Resolve "tomorrow"/"Sunday" to a specific date using the current date.
2. Assume America/New_York (East TN) unless told otherwise.
3. Emit ISO-8601 with **explicit UTC offset** — never a bare local time or UTC "Z" time.
   - Kevin says "EST" to mean his local Eastern Time regardless of DST.
   - Current offset is `-04:00` (Eastern Daylight Time, Mar–Nov).
   - Winter offset is `-05:00` (Eastern Standard Time, Nov–Mar).
   - Always derive the correct offset from the current date, not from the word "EST".
4. **Before calling book.js**, verify: convert your ISO string back to UTC and confirm it is in the future. If it resolves to a past time or within 12 minutes, stop and tell the user.
5. Read back the resolved wall-clock time and date to the user before booking, so a time-zone mistake is caught before the bot is scheduled.
6. **Double-check:** `2026-04-27T10:00:00-04:00` = `2026-04-27T14:00:00Z`. That UTC time must be > now (UTC) at the moment of booking.

## Output format

After any action, report three things succinctly:
1. What was done
2. The affected bot ID(s) or label(s)
3. The next thing the user might want (e.g. "Run status again after 5 PM to get the download link.")

Keep responses short. Do not dump raw JSON unless asked.

## Gotchas

- **10-minute floor**: bookings <10 minutes in the future go to Recall's ad-hoc pool and can 507. Warn the user.
- **Region**: this skill defaults to `us-east-1`. If the user's Recall account is in another region, they can set `RECALL_REGION` env var.
- **Download URLs are signed and temporary** (typically 7 days). For long-term storage, the user should download promptly or set up their own S3 mirror.
- **State lives in `data/recordings.json`** relative to the skill directory. Do not delete this file or bot IDs become unfindable.
- The bot leaves automatically when the host ends the meeting. A hard `stop_at` is only needed if the host might leave the meeting open past the intended end.
