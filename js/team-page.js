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
   team_tabs sheet:        team | order | name | type | link | active
     - "name" is both the button label AND the tab's key (slugified into
       its element id). No separate tab_key column.
     - "link" is optional. For a "files" tab it is the Google Drive folder
       (link or folder id) to list, so one team can have several files tabs.
       Blank = use TEAM_FILES_FOLDER_ID from the page. Subfolders show up as
       collapsible folders, nested to any depth.
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

// ── PLAIN-TEXT CONTENT FORMATTER ─────────────────────────────────────────────
// Lets coaches type plain text in a sheet cell instead of writing HTML.
// One item per line:
//   Name | https://link          -> Google Drive link = file card (Open + Download)
//                                   any other link   = styled link labeled "Name"
//   Name | https://link | note   -> optional 3rd part = description on file cards
//   https://link                 -> bare link (Drive links become a card named "File")
//   anything else                -> paragraph text (bare URLs inside become links)
//   blank line                   -> starts a new paragraph / group
// If the cell already contains HTML tags it is used as-is (see ensureHtml).
const CMS_LINK_STYLE = 'color: var(--text-secondary); text-decoration: underline;';
const CMS_DRIVE_ID = /drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#\s]*&)?id=)([\w-]+)/i;
const CMS_NAMED_LINE = /^(.+?)\s*\|\s*(https?:\/\/[^\s|]+)\s*(?:\|\s*(.*))?$/i;
const CMS_BARE_URL = /^(https?:\/\/\S+)$/i;

function cmsLinkHtml(name, url) {
    return '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" style="' +
        CMS_LINK_STYLE + '">' + escapeHtml(name) + '</a>';
}

function cmsFileCardHtml(name, driveId, desc) {
    const viewUrl = 'https://drive.google.com/file/d/' + driveId + '/view';
    const downloadUrl = 'https://drive.google.com/uc?id=' + driveId + '&export=download';
    return '<div class="file-item">' +
        '<div class="file-info">' +
        '<div class="file-name">' + escapeHtml(name) + '</div>' +
        (desc ? '<div class="file-description">' + escapeHtml(desc) + '</div>' : '') +
        '</div>' +
        '<div class="file-actions">' +
        '<button class="download-button" onclick="window.open(\'' + viewUrl + '\', \'_blank\')">' +
        '<span class="icon icon-open"></span><button-text>Open</button-text></button>' +
        '<button class="download-button" onclick="window.open(\'' + downloadUrl + '\', \'_blank\')">' +
        '<span class="icon icon-download"></span><button-text>Download</button-text></button>' +
        '</div></div>';
}

// Escapes a text line, then turns any bare URLs inside it into links.
function cmsLinkifyText(line) {
    return escapeHtml(line).replace(/https?:\/\/[^\s<]+/gi, function (match) {
        let trail = '';
        let m;
        while ((m = match.match(/[.,;:!?)]+$/))) {
            trail = m[0] + trail;
            match = match.slice(0, -m[0].length);
        }
        // already escaped above, so don't escape again
        return '<a href="' + match + '" target="_blank" rel="noopener noreferrer" style="' +
            CMS_LINK_STYLE + '">' + match + '</a>' + trail;
    });
}

function formatPlainTextContent(text) {
    const out = [];
    let links = [];   // consecutive plain links, grouped into one <p>
    let texts = [];   // consecutive text lines, grouped into one <p>

    function flush() {
        if (links.length) { out.push('<p class="cms-links">' + links.join('\n') + '</p>'); links = []; }
        if (texts.length) { out.push('<p>' + texts.join('<br>\n') + '</p>'); texts = []; }
    }

    text.replace(/\r\n?/g, '\n').split('\n').forEach(function (raw) {
        const line = raw.trim();
        if (!line) { flush(); return; }

        let name, url, desc, m;
        if ((m = line.match(CMS_NAMED_LINE))) {
            name = m[1]; url = m[2]; desc = (m[3] || '').trim();
        } else if ((m = line.match(CMS_BARE_URL))) {
            url = m[1]; name = null; desc = '';
        } else {
            if (links.length) flush();
            texts.push(cmsLinkifyText(line));
            return;
        }

        const driveMatch = url.match(CMS_DRIVE_ID);
        if (driveMatch) {
            flush();
            out.push(cmsFileCardHtml(name || 'File', driveMatch[1], desc));
        } else {
            if (texts.length) flush();
            links.push(cmsLinkHtml(name || url, url));
        }
    });

    flush();
    return out.join('\n');
}

