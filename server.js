const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');
const uploadsDir = path.join(__dirname, 'uploads');
const dataDir = path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'spotify.db');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec(`
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS artists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  bio TEXT DEFAULT '',
  profile_image TEXT DEFAULT '',
  followers_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS albums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  artist_id INTEGER NOT NULL,
  cover_image TEXT DEFAULT '',
  release_date TEXT,
  FOREIGN KEY (artist_id) REFERENCES artists(id)
);
CREATE TABLE IF NOT EXISTS songs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  artist_id INTEGER NOT NULL,
  album_id INTEGER,
  duration INTEGER DEFAULT 0,
  audio_url TEXT NOT NULL,
  cover_image_url TEXT DEFAULT '',
  play_count INTEGER NOT NULL DEFAULT 0,
  genre TEXT DEFAULT 'Unknown',
  release_date TEXT,
  uploaded_by INTEGER,
  mime_type TEXT DEFAULT 'audio/mpeg',
  FOREIGN KEY (artist_id) REFERENCES artists(id),
  FOREIGN KEY (album_id) REFERENCES albums(id),
  FOREIGN KEY (uploaded_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  cover_image TEXT DEFAULT '',
  is_public INTEGER NOT NULL DEFAULT 1,
  followers_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS playlist_songs (
  playlist_id INTEGER NOT NULL,
  song_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, song_id),
  FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
  FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS user_liked_songs (
  user_id INTEGER NOT NULL,
  song_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, song_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS user_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  song_id INTEGER NOT NULL,
  listened_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS user_followers (
  follower_id INTEGER NOT NULL,
  following_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (follower_id, following_id),
  FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

function ensureSeedData() {
  const artistCount = db.prepare('SELECT COUNT(*) AS c FROM artists').get().c;
  if (artistCount === 0) {
    db.prepare('INSERT INTO artists (name, bio) VALUES (?, ?)').run('SoundWave Collective', 'Platform artists');
  }
}
ensureSeedData();

const sseClients = new Set();

function sendSse(event, payload) {
  const body = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    client.write(body);
  }
}

function json(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function parseJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 30 * 1024 * 1024) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function signToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  if (!token) return null;
  const [header, body, sig] = token.split('.');
  if (!header || !body || !sig) return null;
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  if (sig !== expected) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function getUserFromReq(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const decoded = verifyToken(token);
  if (!decoded?.sub) return null;
  return db.prepare('SELECT id, email, display_name AS displayName, plan, created_at AS createdAt FROM users WHERE id = ?').get(decoded.sub);
}

function parseDataUrl(dataUrl) {
  const m = /^data:(audio\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw new Error('Invalid audio data');
  return { mimeType: m[1], buffer: Buffer.from(m[2], 'base64') };
}

function extFromMime(mime) {
  return { 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a' }[mime] || '.bin';
}

function sanitize(str) {
  return str.replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 40);
}

function getSongFeed(whereClause = '', params = []) {
  const sql = `
    SELECT s.id, s.title, s.duration, s.audio_url AS audioUrl, s.cover_image_url AS coverImageUrl,
           s.play_count AS playCount, s.genre, s.release_date AS releaseDate,
           a.name AS artistName, al.title AS albumTitle
    FROM songs s
    JOIN artists a ON a.id = s.artist_id
    LEFT JOIN albums al ON al.id = s.album_id
    ${whereClause}
    ORDER BY s.id DESC
  `;
  return db.prepare(sql).all(...params);
}

function handleStream(req, res, songId, user) {
  const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(songId);
  if (!song) return json(res, 404, { error: 'Song not found' });

  const quality = new URL(req.url, `http://localhost:${PORT}`).searchParams.get('quality') || '160';
  if (quality === '320' && (!user || user.plan !== 'premium')) {
    return json(res, 402, { error: '320kbps streaming is premium only.' });
  }

  const fileName = path.basename(song.audio_url);
  const filePath = path.join(uploadsDir, fileName);
  if (!fs.existsSync(filePath)) return json(res, 404, { error: 'Audio file missing' });

  const stat = fs.statSync(filePath);
  const range = req.headers.range;
  const contentType = song.mime_type || 'audio/mpeg';

  db.prepare('UPDATE songs SET play_count = play_count + 1 WHERE id = ?').run(songId);
  if (user) {
    db.prepare('INSERT INTO user_history (user_id, song_id, listened_at) VALUES (?, ?, ?)').run(user.id, songId, new Date().toISOString());
  }

  sendSse('now-playing', { songId, title: song.title, userId: user?.id || null });

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = Number(parts[0]);
    const end = parts[1] ? Number(parts[1]) : stat.size - 1;
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400'
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    'Content-Length': stat.size,
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=86400'
  });
  fs.createReadStream(filePath).pipe(res);
}

