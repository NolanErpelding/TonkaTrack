/* ============================================================================
   team-page.js — shared logic for all team pages (boys-xc, girls-xc,
   boys-track, girls-track).

   Each team page must define these THREE values in a <script> block
   BEFORE loading this file:

       const TEAM_KEY               = 'boys-xc';   // matches team_tabs sheet
       const TEAM_FILES_FOLDER_ID   = '...';        // Drive folder id
       const TEAM_PHOTOS_FOLDER_ID  = '...';        // Drive folder id

   Everything else (spreadsheet id, Apps Script URL, all rendering logic)
   lives here so it only has to be written/fixed once.

   ── HOW TABS WORK ──
   team_tabs sheet:        team | order | name | type | active
     - "name" is both the button label AND the tab's key (slugified into
       its element id). No separate tab_key column.
     - "type" is one of the built-ins: photos | files | coaches | updates
       or, for anything else (including "custom" or blank), it's treated
       as a generic content tab whose body lives in team_custom_tabs.

   team_custom_tabs sheet: team | tab_name | order | title | body | date | active
     - "tab_name" must exactly match a tab's "name" in team_tabs.
     - A tab can have multiple rows (sections), rendered in "order".
     - "date" is optional; when present it's shown like on an update card.
     - type "updates" -> EVERY row renders inside an .update-item box.
     - type "custom"  -> the FIRST row renders as a plain intro (h2 + body),
                          every row AFTER that renders inside .update-item.
   ========================================================================== */

// ── GLOBAL CMS CONFIG (same across every team page) ─────────────────────────
const CMS_SPREADSHEET_ID = '1HiXgfyNGJQGdjiMWETThhsuBEpz_rwgr3bZxjLtLDlg';
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzUyTldRpyDB5Iiw8h20glKK7zY1pEt-53X6YMcw4JMR0Kki-5dZFiXU7agk5FzHoJK/exec';

// ── SHEETS HELPER ────────────────────────────────────────────────────────────
/**
 * Fetches rows from a publicly published Google Spreadsheet tab.
 * Uses Google's free gviz/tq JSON endpoint — no Apps Script, no OAuth.
 *
 * REQUIREMENT: The spreadsheet must be published to the web, and the
 * specific sheet tab must be included in that publish scope.
 *   File → Share → Publish to web → select the sheet (or "Entire Document") → Publish
 *
 * Returns an array of plain objects keyed by the header row,
 * filtered to active !== FALSE, sorted ascending by the order column.
 */
async function fetchSheetRows(spreadsheetId, sheetName) {
    const url =
        'https://docs.google.com/spreadsheets/d/' +
        spreadsheetId +
        '/gviz/tq?tqx=out:json&sheet=' +
        encodeURIComponent(sheetName) +
        '&range=A2:Z';

    const res = await fetch(url);
    const text = await res.text();

    const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*?)\);?\s*$/);
    if (!match) throw new Error('Unexpected Sheets response format for sheet: ' + sheetName);

    const json = JSON.parse(match[1]);

    // If the sheet tab isn't published (or the name doesn't match exactly),
    // Google returns a JSON payload with no "table" key instead of an HTTP
    // error — without this check that looks identical to "no content".
    if (!json.table) {
        console.error('CMS fetch for sheet "' + sheetName + '" returned no table data. ' +
            'Check that this tab is included in File → Share → Publish to web ' +
            '(or that "Entire Document" is selected), and that the tab name matches exactly.',
            json);
        throw new Error('Sheet "' + sheetName + '" not found or not published.');
    }

    const table = json.table;
    if (!table.rows || table.rows.length === 0) return [];

    const headers = table.cols.map(function (col) {
        return (col.label || '').trim().toLowerCase().replace(/\s+/g, '_');
    });

    return table.rows
        .map(function (row) {
            var obj = {};
            headers.forEach(function (h, i) {
                var cell = row.c ? row.c[i] : null;
                obj[h] = (cell && cell.v !== null && cell.v !== undefined)
                    ? cell.v.toString().trim()
                    : '';
            });
            return obj;
        })
        .filter(function (row) {
            var a = (row['active'] || '').toUpperCase();
            return a !== 'FALSE' && a !== '0' && a !== 'NO';
        })
        .sort(function (a, b) {
            return (parseInt(a['order'], 10) || 0) - (parseInt(b['order'], 10) || 0);
        });
}

