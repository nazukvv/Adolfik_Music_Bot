# Adolfik — Privacy Policy

_Last updated: 9 November 2026_

This policy explains what data Adolfik (the Discord bot and its Discord Activity) processes,
why, and for how long. Adolfik is a free, non-commercial hobby project. It does **not** sell,
rent or share your data, show ads, or use your data for tracking or profiling.

## 1. Data we process

**When you use the bot (slash commands, buttons, music channel):**
- Discord IDs and names of users, servers and channels involved in a request
  (for example, who requested a track, which voice channel to join).
- The search query or YouTube link you send. In the music channel, your message is read only
  to get the query and is **deleted from the channel immediately** after reading.
- Your current voice channel, to check that only listeners in the same channel can control playback.

**When you open the Activity:**
- Through Discord OAuth2 with the `identify` scope only: your Discord user ID, username and avatar.
  We never receive your email, password or messages.
- A temporary session token stored in the Activity while it is open.

**Server settings:**
- If a server admin uses `/setup`, the IDs of the music channel and its panel message are saved
  so the panel keeps working after restarts.

## 2. Why we process it
Only to provide the service: find and play the requested music, show the queue and the player,
enforce "same voice channel" controls, and keep the music channel working.

## 3. Storage and retention
- The queue, current track and Activity sessions are kept **in memory only** and are lost when
  playback stops or the bot restarts.
- Server settings (music channel ID and panel message ID) are kept until an admin runs `/unsetup`,
  deletes the channel, or removes the bot.
- Technical logs (for example, track titles played, server names, Activity logins with user ID
  and name, and error details) are kept on the server for troubleshooting and are rotated
  automatically (about 20 MB of log files plus the system journal; older entries are overwritten).

## 4. Third parties
- **Discord** — the platform the bot runs on ([Discord Privacy Policy](https://discord.com/privacy)).
- **YouTube / Google** — your search query or link is sent to YouTube to find and stream the audio
  ([Google Privacy Policy](https://policies.google.com/privacy)).
- **Cloudflare** — the Activity is served through a Cloudflare tunnel
  ([Cloudflare Privacy Policy](https://www.cloudflare.com/privacypolicy/)).
- **Oracle Cloud** — hosting of the bot.

## 5. Your rights
You can stop all processing at any time by not using the bot, leaving the Activity, or asking a
server admin to remove the bot. You can request access to or deletion of data related to you
(for example, log entries) by opening an issue at
<https://github.com/nazukvv/Adolfik_Music_Bot/issues>; we will handle it as soon as reasonably possible.

## 6. Children
The service is intended only for users who meet Discord's minimum age requirements.

## 7. Changes
This policy may be updated. The current version is always available at this address.
