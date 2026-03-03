# SoundWave (Spotify-Inspired Clone)

A lightweight Spotify-style music web app where users can:

- Upload their own audio tracks
- Search and discover songs in the library
- Play tracks with a persistent bottom player

## Run locally

```bash
node server.js
```

Then open `http://localhost:3000`.

## Notes

- Uploaded songs are stored in browser `localStorage` as Data URLs.
- This keeps the app dependency-free, but large audio files may hit browser storage limits.