// If the sheet cell has no HTML tags in it, treat it as plain text and run it
// through the formatter above (escaped, with links / Drive file cards).
// If it already contains tags, trust it as HTML, same convention used
// everywhere else in this CMS — so existing HTML rows are unaffected.
function ensureHtml(content) {
    if (!content || !content.trim()) return '';
    const hasTags = /<[a-z][\s\S]*>/i.test(content);
    return hasTags ? content : formatPlainTextContent(content);
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
// Sheet columns: team | order | name | title | email | phone | bio | image_url | active
// phone and bio are optional. Format the phone column as Plain text. In bio,
// a blank line starts a new paragraph (plain text only, no HTML).
function phoneDigits(raw) {
    let d = (raw || '').replace(/\D/g, '');
    if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
    return d;
}

function formatPhone(raw) {
    const d = phoneDigits(raw);
    if (d.length === 10) return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
    return (raw || '').trim();
}

function buildCoachPlaceholder() {
    const ph = document.createElement('div');
    ph.className = 'coach-image-placeholder';
    ph.textContent = '👤';
    return ph;
}

// Fills `wrap` with the coach's photo, or a placeholder if missing / broken.
function fillCoachPhoto(wrap, coach) {
    wrap.textContent = '';
    const imageUrl = resolveImageUrl(coach.image_url || '');
    if (!imageUrl) {
        wrap.appendChild(buildCoachPlaceholder());
        return;
    }
    const img = document.createElement('img');
    img.alt = coach.name;
    img.loading = 'lazy';
    img.onerror = function () {
        img.remove();
        wrap.appendChild(buildCoachPlaceholder());
    };
    img.src = imageUrl;
    wrap.appendChild(img);
}

function buildCoachActionLink(className, label, href) {
    const a = document.createElement('a');
    a.className = 'coach-action ' + className;
    a.href = href;
    a.textContent = label;
    return a;
}

// Adds only the contact options this coach actually has. Returns true if any.
function appendCoachContactActions(container, coach) {
    const email = (coach.email || '').trim();
    const digits = phoneDigits(coach.phone);
    if (email) container.appendChild(buildCoachActionLink('email', 'Email', 'mailto:' + email));
    if (digits) {
        container.appendChild(buildCoachActionLink('call', 'Call', 'tel:+1' + digits));
        container.appendChild(buildCoachActionLink('text', 'Text', 'sms:+1' + digits));
    }
    return !!(email || digits);
}

function buildCoachCard(coach) {
    const card = document.createElement('div');
    card.className = 'coach-card';

    const imageWrap = document.createElement('div');
    imageWrap.className = 'coach-image';
    fillCoachPhoto(imageWrap, coach);

    const name = document.createElement('div');
    name.className = 'coach-name';
    name.textContent = coach.name;

    const title = document.createElement('div');
    title.className = 'coach-title';
    title.textContent = coach.title;

    card.appendChild(imageWrap);
    card.appendChild(name);
    card.appendChild(title);

    // Actions: always visible on touch devices, hover overlay on desktop
    const actions = document.createElement('div');
    actions.className = 'coach-actions';

    const overlayName = document.createElement('div');
    overlayName.className = 'coach-actions-name';
    overlayName.textContent = coach.name;
    actions.appendChild(overlayName);

    const hasContact = appendCoachContactActions(actions, coach);

    const hasBio = !!(coach.bio && coach.bio.trim());
    if (hasBio) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'coach-action more';
        more.textContent = 'Learn More';
        more.addEventListener('click', function () {
            openCoachModal(coach, more);
        });
        actions.appendChild(more);
    }

    if (hasContact || hasBio) {
        card.classList.add('has-actions');
        card.appendChild(actions);
    }

    return card;
}

// ── COACH PROFILE WINDOW ─────────────────────────────────────────────────────
// Built once on first use, so the team page HTML files need no changes.
let coachModalReturnFocus = null;

