(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const status = $('status');
  const editor = $('editor');
  let session = null;
  let busy = false;

  const imageTypes = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp'
  };

  function setStatus(message, kind = '') {
    status.textContent = message;
    status.className = `status ${kind}`.trim();
  }

  function setBusy(value) {
    busy = value;
    for (const id of ['connect-button', 'logo-button', 'photo-button']) {
      $(id).disabled = value;
    }
  }

  function checkName(value, label) {
    const name = value.trim();
    if (!/^[A-Za-z0-9_.-]+$/.test(name) || name === '.' || name === '..') {
      throw new Error(`${label} tidak valid.`);
    }
    return name;
  }

  function checkBranch(value) {
    const branch = value.trim();
    if (!branch || !/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes('..') || branch.includes('//') || branch.startsWith('/') || branch.endsWith('/')) {
      throw new Error('Nama branch tidak valid.');
    }
    return branch;
  }

  function apiURL(path, query = '') {
    return `https://api.github.com/repos/${encodeURIComponent(session.owner)}/${encodeURIComponent(session.repo)}${path}${query}`;
  }

  async function api(method, path, body, query = '') {
    const response = await fetch(apiURL(path, query), {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${session.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.message || `GitHub mengembalikan HTTP ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function contentPath(path) {
    const fullPath = session.siteDir ? `${session.siteDir}/${path}` : path;
    return '/contents/' + fullPath.split('/').map(encodeURIComponent).join('/');
  }

  function decodeBase64UTF8(value) {
    const bytes = Uint8Array.from(atob(value.replace(/\s/g, '')), char => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function encodeUTF8Base64(value) {
    return bytesToBase64(new TextEncoder().encode(value));
  }

  function bytesToBase64(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  }

  async function readManifest() {
    const file = await api('GET', contentPath('site-content.json'), undefined, `?ref=${encodeURIComponent(session.branch)}`);
    if (file.type !== 'file' || file.encoding !== 'base64' || !file.sha || !file.content) {
      throw new Error('site-content.json tidak dapat dibaca pada branch yang dipilih.');
    }
    const manifest = JSON.parse(decodeBase64UTF8(file.content));
    if (!manifest || !Array.isArray(manifest.photos)) {
      throw new Error('Format site-content.json tidak valid.');
    }
    return { manifest, sha: file.sha };
  }

  async function putContent(path, content, message, sha) {
    return api('PUT', contentPath(path), {
      message,
      content,
      branch: session.branch,
      ...(sha ? { sha } : {})
    });
  }

  function assetURL(path) {
    if (typeof path !== 'string' || !/^assets\/[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp)$/i.test(path) || path.includes('..')) return null;
    return new URL(path, location.href).href;
  }

  function renderManifest(manifest) {
    const logoURL = assetURL(manifest.logo);
    $('logo-preview').hidden = !logoURL;
    if (logoURL) $('logo-preview').src = logoURL;
    const list = $('photo-list');
    list.replaceChildren();
    for (const item of manifest.photos) {
      const url = assetURL(item?.src);
      if (!url) continue;
      const card = document.createElement('article');
      card.className = 'photo-item';
      const image = document.createElement('img');
      image.src = url;
      image.alt = String(item.title || 'Foto kegiatan');
      image.loading = 'lazy';
      const caption = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = String(item.title || 'Kegiatan madrasah');
      caption.appendChild(title);
      if (item.date) {
        const date = document.createElement('small');
        date.textContent = String(item.date);
        caption.appendChild(date);
      }
      card.append(image, caption);
      list.appendChild(card);
    }
    if (!list.childElementCount) list.textContent = 'Belum ada foto kegiatan yang diunggah.';
  }

  function validateImage(file, maxSize) {
    if (!file || !imageTypes[file.type]) throw new Error('Pilih gambar PNG, JPG, atau WebP.');
    if (file.size > maxSize) throw new Error(`Ukuran gambar melebihi ${Math.round(maxSize / 1048576)} MB.`);
    if (file.size === 0) throw new Error('File gambar kosong.');
    return imageTypes[file.type];
  }

  async function saveManifest(change, message) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { manifest, sha } = await readManifest();
      change(manifest);
      try {
        await putContent('site-content.json', encodeUTF8Base64(JSON.stringify(manifest, null, 2) + '\n'), message, sha);
        renderManifest(manifest);
        return;
      } catch (error) {
        if (error.status !== 409 || attempt === 2) throw error;
      }
    }
  }

  async function upload(kind, file, details = {}) {
    const extension = validateImage(file, kind === 'logo' ? 2 * 1048576 : 5 * 1048576);
    const unique = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const path = kind === 'logo' ? `assets/logo-${unique}.${extension}` : `assets/kegiatan/${unique}.${extension}`;
    const content = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
    setStatus('Mengunggah gambar ke GitHub…');
    await putContent(path, content, kind === 'logo' ? 'Perbarui logo madrasah' : `Tambah foto kegiatan: ${details.title}`);
    setStatus('Gambar tersimpan. Memperbarui halaman publik…');
    try {
      await saveManifest(manifest => {
        if (kind === 'logo') manifest.logo = path;
        else manifest.photos.unshift({ src: path, title: details.title, date: details.date || '' });
      }, kind === 'logo' ? 'Tampilkan logo baru' : 'Tampilkan foto kegiatan baru');
    } catch (error) {
      throw new Error(`Gambar tersimpan sebagai ${path}, tetapi daftar situs belum diperbarui: ${error.message}`);
    }
    setStatus('Berhasil. Perubahan akan tampil setelah GitHub Pages selesai menerbitkan situs.', 'success');
  }

  $('connect-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      session = {
        owner: checkName($('owner').value, 'Pemilik repositori'),
        repo: checkName($('repo').value, 'Nama repositori'),
        branch: '',
        siteDir: $('site-dir').value === 'docs' ? 'docs' : '',
        token: $('token').value.trim()
      };
      if (!session.token) throw new Error('Token GitHub diperlukan.');
      setStatus('Memeriksa repositori dan token…');
      const repository = await api('GET', '');
      session.branch = checkBranch($('branch').value || repository.default_branch);
      const { manifest } = await readManifest();
      $('token').value = '';
      $('token').required = false;
      for (const id of ['owner', 'repo', 'branch', 'site-dir']) $(id).disabled = true;
      $('connect-button').hidden = true;
      $('disconnect-button').hidden = false;
      editor.hidden = false;
      renderManifest(manifest);
      setStatus(`Terhubung ke ${session.owner}/${session.repo} pada branch ${session.branch}, folder /${session.siteDir || '(root)'}.`, 'success');
    } catch (error) {
      session = null;
      setStatus(`Gagal terhubung: ${error.message}`, 'error');
    } finally {
      setBusy(false);
    }
  });

  $('disconnect-button').addEventListener('click', () => {
    session = null;
    editor.hidden = true;
    $('connect-button').hidden = false;
    $('disconnect-button').hidden = true;
    $('token').required = true;
    $('token').value = '';
    for (const id of ['owner', 'repo', 'branch', 'site-dir']) $(id).disabled = false;
    setStatus('Akses diputuskan. Token telah dihapus dari sesi halaman.');
  });

  $('logo-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!session || busy) return;
    setBusy(true);
    try {
      await upload('logo', $('logo-file').files[0]);
      $('logo-form').reset();
    } catch (error) {
      setStatus(`Gagal mengunggah logo: ${error.message}`, 'error');
    } finally {
      setBusy(false);
    }
  });

  $('photo-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!session || busy) return;
    setBusy(true);
    try {
      const title = $('photo-title').value.trim();
      if (!title) throw new Error('Judul kegiatan diperlukan.');
      await upload('photo', $('photo-file').files[0], { title, date: $('photo-date').value });
      $('photo-form').reset();
    } catch (error) {
      setStatus(`Gagal mengunggah foto: ${error.message}`, 'error');
    } finally {
      setBusy(false);
    }
  });

  const host = location.hostname.toLowerCase();
  if (host.endsWith('.github.io')) {
    const owner = host.slice(0, -'.github.io'.length);
    $('owner').value = owner;
    $('repo').value = decodeURIComponent(location.pathname.split('/').filter(Boolean)[0] || `${owner}.github.io`);
  }
})();