// ── ESCAPE / CONTENT HELPERS ─────────────────────────────────────────────────
function escapeHtml(str) {
    return (str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

const IMAGE_BASE = '../';
function resolveImageUrl(path) {
    if (!path || !path.trim()) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    return IMAGE_BASE + path.replace(/^\//, '');
}

// If the sheet cell has no HTML tags in it, treat it as plain text and wrap
// it in a <p> (escaping it first). If it already contains tags, trust it as
// HTML, same convention used everywhere else in this CMS.
function ensureHtml(content) {
    if (!content || !content.trim()) return '';
    const hasTags = /<[a-z][\s\S]*>/i.test(content);
    return hasTags ? content : '<p>' + escapeHtml(content) + '</p>';
}

// Turns a tab's display name into a safe, unique-per-team element id.
// "Home" -> "home", "7 Tips!" -> "7-tips"
function slugifyTabName(name) {
    return (name || '').trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'tab';
}

// ── UPDATE BANNER ────────────────────────────────────────────────────────────
async function loadUpdateBanner() {
    const banner = document.getElementById('update-banner');
    const content = document.getElementById('update-banner-text');
    if (!banner || !content) return;

    try {
        const rows = await fetchSheetRows(CMS_SPREADSHEET_ID, 'update_banner');
        const row = rows.find(function (r) {
            return (r.page || '').trim().toLowerCase() === TEAM_KEY;
        });

        if (!row || !row.body || !row.body.trim()) return; // nothing active for this page

        content.innerHTML = row.body; // body allows HTML, same convention as other sheets

        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                banner.classList.add('active');
            });
        });
    } catch (err) {
        console.error('Failed to load update banner:', err);
    }
}

// ── COACHES (built-in tab type) ──────────────────────────────────────────────
function buildCoachCard(coach) {
    const card = document.createElement('div');
    card.className = 'coach-card';

    const imageWrap = document.createElement('div');
    imageWrap.className = 'coach-image';

    const imageUrl = resolveImageUrl(coach.image_url || '');
    if (imageUrl) {
        const img = document.createElement('img');
        img.alt = coach.name;
        img.loading = 'lazy';
        img.onerror = function () {
            img.remove();
            const ph = document.createElement('div');
            ph.className = 'coach-image-placeholder';
            ph.textContent = '👤';
            imageWrap.appendChild(ph);
        };
        img.src = imageUrl;
        imageWrap.appendChild(img);
    } else {
        const ph = document.createElement('div');
        ph.className = 'coach-image-placeholder';
        ph.textContent = '👤';
        imageWrap.appendChild(ph);
    }

    const name = document.createElement('div');
    name.className = 'coach-name';
    name.textContent = coach.name;

    const title = document.createElement('div');
    title.className = 'coach-title';
    title.textContent = coach.title;

    const emailBtn = document.createElement('a');
    emailBtn.className = 'email-button';
    emailBtn.textContent = 'Send Email';
    const email = (coach.email || '').trim();
    if (email) {
        emailBtn.href = 'mailto:' + email;
    } else {
        emailBtn.href = '#';
        emailBtn.classList.add('disabled');
    }

    card.appendChild(imageWrap);
    card.appendChild(name);
    card.appendChild(title);
    card.appendChild(emailBtn);

    return card;
}

async function loadCoaches() {
    const container = document.getElementById('coaches-container');
    if (!container) return;
    try {
        const rows = (await fetchSheetRows(CMS_SPREADSHEET_ID, 'coaches'))
            .filter(function (row) { return (row['team'] || '').trim() === TEAM_KEY; });

        if (!rows.length) {
            container.innerHTML = '<p style="color:var(--text-muted);">No coaches listed yet.</p>';
            return;
        }

        const grid = document.createElement('div');
        grid.className = 'coaches-grid';
        rows.forEach(function (coach) {
            grid.appendChild(buildCoachCard(coach));
        });

        container.innerHTML = '';
        container.appendChild(grid);
    } catch (err) {
        console.error('Failed to load coaches:', err);
        container.innerHTML = '<p style="color:#ff6b6b;">Unable to load coaches. Please try again later.</p>';
    }
}