function serveStatic(req, res) {
  const urlPath = req.url === '/' ? '/index.html' : req.url;
  const safePath = path.normalize(urlPath).replace(/^\.\.(\/|\\|$)/, '');
  const filePath = path.join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const urlObj = new URL(req.url, `http://localhost:${PORT}`);
    const user = getUserFromReq(req);

    if (req.method === 'GET' && urlObj.pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      });
      res.write('event: connected\ndata: {"ok":true}\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (req.method === 'POST' && urlObj.pathname === '/api/auth/register') {
      const body = await parseJson(req);
      if (!body.email || !body.password || !body.displayName) return json(res, 400, { error: 'email, password, displayName required' });
      const passwordHash = hashPassword(body.password);
      try {
        const createdAt = new Date().toISOString();
        const result = db.prepare('INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)')
          .run(body.email.toLowerCase(), passwordHash, body.displayName.trim(), createdAt);
        const token = signToken({ sub: result.lastInsertRowid, email: body.email.toLowerCase() });
        return json(res, 201, { token });
      } catch {
        return json(res, 409, { error: 'Email already exists' });
      }
    }

    if (req.method === 'POST' && urlObj.pathname === '/api/auth/login') {
      const body = await parseJson(req);
      const userRow = db.prepare('SELECT * FROM users WHERE email = ?').get((body.email || '').toLowerCase());
      if (!userRow || userRow.password_hash !== hashPassword(body.password || '')) return json(res, 401, { error: 'Invalid credentials' });
      const token = signToken({ sub: userRow.id, email: userRow.email });
      return json(res, 200, { token });
    }

    if (req.method === 'GET' && urlObj.pathname === '/api/me') {
      if (!user) return json(res, 401, { error: 'Unauthorized' });
      const followers = db.prepare('SELECT COUNT(*) AS c FROM user_followers WHERE following_id = ?').get(user.id).c;
      const following = db.prepare('SELECT COUNT(*) AS c FROM user_followers WHERE follower_id = ?').get(user.id).c;
      const playlists = db.prepare('SELECT COUNT(*) AS c FROM playlists WHERE user_id = ?').get(user.id).c;
      return json(res, 200, { ...user, followers, following, playlists });
    }

    if (req.method === 'POST' && urlObj.pathname === '/api/premium/upgrade') {
      if (!user) return json(res, 401, { error: 'Unauthorized' });
      db.prepare('UPDATE users SET plan = ? WHERE id = ?').run('premium', user.id);
      return json(res, 200, { ok: true, plan: 'premium' });
    }

    if (req.method === 'GET' && urlObj.pathname === '/api/songs') {
      const q = (urlObj.searchParams.get('search') || '').trim().toLowerCase();
      if (!q) return json(res, 200, getSongFeed());
      const like = `%${q}%`;
      return json(res, 200, getSongFeed('WHERE LOWER(s.title) LIKE ? OR LOWER(a.name) LIKE ? OR LOWER(s.genre) LIKE ?', [like, like, like]));
    }

    if (req.method === 'POST' && urlObj.pathname === '/api/songs') {
      if (!user) return json(res, 401, { error: 'Unauthorized' });
      const body = await parseJson(req);
      const { title, artist, album, genre, dataUrl } = body;
      if (!title || !artist || !dataUrl) return json(res, 400, { error: 'title, artist, dataUrl required' });

      const { mimeType, buffer } = parseDataUrl(dataUrl);
      const fileName = `${Date.now()}-${sanitize(title)}${extFromMime(mimeType)}`;
      fs.writeFileSync(path.join(uploadsDir, fileName), buffer);

      let artistRow = db.prepare('SELECT id FROM artists WHERE name = ?').get(artist.trim());
      if (!artistRow) {
        const ar = db.prepare('INSERT INTO artists (name) VALUES (?)').run(artist.trim());
        artistRow = { id: ar.lastInsertRowid };
      }

      let albumId = null;
      if (album?.trim()) {
        let albumRow = db.prepare('SELECT id FROM albums WHERE title = ? AND artist_id = ?').get(album.trim(), artistRow.id);
        if (!albumRow) {
          const al = db.prepare('INSERT INTO albums (title, artist_id, release_date) VALUES (?, ?, ?)').run(album.trim(), artistRow.id, new Date().toISOString().slice(0, 10));
          albumRow = { id: al.lastInsertRowid };
        }
        albumId = albumRow.id;
      }

      const releaseDate = new Date().toISOString().slice(0, 10);
      const result = db.prepare(`INSERT INTO songs (title, artist_id, album_id, audio_url, genre, release_date, uploaded_by, mime_type)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(title.trim(), artistRow.id, albumId, `/uploads/${fileName}`, (genre || 'Unknown').trim(), releaseDate, user.id, mimeType);

      return json(res, 201, { id: result.lastInsertRowid, audioUrl: `/api/stream/${result.lastInsertRowid}` });
    }

    if (req.method === 'GET' && urlObj.pathname.startsWith('/api/stream/')) {
      const songId = Number(urlObj.pathname.split('/').pop());
      return handleStream(req, res, songId, user);
    }

    if (req.method === 'POST' && urlObj.pathname === '/api/likes') {
      if (!user) return json(res, 401, { error: 'Unauthorized' });
      const body = await parseJson(req);
      db.prepare('INSERT OR IGNORE INTO user_liked_songs (user_id, song_id, created_at) VALUES (?, ?, ?)').run(user.id, body.songId, new Date().toISOString());
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && urlObj.pathname === '/api/recommendations') {
      const list = user
        ? db.prepare(`SELECT s.id, s.title, s.genre, a.name AS artistName, s.play_count AS playCount
                      FROM songs s JOIN artists a ON a.id=s.artist_id
                      WHERE s.genre IN (
                        SELECT s2.genre FROM user_history h JOIN songs s2 ON s2.id=h.song_id WHERE h.user_id=?
                        GROUP BY s2.genre ORDER BY COUNT(*) DESC LIMIT 3
                      )
                      ORDER BY s.play_count DESC, s.id DESC LIMIT 20`).all(user.id)
        : db.prepare(`SELECT s.id, s.title, s.genre, a.name AS artistName, s.play_count AS playCount
                      FROM songs s JOIN artists a ON a.id=s.artist_id
                      ORDER BY s.play_count DESC, s.id DESC LIMIT 20`).all();
      return json(res, 200, list);
    }

    if (req.method === 'POST' && urlObj.pathname === '/api/playlists') {
      if (!user) return json(res, 401, { error: 'Unauthorized' });
      const body = await parseJson(req);
      if (!body.name) return json(res, 400, { error: 'name required' });
      const r = db.prepare('INSERT INTO playlists (name, user_id, is_public, created_at) VALUES (?, ?, ?, ?)')
        .run(body.name.trim(), user.id, body.isPublic ? 1 : 0, new Date().toISOString());
      return json(res, 201, { id: r.lastInsertRowid });
    }

    if (req.method === 'POST' && urlObj.pathname.match(/^\/api\/playlists\/\d+\/songs$/)) {
      if (!user) return json(res, 401, { error: 'Unauthorized' });
      const playlistId = Number(urlObj.pathname.split('/')[3]);
      const owner = db.prepare('SELECT user_id FROM playlists WHERE id = ?').get(playlistId);
      if (!owner || owner.user_id !== user.id) return json(res, 403, { error: 'Forbidden' });
      const body = await parseJson(req);
      const pos = db.prepare('SELECT COALESCE(MAX(position),0)+1 AS p FROM playlist_songs WHERE playlist_id = ?').get(playlistId).p;
      db.prepare('INSERT OR IGNORE INTO playlist_songs (playlist_id, song_id, position) VALUES (?, ?, ?)').run(playlistId, body.songId, pos);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && urlObj.pathname === '/api/library') {
      if (!user) return json(res, 401, { error: 'Unauthorized' });
      const playlists = db.prepare('SELECT id, name, is_public AS isPublic, followers_count AS followersCount FROM playlists WHERE user_id = ? ORDER BY id DESC').all(user.id);
      const liked = db.prepare(`SELECT s.id, s.title, a.name AS artistName
                                FROM user_liked_songs l JOIN songs s ON s.id=l.song_id JOIN artists a ON a.id=s.artist_id
                                WHERE l.user_id = ? ORDER BY l.created_at DESC`).all(user.id);
      return json(res, 200, { playlists, likedSongs: liked });
    }

    if (req.method === 'GET' && urlObj.pathname.startsWith('/uploads/')) {
      const filePath = path.join(uploadsDir, path.basename(urlObj.pathname));
      if (!fs.existsSync(filePath)) return json(res, 404, { error: 'Not found' });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    if (req.method === 'GET') return serveStatic(req, res);
    return json(res, 404, { error: 'Route not found' });
  } catch (error) {
    return json(res, 500, { error: error.message || 'Unexpected error' });
  }
});

server.listen(PORT, () => {
  console.log(`Spotify clone is running on http://localhost:${PORT}`);
});
