const uploadForm = document.getElementById('uploadForm');
const uploadStatus = document.getElementById('uploadStatus');
const songList = document.getElementById('songList');
const searchInput = document.getElementById('searchInput');
const audioPlayer = document.getElementById('audioPlayer');
const nowPlayingTitle = document.getElementById('nowPlayingTitle');
const nowPlayingArtist = document.getElementById('nowPlayingArtist');
const playerPanel = document.getElementById('playerPanel');

let songsCache = [];

async function fetchSongs(query = '') {
  const suffix = query ? `?search=${encodeURIComponent(query)}` : '';
  const response = await fetch(`/api/songs${suffix}`);
  if (!response.ok) {
    throw new Error('Failed to load songs from server.');
  }
  return response.json();
}

async function loadSongs(query = '') {
  const songs = await fetchSongs(query.trim());
  songsCache = songs;
  renderSongs(songs);
}

function renderSongs(songs) {
  if (!songs.length) {
    songList.innerHTML = '<li class="song-item">No songs found. Upload one to get started!</li>';
    return;
  }

  songList.innerHTML = songs
    .map(
      (song) => `
      <li class="song-item">
        <div class="song-meta">
          <strong>${song.title}</strong>
          <p>${song.artist} • ${song.genre}</p>
        </div>
        <button data-song-id="${song.id}">Play</button>
      </li>
    `
    )
    .join('');
}

function setStatus(message, isError = false) {
  uploadStatus.textContent = message;
  uploadStatus.style.color = isError ? '#ff8a8a' : '#1db954';
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the selected audio file.'));
    reader.readAsDataURL(file);
  });
}

uploadForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus('Uploading...');

  try {
    const formData = new FormData(uploadForm);
    const title = formData.get('title')?.toString().trim();
    const artist = formData.get('artist')?.toString().trim();
    const genre = formData.get('genre')?.toString().trim() || 'Unknown';
    const songFile = formData.get('songFile');

    if (!title || !artist || !(songFile instanceof File) || !songFile.name) {
      throw new Error('Title, artist, and an audio file are required.');
    }

    if (!songFile.type.startsWith('audio/')) {
      throw new Error('Please upload a valid audio file.');
    }

    const dataUrl = await fileToDataUrl(songFile);
    const response = await fetch('/api/songs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, artist, genre, dataUrl })
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Upload failed.');
    }

    uploadForm.reset();

    if (payload.githubSync?.synced) {
      setStatus('Song uploaded and synced to GitHub.');
    } else if (payload.githubSync?.reason && payload.githubSync.reason !== 'GitHub sync not configured') {
      setStatus(`Uploaded locally, but GitHub sync failed: ${payload.githubSync.reason}`, true);
    } else {
      setStatus('Song uploaded to server storage.');
    }

    await loadSongs(searchInput.value);
  } catch (error) {
    setStatus(error.message, true);
  }
});

songList.addEventListener('click', (event) => {
  if (!(event.target instanceof HTMLButtonElement)) {
    return;
  }

  const songId = event.target.dataset.songId;
  const song = songsCache.find((item) => item.id === songId);

  if (!song) {
    return;
  }

  nowPlayingTitle.textContent = song.title;
  nowPlayingArtist.textContent = `${song.artist} • ${song.genre}`;
  audioPlayer.src = song.url;
  audioPlayer.play();
  playerPanel.hidden = false;
});

searchInput.addEventListener('input', () => {
  loadSongs(searchInput.value).catch((error) => setStatus(error.message, true));
});

loadSongs().catch((error) => setStatus(error.message, true));