// ── FILES (built-in tab type, via Apps Script) ───────────────────────────────
async function loadFiles() {
    const fileListContainer = document.getElementById('file-list');
    const loadingMessage = document.getElementById('loading-message');
    if (!fileListContainer || !loadingMessage) return;

    try {
        const response = await fetch(`${APPS_SCRIPT_URL}?action=files&folderId=${TEAM_FILES_FOLDER_ID}`);
        const data = await response.json();

        if (data.success && data.files) {
            loadingMessage.style.display = 'none';

            if (data.files.length === 0) {
                fileListContainer.innerHTML = '<p style="color: var(--text-muted);">No files available at this time.</p>';
                return;
            }

            fileListContainer.innerHTML = '';

            data.files.forEach(file => {
                const fileItem = document.createElement('div');
                fileItem.className = 'file-item';
                const fileSizeKB = (file.size / 1024).toFixed(2);
                const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
                const displaySize = file.size > 1024 * 1024 ? `${fileSizeMB} MB` : `${fileSizeKB} KB`;

                fileItem.innerHTML = `
                    <div class="file-info">
                        <div class="file-name">${file.name}</div>
                        <div class="file-description">${file.description} • ${displaySize}</div>
                    </div>

                    <div class="file-actions">
                        <button class="download-button" onclick="openFileViewer('${file.downloadUrl}', '${file.name.replace(/'/g, "\\'")}')">
                            <span class="icon icon-open"></span>
                            <button-text>Open</button-text>
                        </button>

                        <button class="download-button" onclick="window.open('${file.downloadUrl}', '_blank')">
                            <span class="icon icon-download"></span>
                            <button-text>Download</button-text>
                        </button>
                    </div>
                `;
                fileListContainer.appendChild(fileItem);
            });
        } else {
            loadingMessage.textContent = 'Error loading files. Please try again later.';
            loadingMessage.style.color = '#ff6b6b';
        }
    } catch (error) {
        console.error('Error fetching files:', error);
        loadingMessage.textContent = 'Unable to load files. Please check your connection.';
        loadingMessage.style.color = '#ff6b6b';
    }
}

function openFileViewer(downloadUrl, fileName) {
    const match = downloadUrl.match(/[?&]id=([^&]+)/);
    let viewUrl = downloadUrl;
    if (match) {
        viewUrl = `https://drive.google.com/file/d/${match[1]}/view`;
    }
    window.open(viewUrl, '_blank');
}

// ── PHOTOS (built-in tab type, via Apps Script) ──────────────────────────────
let currentAlbumId = null;
let currentPhotoIndex = 0;
let currentPhotosArray = [];
let imageCache = new Map();
let currentAlbumRequestId = 0;

function preloadImage(url, fallbackUrl) {
    if (imageCache.has(url)) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => { imageCache.set(url, img); resolve(); };
        img.onerror = () => {
            if (fallbackUrl && fallbackUrl !== url) {
                const fallbackImg = new Image();
                fallbackImg.onload = () => { imageCache.set(url, fallbackImg); resolve(); };
                fallbackImg.onerror = () => reject();
                fallbackImg.src = fallbackUrl;
            } else {
                reject();
            }
        };
        img.src = url;
    });
}

function preloadAdjacentImages(index) {
    if (index > 0) preloadImage(currentPhotosArray[index - 1].fullUrl);
    if (index < currentPhotosArray.length - 1) preloadImage(currentPhotosArray[index + 1].fullUrl);
}

