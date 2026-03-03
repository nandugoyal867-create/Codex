const state = { token: localStorage.getItem('token') || '', songs: [], recommendations: [], me: null, currentPlaylistId: null };

const el = {
  authForm: document.getElementById('authForm'), authStatus: document.getElementById('authStatus'),
  uploadForm: document.getElementById('uploadForm'), uploadStatus: document.getElementById('uploadStatus'),
  searchInput: document.getElementById('searchInput'), songResults: document.getElementById('songResults'),
  recommendations: document.getElementById('recommendations'), libraryData: document.getElementById('libraryData'),
  playlistForm: document.getElementById('playlistForm'), profileData: document.getElementById('profileData'),
  premiumBtn: document.getElementById('premiumBtn'), audioPlayer: document.getElementById('audioPlayer'),
  nowPlaying: document.getElementById('nowPlaying'), nowPlayingMeta: document.getElementById('nowPlayingMeta'),
  authPanel: document.getElementById('authPanel')
};

function headers(json = false) {
  const h = {};
  if (state.token) h.Authorization = `Bearer ${state.token}`;
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...headers(options.body && typeof options.body === 'string'), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function setStatus(node, msg, err = false) { node.textContent = msg; node.style.color = err ? '#ff8a8a' : '#1db954'; }

function setAuthUi() {
  el.authPanel.style.display = state.token ? 'none' : 'block';
}

function songCard(song, includePlaylistAction = false) {
  return `<div class="item">
    <div><strong>${song.title}</strong><small>${song.artistName || ''} • ${song.genre || 'Unknown'} • plays ${song.playCount || 0}</small></div>
    <div class="row">
      <button data-play="${song.id}">Play</button>
      ${state.token ? `<button data-like="${song.id}">Like</button>` : ''}
      ${includePlaylistAction && state.currentPlaylistId ? `<button data-add="${song.id}">+Playlist</button>` : ''}
    </div>
  </div>`;
}

async function refreshSongs(query = '') {
  state.songs = await api(`/api/songs${query ? `?search=${encodeURIComponent(query)}` : ''}`);
  el.songResults.innerHTML = state.songs.map((s) => songCard(s, true)).join('') || '<div class="item">No songs</div>';
}

async function refreshRecommendations() {
  state.recommendations = await api('/api/recommendations');
  el.recommendations.innerHTML = state.recommendations.map((s) => songCard(s)).join('') || '<div class="item">No recommendations yet</div>';
}

async function refreshProfile() {
  if (!state.token) {
    el.profileData.innerHTML = '<p>Login to view profile.</p>';
    return;
  }
  state.me = await api('/api/me');
  el.profileData.innerHTML = `<p><strong>${state.me.displayName}</strong> (${state.me.email})</p>
    <p>Plan: ${state.me.plan}</p>
    <p>Followers: ${state.me.followers} • Following: ${state.me.following} • Playlists: ${state.me.playlists}</p>`;
}

async function refreshLibrary() {
  if (!state.token) {
    el.libraryData.innerHTML = '<div class="item">Login to view library</div>';
    return;
  }
  const data = await api('/api/library');
  const playlists = data.playlists.map((p) => `<div class="item"><div><strong>${p.name}</strong><small>${p.isPublic ? 'Public' : 'Private'}</small></div><button data-pick-playlist="${p.id}">Use for add</button></div>`).join('') || '<div class="item">No playlists</div>';
  const likes = data.likedSongs.map((s) => `<div class="item"><div><strong>${s.title}</strong><small>${s.artistName}</small></div></div>`).join('') || '<div class="item">No liked songs</div>';
  el.libraryData.innerHTML = `<h3>Playlists</h3>${playlists}<h3>Liked Songs</h3>${likes}`;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed reading file'));
    reader.readAsDataURL(file);
  });
}

