# SoundWave – Spotify-like Streaming App

SoundWave is a modular Spotify-inspired web app with:

- Authentication (register/login with token sessions)
- Real-time activity feed (Server-Sent Events)
- Music upload and optimized streaming (HTTP range requests)
- Search (songs/artists/genres)
- Playlists and liked songs
- User profile and listening history
- Recommendation endpoint based on listening behavior
- Premium upgrade logic (e.g. 320kbps stream gate)
- Relational database architecture (SQLite)

## Tech Architecture

- **Frontend:** Modular vanilla JS components + dark Spotify-style UI
- **Backend:** Node HTTP API
- **Database:** SQLite (`node:sqlite`) with relational tables
- **Streaming optimization:** Partial content (`206`) + `Accept-Ranges` + caching headers
- **Realtime:** `/api/events` via SSE

## Relational Data Model

Core tables implemented:

- `users`
- `artists`
- `albums`
- `songs`
- `playlists`
- `playlist_songs` (many-to-many)
- `user_liked_songs`
- `user_history`
- `user_followers`

Database file: `data/spotify.db`

## Run

```bash
npm test
node server.js
```

Open: `http://localhost:3000`

## API Highlights

- `POST /api/auth/register`, `POST /api/auth/login`
- `GET /api/me`
- `GET /api/songs`, `POST /api/songs`
- `GET /api/stream/:id` (supports `Range`)
- `GET /api/recommendations`
- `POST /api/playlists`, `POST /api/playlists/:id/songs`
- `GET /api/library`
- `POST /api/likes`
- `POST /api/premium/upgrade`
- `GET /api/events`

## Notes

This is a production-style architecture demo in a lightweight single-service setup. For internet-scale usage, move media storage to S3/CDN, use Redis caching, and split auth/streaming/recommendation into separate services.