function createAlbumItem(album) {
    const albumItem = document.createElement('div');
    albumItem.className = 'album-item';
    albumItem.onclick = () => openAlbum(album.id, album.name);

    const cover = document.createElement('div');
    cover.className = 'album-cover';

    if (album.coverPhotoUrl) {
        const img = document.createElement('img');
        img.src = album.coverPhotoUrl;
        img.alt = album.name;
        img.loading = 'lazy';
        img.decoding = 'async';
        cover.appendChild(img);
    } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'album-cover-placeholder';
        placeholder.textContent = '📷';
        cover.appendChild(placeholder);
    }

    const info = document.createElement('div');
    info.className = 'album-info';
    info.innerHTML = `<div class="album-name">${album.name}</div><div class="album-description">${album.description}</div>`;

    albumItem.appendChild(cover);
    albumItem.appendChild(info);
    return albumItem;
}

async function loadPhotoAlbums() {
    const albumsGrid = document.getElementById('albums-grid');
    const loadingMessage = document.getElementById('albums-loading-message');
    if (!albumsGrid || !loadingMessage) return;

    try {
        const response = await fetch(`${APPS_SCRIPT_URL}?action=photoAlbums&folderId=${TEAM_PHOTOS_FOLDER_ID}`);
        const data = await response.json();

        if (data.success && data.albums) {
            loadingMessage.style.display = 'none';

            if (data.albums.length === 0 && data.allPhotosCount === 0) {
                albumsGrid.innerHTML = '<p style="color: var(--text-muted);">No photo albums yet. Check back soon!</p>';
                return;
            }

            albumsGrid.innerHTML = '';

            if (data.allPhotosCount > 0) {
                albumsGrid.appendChild(createAlbumItem({
                    id: 'ALL_PHOTOS',
                    name: 'All Photos',
                    description: `${data.allPhotosCount} photos`,
                    photoCount: data.allPhotosCount,
                    coverPhotoUrl: data.allPhotosCover ? `https://drive.google.com/thumbnail?id=${data.allPhotosCover}&sz=w400` : null
                }));
            }

            data.albums.forEach(album => albumsGrid.appendChild(createAlbumItem(album)));
        } else {
            loadingMessage.textContent = 'Error loading albums. Please try again later.';
            loadingMessage.style.color = '#ff6b6b';
        }
    } catch (error) {
        console.error('Error fetching albums:', error);
        loadingMessage.textContent = 'Unable to load albums. Please check your connection.';
        loadingMessage.style.color = '#ff6b6b';
    }
}

async function openAlbum(albumId, albumName) {
    const requestId = ++currentAlbumRequestId;
    currentAlbumId = albumId;

    document.getElementById('albums-view').style.display = 'none';
    document.getElementById('album-photos-view').style.display = 'block';
    document.getElementById('album-title').textContent = albumName;

    const photoGrid = document.getElementById('photo-grid');
    const loadingMessage = document.getElementById('photos-loading-message');

    photoGrid.innerHTML = '';
    loadingMessage.style.display = 'block';
    loadingMessage.textContent = 'Loading photos...';
    loadingMessage.style.color = 'var(--text-muted)';

    let retries = 3;
    while (retries > 0) {
        if (requestId !== currentAlbumRequestId) return;
        try {
            const url = albumId === 'ALL_PHOTOS'
                ? `${APPS_SCRIPT_URL}?action=allPhotos&folderId=${TEAM_PHOTOS_FOLDER_ID}`
                : `${APPS_SCRIPT_URL}?action=albumPhotos&folderId=${albumId}`;

            const response = await fetch(url);
            if (requestId !== currentAlbumRequestId) return;
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const data = await response.json();
            if (requestId !== currentAlbumRequestId) return;

            if (data.success && data.photos) {
                loadingMessage.style.display = 'none';
                if (data.photos.length === 0) {
                    photoGrid.innerHTML = '<p>No photos in this album yet.</p>';
                    return;
                }

                currentPhotosArray = data.photos;
                data.photos.forEach((photo, index) => {
                    const photoItem = document.createElement('div');
                    photoItem.className = 'photo-item';
                    photoItem.onclick = () => openPhotoModal(index);

                    const img = document.createElement('img');
                    img.src = photo.thumbnailUrl;
                    img.alt = photo.name;
                    img.loading = 'lazy';
                    img.decoding = 'async';
                    img.onerror = function () {
                        this.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><text x="50%" y="50%" font-size="40" text-anchor="middle" dy=".3em">📷</text></svg>';
                    };
                    photoItem.appendChild(img);

                    if (photo.caption) {
                        const caption = document.createElement('div');
                        caption.className = 'photo-caption';
                        caption.textContent = photo.caption;
                        photoItem.appendChild(caption);
                    }
                    photoGrid.appendChild(photoItem);
                });

                for (let i = 0; i < Math.min(3, data.photos.length); i++) {
                    setTimeout(() => preloadImage(data.photos[i].fullUrl, data.photos[i].fallbackUrl), i * 500);
                }
                return;
            } else {
                throw new Error(data.error || 'Unknown error');
            }
        } catch (error) {
            if (requestId !== currentAlbumRequestId) return;
            retries--;
            if (retries > 0) {
                loadingMessage.textContent = `Loading photos... (retrying in 1 second)`;
                await new Promise(resolve => setTimeout(resolve, 1000));
            } else {
                loadingMessage.textContent = 'Unable to load photos. Please check your connection.';
                loadingMessage.style.color = '#ff6b6b';
            }
        }
    }
}

