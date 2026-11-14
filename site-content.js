(() => {
  'use strict';

  function assetURL(path) {
    if (typeof path !== 'string' || !/^assets\/[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp)$/i.test(path) || path.includes('..')) return null;
    return new URL(path, document.baseURI).href;
  }

  function showLogo(path) {
    const url = assetURL(path);
    if (!url) return;
    for (const image of document.querySelectorAll('.school-logo-img')) {
      image.src = url;
      image.classList.remove('hidden');
    }
    for (const fallback of document.querySelectorAll('.school-logo-default')) {
      fallback.classList.add('hidden');
    }
    const favicon = document.getElementById('dynamic-favicon');
    if (favicon) favicon.href = url;
  }

  function showPhotos(photos) {
    const section = document.getElementById('published-gallery-section');
    const grid = document.getElementById('published-gallery');
    if (!section || !grid || !Array.isArray(photos)) return;
    grid.replaceChildren();
    for (const item of photos) {
      const url = assetURL(item?.src);
      if (!url) continue;
      const card = document.createElement('figure');
      card.className = 'published-photo';
      const image = document.createElement('img');
      image.src = url;
      image.alt = String(item.title || 'Foto kegiatan madrasah');
      image.loading = 'lazy';
      const caption = document.createElement('figcaption');
      const title = document.createElement('strong');
      title.textContent = String(item.title || 'Kegiatan madrasah');
      caption.appendChild(title);
      if (item.date && /^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
        const date = document.createElement('time');
        date.dateTime = item.date;
        date.textContent = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${item.date}T00:00:00Z`));
        caption.appendChild(date);
      }
      card.append(image, caption);
      grid.appendChild(card);
    }
    section.hidden = !grid.childElementCount;
  }

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const response = await fetch('site-content.json', { cache: 'no-store' });
      if (!response.ok) return;
      const content = await response.json();
      showLogo(content.logo);
      showPhotos(content.photos);
    } catch (error) {
      console.warn('Konten tambahan belum tersedia:', error);
    }
  });
})();
