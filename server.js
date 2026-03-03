const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');
const uploadsDir = path.join(__dirname, 'uploads');
const dataDir = path.join(__dirname, 'data');
const songsFile = path.join(dataDir, 'songs.json');

fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(songsFile)) {
  fs.writeFileSync(songsFile, '[]');
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4'
};

const githubConfig = {
  token: process.env.GITHUB_TOKEN,
  repo: process.env.GITHUB_REPO,
  branch: process.env.GITHUB_BRANCH || 'main',
  basePath: process.env.GITHUB_BASE_PATH || 'storage'
};

function readSongs() {
  return JSON.parse(fs.readFileSync(songsFile, 'utf8'));
}

function writeSongs(songs) {
  fs.writeFileSync(songsFile, JSON.stringify(songs, null, 2));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 25 * 1024 * 1024) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function parseDataUrl(dataUrl) {
  const match = /^data:(audio\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl || '');
  if (!match) {
    throw new Error('Invalid audio data format.');
  }

  const mimeType = match[1];
  const base64Data = match[2];
  const buffer = Buffer.from(base64Data, 'base64');
  return { mimeType, buffer };
}

function extensionFromMime(mimeType) {
  const mapping = {
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/ogg': '.ogg',
    'audio/mp4': '.m4a',
    'audio/x-m4a': '.m4a'
  };

  return mapping[mimeType] || '.bin';
}

function sanitizeForFilename(value) {
  return value.replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 40);
}

function githubEnabled() {
  return Boolean(githubConfig.token && githubConfig.repo);
}

async function githubRequest(method, apiPath, payload) {
  const response = await fetch(`https://api.github.com${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${githubConfig.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'soundwave-uploader'
    },
    body: payload ? JSON.stringify(payload) : undefined
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`GitHub API error (${response.status}): ${details}`);
  }

  return response.json();
}

async function putFileOnGithub(repoPath, contentBuffer, message) {
  const encodedPath = repoPath.split('/').map(encodeURIComponent).join('/');
  const existing = await githubRequest(
    'GET',
    `/repos/${githubConfig.repo}/contents/${encodedPath}?ref=${encodeURIComponent(githubConfig.branch)}`
  );

  await githubRequest('PUT', `/repos/${githubConfig.repo}/contents/${encodedPath}`, {
    message,
    content: contentBuffer.toString('base64'),
    branch: githubConfig.branch,
    sha: existing?.sha
  });
}

async function syncSongToGithub(song, audioBuffer) {
  if (!githubEnabled()) {
    return { synced: false, reason: 'GitHub sync not configured' };
  }

  const songPath = `${githubConfig.basePath}/uploads/${song.fileName}`;
  const metadataPath = `${githubConfig.basePath}/songs.json`;

  const songs = readSongs();

  await putFileOnGithub(songPath, audioBuffer, `Add song: ${song.title}`);
  await putFileOnGithub(metadataPath, Buffer.from(JSON.stringify(songs, null, 2)), 'Update songs metadata');

  return { synced: true };
}

function serveStatic(req, res) {
  const urlPath = req.url === '/' ? '/index.html' : req.url;
  const sanitizedPath = path.normalize(urlPath).replace(/^\.\.(\/|\\|$)/, '');
  const fullPath = path.join(publicDir, sanitizedPath);

  if (!fullPath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(fullPath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

function serveUpload(req, res) {
  const relPath = req.url.replace(/^\/uploads\//, '');
  const safe = path.basename(relPath);
  const fullPath = path.join(uploadsDir, safe);

  if (!fs.existsSync(fullPath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = path.extname(fullPath).toLowerCase();
  res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
  fs.createReadStream(fullPath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url.startsWith('/api/songs')) {
      const urlObj = new URL(req.url, `http://localhost:${PORT}`);
      const query = (urlObj.searchParams.get('search') || '').toLowerCase();
      const songs = readSongs();
      const filtered = query
        ? songs.filter((song) => `${song.title} ${song.artist} ${song.genre}`.toLowerCase().includes(query))
        : songs;
      sendJson(res, 200, filtered);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/songs') {
      const body = await parseBody(req);
      const title = body.title?.toString().trim();
      const artist = body.artist?.toString().trim();
      const genre = body.genre?.toString().trim() || 'Unknown';
      const dataUrl = body.dataUrl?.toString();

      if (!title || !artist || !dataUrl) {
        sendJson(res, 400, { error: 'title, artist, and dataUrl are required.' });
        return;
      }

      const { mimeType, buffer } = parseDataUrl(dataUrl);
      if (!mimeType.startsWith('audio/')) {
        sendJson(res, 400, { error: 'Only audio files are supported.' });
        return;
      }

      const ext = extensionFromMime(mimeType);
      const fileName = `${Date.now()}-${sanitizeForFilename(title)}${ext}`;
      const filePath = path.join(uploadsDir, fileName);
      fs.writeFileSync(filePath, buffer);

      const songs = readSongs();
      const song = {
        id: crypto.randomUUID(),
        title,
        artist,
        genre,
        fileName,
        mimeType,
        url: `/uploads/${fileName}`,
        createdAt: new Date().toISOString()
      };
      songs.unshift(song);
      writeSongs(songs);

      let githubSync = { synced: false, reason: 'GitHub sync not configured' };
      try {
        githubSync = await syncSongToGithub(song, buffer);
      } catch (error) {
        githubSync = { synced: false, reason: error.message };
      }

      sendJson(res, 201, { ...song, githubSync });
      return;
    }

    if (req.method === 'GET' && req.url.startsWith('/uploads/')) {
      serveUpload(req, res);
      return;
    }

    if (req.method === 'GET') {
      serveStatic(req, res);
      return;
    }

    sendJson(res, 404, { error: 'Route not found' });
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'Something went wrong.' });
  }
});

server.listen(PORT, () => {
  console.log(`Spotify clone is running on http://localhost:${PORT}`);
});