function backToAlbums() {
    document.getElementById('albums-view').style.display = 'block';
    document.getElementById('album-photos-view').style.display = 'none';
    currentAlbumId = null;
    currentPhotosArray = [];
}

async function openPhotoModal(index) {
    currentPhotoIndex = index;
    const photo = currentPhotosArray[index];

    const modal = document.getElementById('photo-modal');
    const modalImg = document.getElementById('modal-image');
    const modalCaption = document.getElementById('modal-caption');
    const loading = document.getElementById('photo-loading');
    const downloadBtn = document.getElementById('download-btn');
    const shareBtn = document.getElementById('share-btn');

    document.querySelector('.nav-bar').style.display = 'none';
    document.body.classList.add('modal-open');

    modal.classList.add('active');
    modalImg.style.display = 'none';
    loading.style.display = 'block';
    loading.textContent = 'Loading high-resolution image...';

    document.getElementById('prev-photo').style.display = index > 0 ? 'flex' : 'none';
    document.getElementById('next-photo').style.display = index < currentPhotosArray.length - 1 ? 'flex' : 'none';

    downloadBtn.onclick = () => downloadPhoto(photo.downloadUrl, photo.name);
    shareBtn.onclick = () => sharePhoto(photo);

    const urlsToTry = [
        { url: photo.fullUrl, timeout: 60000, label: 'high-resolution image' },
        { url: photo.fallbackUrl, timeout: 30000, label: 'alternate source' },
        { url: photo.downloadUrl, timeout: 30000, label: 'download source' },
        { url: photo.thumbnailUrl, timeout: 15000, label: 'preview image' }
    ].filter(item => item.url);

    let imageLoaded = false;
    let currentUrlIndex = 0;
    let progressInterval;
    let secondsElapsed = 0;

    while (currentUrlIndex < urlsToTry.length && !imageLoaded) {
        const currentItem = urlsToTry[currentUrlIndex];
        const currentUrl = currentItem.url;

        try {
            if (imageCache.has(currentUrl)) {
                modalImg.src = currentUrl;
                modalImg.style.display = 'block';
                loading.style.display = 'none';
                imageLoaded = true;
                break;
            }

            if (currentUrlIndex === 0) {
                loading.textContent = 'Loading high-resolution image...';
                loading.style.color = 'var(--white)';
                secondsElapsed = 0;
                progressInterval = setInterval(() => {
                    secondsElapsed++;
                    loading.textContent = `Loading high-resolution image... (${secondsElapsed}s)`;
                }, 1000);
            } else {
                loading.textContent = `Trying ${currentItem.label}... (${currentUrlIndex + 1}/${urlsToTry.length})`;
                loading.style.color = 'var(--white)';
            }

            await new Promise((resolve, reject) => {
                const img = new Image();
                const timeout = setTimeout(() => reject(new Error('Image load timeout')), currentItem.timeout);
                img.onload = () => {
                    clearTimeout(timeout);
                    if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
                    imageCache.set(currentUrl, img);
                    resolve();
                };
                img.onerror = () => {
                    clearTimeout(timeout);
                    if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
                    reject(new Error('Image load failed'));
                };
                img.src = currentUrl;
            });

            if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }

            modalImg.src = currentUrl;
            modalImg.onload = function () {
                const availableHeight = window.innerHeight - 180;
                const availableWidth = window.innerWidth - 40;
                const imgRatio = this.naturalWidth / this.naturalHeight;
                const viewportRatio = availableWidth / availableHeight;
                if (imgRatio > viewportRatio) {
                    this.style.width = availableWidth + 'px';
                    this.style.height = 'auto';
                } else {
                    this.style.height = availableHeight + 'px';
                    this.style.width = 'auto';
                }
            };
            modalImg.style.display = 'block';
            loading.style.display = 'none';
            imageLoaded = true;
            setTimeout(() => preloadAdjacentImages(index), 500);

        } catch (error) {
            if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
            currentUrlIndex++;
            if (currentUrlIndex >= urlsToTry.length) {
                loading.textContent = 'Unable to load image. Please try again later.';
                loading.style.color = '#ff6b6b';
                setTimeout(() => { loading.style.display = 'none'; }, 3000);
            }
        }
    }

    if (photo.caption) {
        modalCaption.textContent = photo.caption;
        modalCaption.style.display = 'block';
    } else {
        modalCaption.style.display = 'none';
    }
}