function ensureCoachModal() {
    let modal = document.getElementById('coach-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.className = 'coach-modal';
    modal.id = 'coach-modal';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML =
        '<div class="coach-modal-panel" role="dialog" aria-modal="true" aria-labelledby="coach-modal-name">' +
        '<button class="coach-modal-close" id="coach-modal-close" type="button" aria-label="Close">' +
        '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M15 5L5 15M5 5L15 15" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" /></svg>' +
        '</button>' +
        '<div class="coach-modal-header">' +
        '<div class="coach-modal-photo" id="coach-modal-photo"></div>' +
        '<div class="coach-modal-info">' +
        '<div class="coach-modal-name" id="coach-modal-name"></div>' +
        '<div class="coach-modal-title" id="coach-modal-title"></div>' +
        '<div class="coach-actions" id="coach-modal-actions"></div>' +
        '</div></div>' +
        '<div class="coach-modal-body" id="coach-modal-body"></div>' +
        '</div>';
    document.body.appendChild(modal);

    document.getElementById('coach-modal-close').addEventListener('click', closeCoachModal);
    // Click on the dark backdrop (not the panel) closes the window
    modal.addEventListener('click', function (e) {
        if (e.target === modal) closeCoachModal();
    });
    return modal;
}

// ── COACH BIO RENDERING ──────────────────────────────────────────────────────
// Bios may contain a small set of HTML: bold, italic, underline, line breaks,
// links, bullet / numbered lists and paragraphs. Anything else is stripped
// (its text is kept), and scripts / iframes / styles are dropped entirely.
// The nodes are rebuilt with createElement, so attributes and event handlers
// from the sheet are never copied across. Plain-text bios still work: a blank
// line starts a new paragraph.
var BIO_ALLOWED = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, BR: 1, P: 1, UL: 1, OL: 1, LI: 1, A: 1 };
var BIO_DROP = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, TEMPLATE: 1, NOSCRIPT: 1, SVG: 1, MATH: 1, TEXTAREA: 1 };

function safeBioHref(href) {
    var h = (href || '').trim();
    return /^(https?:|mailto:|tel:)/i.test(h) ? h : '';
}

function appendSafeBio(srcNode, destParent) {
    Array.prototype.forEach.call(srcNode.childNodes, function (n) {
        if (n.nodeType === 3) {
            destParent.appendChild(document.createTextNode(n.nodeValue));
            return;
        }
        if (n.nodeType !== 1) return;
        var tag = n.nodeName.toUpperCase();
        if (BIO_DROP[tag]) return;
        if (!BIO_ALLOWED[tag]) { appendSafeBio(n, destParent); return; }
        var el = document.createElement(tag.toLowerCase());
        if (tag === 'A') {
            var href = safeBioHref(n.getAttribute('href'));
            if (!href) { appendSafeBio(n, destParent); return; }
            el.setAttribute('href', href);
            if (/^https?:/i.test(href)) {
                el.target = '_blank';
                el.rel = 'noopener noreferrer';
            }
        }
        appendSafeBio(n, el);
        destParent.appendChild(el);
    });
}

function renderCoachBio(body, bio) {
    bio = bio || '';
    if (/<\s*(p|ul|ol|li)\b/i.test(bio)) {
        // Author wrote their own block structure — keep it
        appendSafeBio(new DOMParser().parseFromString(bio, 'text/html').body, body);
        return;
    }
    bio.split(/\n\s*\n/).forEach(function (chunk) {
        var text = chunk.trim();
        if (!text) return;
        var p = document.createElement('p');
        appendSafeBio(new DOMParser().parseFromString(text, 'text/html').body, p);
        body.appendChild(p);
    });
}

function openCoachModal(coach, triggerEl) {
    const modal = ensureCoachModal();
    coachModalReturnFocus = triggerEl || null;

    fillCoachPhoto(document.getElementById('coach-modal-photo'), coach);
    document.getElementById('coach-modal-name').textContent = coach.name;
    document.getElementById('coach-modal-title').textContent = coach.title;

    const actions = document.getElementById('coach-modal-actions');
    actions.textContent = '';
    appendCoachContactActions(actions, coach);

    // Show the formatted number too, so it's readable on desktop
    const phone = formatPhone(coach.phone);
    const callBtn = actions.querySelector('.call');
    if (callBtn && phone) callBtn.textContent = 'Call ' + phone;

    const body = document.getElementById('coach-modal-body');
    body.textContent = '';
    body.scrollTop = 0;
    renderCoachBio(body, coach.bio);

    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    document.getElementById('coach-modal-close').focus();
}

