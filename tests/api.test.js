const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const PORT = 3200;
const BASE_URL = `http://127.0.0.1:${PORT}`;
let server;

function waitForServerStart() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server start timeout')), 8000);

    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('Spotify clone is running')) {
        clearTimeout(timer);
        resolve();
      }
    });

    server.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited early: ${code}`));
    });
  });
}

test.before(async () => {
  server = spawn('node', ['server.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await waitForServerStart();
});

test.after(() => {
  if (server) {
    server.kill('SIGTERM');
  }
});

test('GET /api/songs responds with array', async () => {
  const response = await fetch(`${BASE_URL}/api/songs`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(Array.isArray(body));
});

test('POST /api/songs stores and returns metadata', async () => {
  const dataUrl = `data:audio/mpeg;base64,${Buffer.from('fake-audio').toString('base64')}`;

  const upload = await fetch(`${BASE_URL}/api/songs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Hello', artist: 'Tester', genre: 'Pop', dataUrl })
  });

  assert.equal(upload.status, 201);
  const song = await upload.json();
  assert.equal(song.title, 'Hello');
  assert.match(song.url, /^\/uploads\//);

  const search = await fetch(`${BASE_URL}/api/songs?search=hello`);
  const results = await search.json();
  assert.ok(results.some((item) => item.id === song.id));
});
