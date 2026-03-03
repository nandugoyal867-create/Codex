# SoundWave (Spotify-Inspired Clone)

A Spotify-style music web app where users can:

- Upload their audio tracks
- Search and discover songs
- Play tracks from a bottom audio player

## Run locally

```bash
node server.js
```

Open: `http://localhost:3000`

## Storage model

- Uploaded songs are saved on the server filesystem in `uploads/`
- Song metadata is saved in `data/songs.json`

## Save uploaded songs to GitHub (optional)

Yes — you can configure automatic GitHub sync. When enabled, each upload is pushed to your GitHub repository using the GitHub Contents API.

Set these environment variables before starting the server:

- `GITHUB_TOKEN`: GitHub token with repo write access
- `GITHUB_REPO`: repository in `owner/repo` format
- `GITHUB_BRANCH` (optional): target branch (default `main`)
- `GITHUB_BASE_PATH` (optional): folder path in repo (default `storage`)

Example:

```bash
GITHUB_TOKEN=ghp_xxx \
GITHUB_REPO=my-user/my-music-repo \
GITHUB_BRANCH=main \
GITHUB_BASE_PATH=soundwave \
node server.js
```

When configured, uploads are still stored locally and also synced to GitHub.