function closeCoachModal() {
    const modal = document.getElementById('coach-modal');
    if (!modal || !modal.classList.contains('open')) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    if (coachModalReturnFocus) coachModalReturnFocus.focus();
}

document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeCoachModal();
});

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
// Every "files" tab is its own instance (see buildFilesPanel), so a team can
// have several of them, each pointed at a different Drive folder. A tab's
// folder comes from the "link" column of the team_tabs sheet (a Drive folder
// link or a bare folder id). If "link" is blank, the page's
// TEAM_FILES_FOLDER_ID is used instead.
//
// A folder is loaded as a tree: { id, name, files: [...], folders: [tree...] }
// Folders can nest as deep as they are nested in Drive. "files" holds both real
// files and website links (items with kind: 'link'); links only get an Open button.

// Sort buttons use Font Awesome icons. The team pages don't load it by
// default, so add it once (same version/CDN as index.html and sports.html).
if (!document.querySelector('link[href*="font-awesome"]')) {
    const fa = document.createElement('link');
    fa.rel = 'stylesheet';
    fa.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css';
    document.head.appendChild(fa);
}

const FILE_SORT_OPTIONS = [
    { value: 'name-asc', icon: 'fa-arrow-down-a-z', tip: 'Sort A to Z' },
    { value: 'name-desc', icon: 'fa-arrow-down-z-a', tip: 'Sort Z to A' },
    { value: 'date-desc', icon: 'fa-arrow-down-wide-short', tip: 'Most recently updated first' },
    { value: 'date-asc', icon: 'fa-arrow-down-short-wide', tip: 'Least recently updated first' }
];

