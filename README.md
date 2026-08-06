# Jakub's Upcoming Sites/Games

````
```json
{
  "kind": "game",
  "release": "2026-12-24T18:00:00Z",
  "url": "https://jakubsenczyszyn2015-netizen.github.io/neon-drift/",
  "action": "play",
  "desc": "A short pitch for the project."
}
```
````

| field | meaning |
|---|---|
| `kind` | `game` or `site` |
| `release` | ISO 8601 UTC timestamp the countdown targets |
| `url_b64` | base64 of the destination link — what the admin form writes |
| `url` | plain-text destination link; still read, but visible to anyone browsing the issue |
| `action` | `play` (open link) or `download` |
| `desc` | short description on the card |
| `updates` | array of `{ "version", "date", "notes" }` — the changelog |

## Updates

Add entries to `updates` to announce patches for something already out:

```json
"updates": [
  { "version": "1.2", "date": "2026-09-01T12:00:00Z", "notes": "New track, physics fix." },
  { "version": "1.1", "date": "2026-08-20T12:00:00Z", "notes": "Controller support." }
]
```

- Entries dated in the **past** appear in a "What's new" changelog on the card, newest
  first, and the newest version number shows as a badge next to the title.
- An entry dated in the **future** turns the card's countdown into a *next update*
  countdown. The play button stays unlocked the whole time — the project is already out.

## Clock accuracy

Countdowns are driven by the `Date` header on GitHub's responses, not the visitor's own
clock, so a device running fast or slow shows the same remaining time as everyone else.
The offset is re-measured on every poll.

## Hype & notifications

Each card has one **🔥 Hype & notify me** button. It marks the project as hyped and asks
for browser notification permission; when that project releases or ships an update you get
a notification and confetti launches up from the bottom of the screen.

Subscriptions are stored in `localStorage`, so this is per-browser and only fires while the
site is open in a tab — there is no server, so no email or push-when-closed. The 🔥 number
beside *Details* is the issue's GitHub reaction count, which is why adding to it happens on
the issue itself.

Any open issue whose body contains a valid JSON block shows up on the site — the `game`
label is optional tidiness, not a requirement. Close an issue and it disappears from the
site within five seconds. Until the release time the button stays locked; at zero it
unlocks automatically.

The site re-reads the issues **every 5 seconds**, using an `ETag` conditional request so an
unchanged list returns `304` and does not count against GitHub's unauthenticated rate limit.
Polling pauses while the tab is in the background.

### About hiding the link

`url_b64` keeps the link from being readable at a glance in the issue, and the site does not
write the `href` into the page until the countdown reaches zero. Both are obfuscation, not
security — the site is static, so anything it can reach, a determined visitor can also reach
by decoding the issue body. If a link genuinely must not leak early, leave it out of the issue
and add it at release time.

## Admin tab

Code: `***`. It gates the UI only — anyone reading the source can see it, so treat it as
convenience, not security. The real protection is GitHub: creating or editing an issue requires
write access to this repo.

The admin form builds the entry and offers two ways to publish:

- **A** — opens a pre-filled GitHub issue; press Create.
- **B** — paste a fine-grained PAT with *Issues: read & write* and it posts through the API.
  The token is used for that one request and never stored.
