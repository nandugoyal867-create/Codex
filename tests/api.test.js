const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const PORT = 3200;
const BASE = `http://127.0.0.1:${PORT}`;
let server;
let token;
let songId;

function waitForStart() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('server timeout')), 8000);
    server.stdout.on('data', (d) => {
      if (d.toString().includes('Spotify clone is running')) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}

test.before(async () => {
  server = spawn('node', ['server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForStart();
});

test.after(() => { if (server) server.kill('SIGTERM'); });

test('register and login flow', async () => {
  const email = `user${Date.now()}@test.dev`;
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'pass123', displayName: 'Tester' })
  });
  assert.equal(reg.status, 201);
  const regBody = await reg.json();
  assert.ok(regBody.token);

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'pass123' })
  });
  assert.equal(login.status, 200);
  token = (await login.json()).token;
  assert.ok(token);
});

test('upload, search, stream, recommendations, playlist', async () => {
  const dataUrl = `data:audio/mpeg;base64,${Buffer.from('fake-audio-bytes').toString('base64')}`;
  const upload = await fetch(`${BASE}/api/songs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Track One', artist: 'Artist One', album: 'Album One', genre: 'Pop', dataUrl })
  });
  assert.equal(upload.status, 201);
  const uploaded = await upload.json();
  songId = uploaded.id;
  assert.ok(songId);

  const list = await fetch(`${BASE}/api/songs?search=track`);
  const songs = await list.json();
  assert.ok(songs.some((s) => s.id === songId));

  const stream = await fetch(`${BASE}/api/stream/${songId}`, { headers: { Range: 'bytes=0-3' } });
  assert.equal(stream.status, 206);

  const rec = await fetch(`${BASE}/api/recommendations`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(rec.status, 200);
  const recSongs = await rec.json();
  assert.ok(Array.isArray(recSongs));

  const createPlaylist = await fetch(`${BASE}/api/playlists`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'My Mix', isPublic: true })
  });
  assert.equal(createPlaylist.status, 201);
  const pl = await createPlaylist.json();

  const addSong = await fetch(`${BASE}/api/playlists/${pl.id}/songs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ songId })
  });
  assert.equal(addSong.status, 200);

  const library = await fetch(`${BASE}/api/library`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(library.status, 200);
});

