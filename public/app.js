const uploadForm = document.getElementById('uploadForm');
const uploadStatus = document.getElementById('uploadStatus');
const songList = document.getElementById('songList');
const searchInput = document.getElementById('searchInput');
const audioPlayer = document.getElementById('audioPlayer');
const nowPlayingTitle = document.getElementById('nowPlayingTitle');
const nowPlayingArtist = document.getElementById('nowPlayingArtist');
const playerPanel = document.getElementById('playerPanel');

const STORAGE_KEY = 'soundwave-songs';
let songsCache = [];

function readSongs() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeSongs(songs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
}

function loadSongs(query = '') {
  const songs = readSongs();
  const normalizedQuery = query.trim().toLowerCase();
  songsCache = songs;

  if (!normalizedQuery) {
    renderSongs(songs);
    return;
  }

  const filtered = songs.filter((song) => {
    const haystack = `${song.title} ${song.artist} ${song.genre}`.toLowerCase();
    return haystack.includes(normalizedQuery);
  });

  renderSongs(filtered);
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

    const songDataUrl = await fileToDataUrl(songFile);
    const songs = readSongs();

    const newSong = {
      id: Date.now().toString(),
      title,
      artist,
      genre,
      dataUrl: songDataUrl
    };

    songs.unshift(newSong);
    writeSongs(songs);

    uploadForm.reset();
    setStatus('Song uploaded successfully!');
    loadSongs(searchInput.value);
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
  audioPlayer.src = song.dataUrl;
  audioPlayer.play();
  playerPanel.hidden = false;
});

searchInput.addEventListener('input', () => {
  loadSongs(searchInput.value);
});

loadSongs();
