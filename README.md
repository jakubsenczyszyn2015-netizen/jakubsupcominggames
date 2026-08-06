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
| `url` | where the button goes once the countdown hits zero |
| `action` | `play` (open link) or `download` |
| `desc` | short description on the card |

Any open issue whose body contains a valid JSON block shows up on the site — the `game`
label is optional tidiness, not a requirement. Close an issue to remove it from the site.
Until the release time the button stays locked; at zero it unlocks automatically.

## Admin tab

Code: `***`. It gates the UI only — anyone reading the source can see it, so treat it as
convenience, not security. The real protection is GitHub: creating or editing an issue requires
write access to this repo.

The admin form builds the entry and offers two ways to publish:

- **A** — opens a pre-filled GitHub issue; press Create.
- **B** — paste a fine-grained PAT with *Issues: read & write* and it posts through the API.
  The token is used for that one request and never stored.