function formatFileDate(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Accepts a Drive folder link (…/folders/ID, …?id=ID) or a bare folder id.
// Returns '' if nothing usable was found.
function extractDriveFolderId(value) {
    const v = (value || '').trim();
    if (!v) return '';
    const m = v.match(/\/folders\/([\w-]+)/) || v.match(/[?&]id=([\w-]+)/);
    if (m) return m[1];
    return /^[\w-]{10,}$/.test(v) ? v : '';
}

// Fetches a folder as a tree. Falls back to the old flat "files" action if the
// Apps Script hasn't been redeployed with "filesTree" yet (no subfolders then).
async function fetchFileTree(folderId) {
    const base = APPS_SCRIPT_URL + '?folderId=' + encodeURIComponent(folderId) + '&action=';

    const res = await fetch(base + 'filesTree');
    const data = await res.json();
    if (data.success && data.tree) return data.tree;

    if (!data.success && /invalid action/i.test(data.error || '')) {
        const flatRes = await fetch(base + 'files');
        const flat = await flatRes.json();
        if (flat.success && flat.files) {
            return { id: folderId, name: '', files: flat.files, folders: [] };
        }
    }
    throw new Error(data.error || 'Unexpected response loading files');
}

function countTreeFiles(node) {
    return node.files.length + node.folders.reduce(function (n, f) { return n + countTreeFiles(f); }, 0);
}

// Returns a copy of the tree containing only what matches the query, or null
// if nothing matches. A folder whose own name matches keeps all its contents.
function filterFileTree(node, query, isRoot) {
    const nameHit = !isRoot && (node.name || '').toLowerCase().includes(query);
    if (nameHit) return node;

    const files = node.files.filter(function (file) {
        return ((file.name || '') + ' ' + (file.description || '')).toLowerCase().includes(query);
    });
    const folders = node.folders
        .map(function (f) { return filterFileTree(f, query, false); })
        .filter(Boolean);

    if (!isRoot && !files.length && !folders.length) return null;
    return { id: node.id, name: node.name, files: files, folders: folders };
}

// Website links stored in Drive (see getFilesTree in Code.gs) arrive as
// { kind: 'link', name, url, description, lastModified } and get an Open-only card.
function buildLinkItem(file) {
    const item = document.createElement('div');
    item.className = 'file-item file-item-link';

    const url = /^https?:\/\//i.test(file.url || '') ? file.url : '';
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { /* no host to show */ }
    const updated = formatFileDate(file.lastModified);
    const details = [file.description || 'Link', host, updated ? 'Updated ' + updated : '']
        .filter(Boolean).join(' • ');

    item.innerHTML =
        '<div class="file-info">' +
        '<div class="file-name"><i class="fa-solid fa-link file-link-icon" aria-hidden="true"></i>' +
        escapeHtml(file.name) + '</div>' +
        '<div class="file-description">' + escapeHtml(details) + '</div>' +
        '</div>' +
        '<div class="file-actions">' +
        '<button type="button" class="download-button" data-act="open">' +
        '<span class="icon icon-open"></span><button-text>Open</button-text></button>' +
        '</div>';

    const btn = item.querySelector('[data-act="open"]');
    if (url) {
        btn.addEventListener('click', function () { window.open(url, '_blank', 'noopener'); });
    } else {
        btn.disabled = true;
    }
    return item;
}

function buildFileItem(file) {
    if (file.kind === 'link') return buildLinkItem(file);

    const fileItem = document.createElement('div');
    fileItem.className = 'file-item';

    const size = Number(file.size) || 0;
    const displaySize = size > 1024 * 1024
        ? (size / (1024 * 1024)).toFixed(2) + ' MB'
        : (size / 1024).toFixed(2) + ' KB';
    const updated = formatFileDate(file.lastModified);

    fileItem.innerHTML =
        '<div class="file-info">' +
        '<div class="file-name">' + escapeHtml(file.name) + '</div>' +
        '<div class="file-description">' + escapeHtml(file.description) + ' • ' + displaySize +
        (updated ? ' • Updated ' + updated : '') + '</div>' +
        '</div>' +
        '<div class="file-actions">' +
        '<button type="button" class="download-button" data-act="open">' +
        '<span class="icon icon-open"></span><button-text>Open</button-text></button>' +
        '<button type="button" class="download-button" data-act="download">' +
        '<span class="icon icon-download"></span><button-text>Download</button-text></button>' +
        '</div>';

    fileItem.querySelector('[data-act="open"]').addEventListener('click', function () {
        openFileViewer(file.downloadUrl, file.name);
    });
    fileItem.querySelector('[data-act="download"]').addEventListener('click', function () {
        window.open(file.downloadUrl, '_blank');
    });
    return fileItem;
}

// Draws one folder's contents (subfolders first, then files) into `container`.
// Subfolders are collapsible and recurse, so they can nest to any depth.
function renderFileTreeInto(container, node, ctx) {
    const byName = function (a, b) {
        return (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' });
    };
    const byDate = function (a, b) { return new Date(a.lastModified) - new Date(b.lastModified); };

    const folders = node.folders.slice().sort(ctx.sort === 'name-desc'
        ? function (a, b) { return byName(b, a); }
        : byName);

    const files = node.files.slice().sort(function (a, b) {
        switch (ctx.sort) {
            case 'name-desc': return byName(b, a);
            case 'date-desc': return byDate(b, a) || byName(a, b);
            case 'date-asc': return byDate(a, b) || byName(a, b);
            default: return byName(a, b);
        }
    });

    folders.forEach(function (folder) {
        const isOpen = ctx.searching || ctx.open.has(folder.id);

        const wrap = document.createElement('div');
        wrap.className = 'file-folder' + (isOpen ? ' open' : '');

        const header = document.createElement('button');
        header.type = 'button';
        header.className = 'file-folder-header';
        header.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        header.innerHTML =
            '<i class="fa-solid fa-folder file-folder-icon" aria-hidden="true"></i>' +
            '<span class="file-folder-name">' + escapeHtml(folder.name) + '</span>' +
            '<span class="file-folder-count">' + countTreeFiles(folder) + '</span>' +
            '<i class="fa-solid fa-chevron-down file-folder-chevron" aria-hidden="true"></i>';

        const body = document.createElement('div');
        body.className = 'file-folder-body';
        body.hidden = !isOpen;

        if (!folder.files.length && !folder.folders.length) {
            const empty = document.createElement('p');
            empty.className = 'file-folder-empty';
            empty.textContent = 'This folder is empty.';
            body.appendChild(empty);
        } else {
            renderFileTreeInto(body, folder, ctx);
        }

        header.addEventListener('click', function () {
            const nowOpen = !wrap.classList.contains('open');
            wrap.classList.toggle('open', nowOpen);
            header.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
            body.hidden = !nowOpen;
            if (nowOpen) ctx.open.add(folder.id); else ctx.open.delete(folder.id);
        });

        wrap.appendChild(header);
        wrap.appendChild(body);
        container.appendChild(wrap);
    });

    files.forEach(function (file) { container.appendChild(buildFileItem(file)); });
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
    // Per-tab state, so several files tabs on one page don't interfere.
    const linkText = (tab.link || '').trim();
    const folderId = linkText
        ? extractDriveFolderId(linkText)
        : (typeof TEAM_FILES_FOLDER_ID !== 'undefined' ? TEAM_FILES_FOLDER_ID : '');
    const state = { tree: null, sort: 'name-asc', open: new Set(), requestId: 0 };

    const wrap = document.createElement('div');
    const h2 = document.createElement('h2');
    h2.textContent = tab.name;
    wrap.appendChild(h2);

    const loading = document.createElement('p');
    loading.className = 'loading-message';
    loading.textContent = 'Loading files...';
    wrap.appendChild(loading);

    // Search + sort controls (hidden until files have loaded)
    const controls = document.createElement('div');
    controls.className = 'file-controls';
    controls.style.display = 'none';
    controls.innerHTML =
        '<input type="search" class="file-search" placeholder="Search files..." aria-label="Search files" autocomplete="off">' +
        '<div class="file-sort-group" role="group" aria-label="Sort files"></div>';

    const searchEl = controls.querySelector('.file-search');
    const sortGroup = controls.querySelector('.file-sort-group');

    const list = document.createElement('div');
    list.className = 'file-list';

    function render() {
        list.innerHTML = '';
        if (!state.tree) return;

        const query = searchEl.value.trim().toLowerCase();
        const tree = query ? filterFileTree(state.tree, query, true) : state.tree;

        if (!tree.files.length && !tree.folders.length) {
            list.innerHTML = '<p style="color: var(--text-muted);">' +
                (query ? 'No files match your search.' : 'No files available at this time.') + '</p>';
            return;
        }
        renderFileTreeInto(list, tree, { sort: state.sort, open: state.open, searching: !!query });
    }

    FILE_SORT_OPTIONS.forEach(function (opt) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'file-sort-btn' + (opt.value === state.sort ? ' active' : '');
        btn.setAttribute('data-tip', opt.tip);
        btn.setAttribute('aria-label', opt.tip);
        btn.setAttribute('aria-pressed', opt.value === state.sort ? 'true' : 'false');
        btn.innerHTML = '<i class="fa-solid ' + opt.icon + '" aria-hidden="true"></i>';
        btn.addEventListener('click', function () {
            state.sort = opt.value;
            sortGroup.querySelectorAll('.file-sort-btn').forEach(function (b) {
                const on = b === btn;
                b.classList.toggle('active', on);
                b.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
            render();
        });
        sortGroup.appendChild(btn);
    });

    searchEl.addEventListener('input', render);
    wrap.appendChild(controls);
    wrap.appendChild(list);

    function showError(message) {
        loading.style.display = '';
        loading.textContent = message;
        loading.style.color = '#ff6b6b';
    }

    // Runs every time the tab is shown. Open folders and the search text
    // survive the re-fetch.
    async function load() {
        if (!folderId) {
            showError(linkText
                ? 'The folder link for this tab isn\'t a valid Google Drive folder link.'
                : 'No folder has been set up for this tab yet.');
            return;
        }

        const myRequest = ++state.requestId;
        try {
            const tree = await fetchFileTree(folderId);
            if (myRequest !== state.requestId) return; // a newer load superseded this one

            loading.style.display = 'none';
            state.tree = tree;

            if (!tree.files.length && !tree.folders.length) {
                controls.style.display = 'none';
                list.innerHTML = '<p style="color: var(--text-muted);">No files available at this time.</p>';
                return;
            }
            controls.style.display = '';
            render();
        } catch (error) {
            if (myRequest !== state.requestId) return;
            console.error('Error fetching files:', error);
            showError('Unable to load files. Please check your connection and try again.');
        }
    }

    return { el: wrap, onShow: load, loadOnBuild: null };
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