function navigatePhoto(direction) {
    const newIndex = currentPhotoIndex + direction;
    if (newIndex >= 0 && newIndex < currentPhotosArray.length) {
        openPhotoModal(newIndex);
    }
}

function closePhotoModal() {
    document.getElementById('photo-modal').classList.remove('active');
    document.querySelector('.nav-bar').style.display = 'block';
    document.body.classList.remove('modal-open');
}

function downloadPhoto(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

async function sharePhoto(photo) {
    const shareData = {
        title: photo.name,
        text: photo.caption || 'Check out this photo from Tonka Track!',
        url: photo.fullUrl
    };
    try {
        if (navigator.share) {
            await navigator.share(shareData);
        } else {
            await navigator.clipboard.writeText(photo.fullUrl);
            alert('Link copied to clipboard!');
        }
    } catch (error) {
        prompt('Copy this link to share:', photo.fullUrl);
    }
}

document.addEventListener('keydown', (e) => {
    const modal = document.getElementById('photo-modal');
    if (modal && modal.classList.contains('active')) {
        if (e.key === 'Escape') closePhotoModal();
        else if (e.key === 'ArrowLeft') navigatePhoto(-1);
        else if (e.key === 'ArrowRight') navigatePhoto(1);
    }
});

// ── CUSTOM / UPDATE CONTENT (team_custom_tabs sheet) ─────────────────────────
// Renders one row as a plain intro block (no wrapper) — used for the first
// row of a "custom" type tab only.
function renderIntroBlock(row) {
    const frag = document.createDocumentFragment();
    const h2 = document.createElement('h2');
    h2.textContent = row.title;
    frag.appendChild(h2);

    const body = document.createElement('div');
    body.innerHTML = ensureHtml(row.body);
    frag.appendChild(body);

    return frag;
}

// Renders one row wrapped in an .update-item box (title, optional date, body).
function renderUpdateItem(row) {
    const item = document.createElement('div');
    item.className = 'update-item';

    const h3 = document.createElement('h3');
    h3.textContent = row.title;
    item.appendChild(h3);

    if (row.date && row.date.trim()) {
        const date = document.createElement('div');
        date.className = 'update-date';
        date.textContent = row.date;
        item.appendChild(date);
    }

    const body = document.createElement('div');
    body.innerHTML = ensureHtml(row.body);
    item.appendChild(body);

    return item;
}

// Loads all team_custom_tabs rows for this team + tab name into `container`.
// wrapAll=true  -> every row (including the first) is an .update-item — used
//                  by the built-in "updates" type.
// wrapAll=false -> the first row renders plain, every row after that is
//                  wrapped — used by the generic "custom" type.
async function loadCustomTabContent(container, tabName, wrapAll) {
    try {
        const rows = (await fetchSheetRows(CMS_SPREADSHEET_ID, 'team_custom_tabs'))
            .filter(function (row) {
                return (row['team'] || '').trim() === TEAM_KEY &&
                    (row['tab_name'] || '').trim() === tabName;
            });

        if (!rows.length) {
            container.innerHTML = '<p style="color:var(--text-muted);">No content yet. Check back soon!</p>';
            return;
        }

        container.innerHTML = '';

        rows.forEach(function (row, index) {
            if (!wrapAll && index === 0) {
                container.appendChild(renderIntroBlock(row));
            } else {
                container.appendChild(renderUpdateItem(row));
            }
        });
    } catch (err) {
        console.error('Failed to load content for tab "' + tabName + '":', err);
        container.innerHTML = '<p style="color:#ff6b6b;">Unable to load content. Please try again later.</p>';
    }
}

// ── PANEL BUILDERS — one per tab "type" ──────────────────────────────────────
// Each builder returns { el, onShow, loadOnBuild }:
//   el          - the DOM node to drop into the tab panel
//   onShow      - function to call every time this tab is clicked (or null)
//   loadOnBuild - function to call once, immediately after the panel is built (or null)

function buildCustomPanel(tab) {
    const wrap = document.createElement('div');
    const container = document.createElement('div');
    wrap.appendChild(container);

    return {
        el: wrap,
        onShow: null,
        loadOnBuild: function () { loadCustomTabContent(container, tab.name, false); }
    };
}

function buildUpdatePanel(tab) {
    const wrap = document.createElement('div');
    const h2 = document.createElement('h2');
    h2.textContent = tab.name;
    wrap.appendChild(h2);

    const container = document.createElement('div');
    wrap.appendChild(container);

    return {
        el: wrap,
        onShow: null,
        loadOnBuild: function () { loadCustomTabContent(container, tab.name, true); }
    };
}

function buildPhotosPanel(tab) {
    const wrap = document.createElement('div');
    wrap.innerHTML =
        '<div id="albums-view">' +
        '  <div class="flex-space-between"><h2 class="h2-flush">' + escapeHtml(tab.name) + '</h2></div>' +
        '  <p id="albums-loading-message" class="loading-message">Loading albums...</p>' +
        '  <div class="albums-grid" id="albums-grid"></div>' +
        '</div>' +
        '<div id="album-photos-view" style="display:none;">' +
        '  <div class="flex-align-center">' +
        '    <button class="back-button" onclick="backToAlbums()">← Back to Albums</button>' +
        '    <h2 id="album-title" class="h2-flush"></h2>' +
        '  </div>' +
        '  <p id="photos-loading-message" class="loading-message">Loading photos...</p>' +
        '  <div class="photo-grid" id="photo-grid"></div>' +
        '</div>';
    return { el: wrap, onShow: loadPhotoAlbums, loadOnBuild: null };
}

function buildFilesPanel(tab) {
    const wrap = document.createElement('div');
    const h2 = document.createElement('h2');
    h2.textContent = tab.name;
    wrap.appendChild(h2);

    const loading = document.createElement('p');
    loading.id = 'loading-message';
    loading.className = 'loading-message';
    loading.textContent = 'Loading files...';
    wrap.appendChild(loading);

    const list = document.createElement('div');
    list.className = 'file-list';
    list.id = 'file-list';
    wrap.appendChild(list);

    return { el: wrap, onShow: loadFiles, loadOnBuild: null };
}

function buildCoachesPanel(tab) {
    const wrap = document.createElement('div');
    const h2 = document.createElement('h2');
    h2.textContent = tab.name;
    wrap.appendChild(h2);

    const container = document.createElement('div');
    container.id = 'coaches-container';
    container.innerHTML = '<p class="loading-message">Loading coaches…</p>';
    wrap.appendChild(container);

    return { el: wrap, onShow: null, loadOnBuild: loadCoaches };
}

const PANEL_BUILDERS = {
    photos: buildPhotosPanel,
    files: buildFilesPanel,
    coaches: buildCoachesPanel,
    updates: buildUpdatePanel,
    custom: buildCustomPanel
};

// ── DYNAMIC TABS (reads the team_tabs sheet) ─────────────────────────────────
const tabRegistry = {};

function showTab(key) {
    Object.keys(tabRegistry).forEach(function (k) {
        tabRegistry[k].panel.classList.toggle('active', k === key);
        tabRegistry[k].button.classList.toggle('active', k === key);
    });

    if (key === 'photos') {
        const albumsView = document.getElementById('albums-view');
        const albumPhotosView = document.getElementById('album-photos-view');
        if (albumsView) albumsView.style.display = 'block';
        if (albumPhotosView) albumPhotosView.style.display = 'none';
    }

    const built = tabRegistry[key];
    if (built && built.onShow) built.onShow();
}

async function buildTabs() {
    const tabButtonsEl = document.getElementById('tab-buttons');
    const tabPanelsEl = document.getElementById('tab-panels');
    if (!tabButtonsEl || !tabPanelsEl) return;

    let tabs = [];
    try {
        tabs = (await fetchSheetRows(CMS_SPREADSHEET_ID, 'team_tabs'))
            .filter(function (row) { return (row.team || '').trim() === TEAM_KEY; });
    } catch (err) {
        console.error('Failed to load team_tabs:', err);
    }

    if (!tabs.length) {
        tabPanelsEl.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:3rem 0;">No content configured for this team yet.</p>';
        return;
    }

    tabButtonsEl.innerHTML = '';
    tabPanelsEl.innerHTML = '';

    tabs.forEach(function (tab, index) {
        const type = (tab.type || 'custom').trim().toLowerCase();
        const builder = PANEL_BUILDERS[type] || PANEL_BUILDERS.custom;
        const key = slugifyTabName(tab.name);
        const built = builder(tab);

        const btn = document.createElement('button');
        btn.className = 'tab-button' + (index === 0 ? ' active' : '');
        btn.textContent = tab.name;
        btn.addEventListener('click', function () { showTab(key); });
        tabButtonsEl.appendChild(btn);

        const panel = document.createElement('div');
        panel.id = key + '-tab';
        panel.className = 'tab-content' + (index === 0 ? ' active' : '');
        panel.appendChild(built.el);
        tabPanelsEl.appendChild(panel);

        tabRegistry[key] = { panel: panel, button: btn, onShow: built.onShow };

        if (built.loadOnBuild) built.loadOnBuild();
        if (index === 0 && built.onShow) built.onShow();
    });
}

// ── NAV ──────────────────────────────────────────────────────────────────────
function toggleMenu() {
    const menu = document.getElementById('navMenu');
    const hamburger = document.querySelector('.hamburger');
    const backdrop = document.getElementById('menuBackdrop');
    menu.classList.toggle('active');
    hamburger.classList.toggle('active');
    backdrop.classList.toggle('active');
}

function closeMenu() {
    const menu = document.getElementById('navMenu');
    const hamburger = document.querySelector('.hamburger');
    const backdrop = document.getElementById('menuBackdrop');
    menu.classList.remove('active');
    hamburger.classList.remove('active');
    backdrop.classList.remove('active');
}

document.addEventListener('click', function (event) {
    const menu = document.getElementById('navMenu');
    const hamburger = document.querySelector('.hamburger');
    const backdrop = document.getElementById('menuBackdrop');
    if (menu && menu.classList.contains('active') && !event.target.closest('.nav-content')) {
        menu.classList.remove('active');
        hamburger.classList.remove('active');
        backdrop.classList.remove('active');
    }
});

// ── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
    buildTabs();
    loadUpdateBanner();

    const bannerCloseBtn = document.getElementById('update-banner-close');
    if (bannerCloseBtn) {
        bannerCloseBtn.addEventListener('click', function () {
            document.getElementById('update-banner').classList.remove('active');
        });
    }
});