function playSong(songId) {
  const song = [...state.songs, ...state.recommendations].find((s) => Number(s.id) === Number(songId));
  if (!song) return;
  el.audioPlayer.src = `/api/stream/${song.id}`;
  el.audioPlayer.play();
  el.nowPlaying.textContent = song.title;
  el.nowPlayingMeta.textContent = `${song.artistName || ''} • ${song.genre || 'Unknown'}`;
}

el.authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(el.authForm);
  const mode = e.submitter?.value || 'login';
  try {
    const payload = mode === 'register'
      ? await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: fd.get('email'), password: fd.get('password'), displayName: fd.get('displayName') || 'Listener' }) })
      : await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: fd.get('email'), password: fd.get('password') }) });
    state.token = payload.token;
    localStorage.setItem('token', state.token);
    setStatus(el.authStatus, `Success: ${mode}`);
    setAuthUi();
    await Promise.all([refreshProfile(), refreshLibrary(), refreshRecommendations()]);
  } catch (error) {
    setStatus(el.authStatus, error.message, true);
  }
});

el.uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.token) return setStatus(el.uploadStatus, 'Login required', true);
  const fd = new FormData(el.uploadForm);
  const songFile = fd.get('songFile');
  if (!(songFile instanceof File) || !songFile.type.startsWith('audio/')) return setStatus(el.uploadStatus, 'Select an audio file', true);
  try {
    const dataUrl = await fileToDataUrl(songFile);
    await api('/api/songs', { method: 'POST', body: JSON.stringify({ title: fd.get('title'), artist: fd.get('artist'), album: fd.get('album'), genre: fd.get('genre'), dataUrl }) });
    el.uploadForm.reset();
    setStatus(el.uploadStatus, 'Uploaded');
    await Promise.all([refreshSongs(el.searchInput.value), refreshRecommendations()]);
  } catch (error) {
    setStatus(el.uploadStatus, error.message, true);
  }
});

el.searchInput.addEventListener('input', () => { refreshSongs(el.searchInput.value).catch(() => {}); });

el.songResults.addEventListener('click', async (e) => {
  const t = e.target;
  if (!(t instanceof HTMLButtonElement)) return;
  if (t.dataset.play) playSong(t.dataset.play);
  if (t.dataset.like) await api('/api/likes', { method: 'POST', body: JSON.stringify({ songId: Number(t.dataset.like) }) }).then(refreshLibrary).catch(() => {});
  if (t.dataset.add && state.currentPlaylistId) await api(`/api/playlists/${state.currentPlaylistId}/songs`, { method: 'POST', body: JSON.stringify({ songId: Number(t.dataset.add) }) }).then(() => alert('Added to playlist')).catch((err) => alert(err.message));
});

el.recommendations.addEventListener('click', (e) => {
  const t = e.target;
  if (t instanceof HTMLButtonElement && t.dataset.play) playSong(t.dataset.play);
});

el.libraryData.addEventListener('click', (e) => {
  const t = e.target;
  if (t instanceof HTMLButtonElement && t.dataset.pickPlaylist) {
    state.currentPlaylistId = Number(t.dataset.pickPlaylist);
    alert(`Playlist ${state.currentPlaylistId} selected. Use +Playlist in search results.`);
  }
});

el.playlistForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.token) return;
  const fd = new FormData(el.playlistForm);
  await api('/api/playlists', { method: 'POST', body: JSON.stringify({ name: fd.get('playlistName'), isPublic: true }) });
  el.playlistForm.reset();
  refreshLibrary();
});

el.premiumBtn.addEventListener('click', async () => {
  if (!state.token) return alert('Login first');
  await api('/api/premium/upgrade', { method: 'POST', body: '{}' });
  await refreshProfile();
  alert('Premium activated (320kbps allowed).');
});

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.view').forEach((x) => x.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');
  });
});

const ev = new EventSource('/api/events');
ev.addEventListener('now-playing', (event) => {
  const d = JSON.parse(event.data);
  console.log('Realtime now playing', d);
});

setAuthUi();
Promise.all([refreshSongs(), refreshRecommendations(), refreshProfile(), refreshLibrary()]).catch(() => {});
