// TonkaTrack — Universal Google Apps Script
// Handles: team files, photo albums, album photos, all photos, and CMS sheet data

function doGet(e) {
  const action     = e.parameter.action;
  const folderId   = e.parameter.folderId;

  // Actions that don't need a folderId
  const noFolderRequired = ['test', 'sheetData'];

  if (!folderId && !noFolderRequired.includes(action)) {
    return ContentService.createTextOutput(
      JSON.stringify({ success: false, error: 'Missing folderId parameter' })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  try {
    let result;

    switch (action) {

      case 'files':
        result = getTeamFiles(folderId);
        break;

      case 'photoAlbums':
        result = getPhotoAlbums(folderId);
        break;

      case 'albumPhotos':
        result = getAlbumPhotos(folderId);
        break;

      case 'allPhotos':
        result = getAllPhotos(folderId);
        break;

      case 'sheetData':
        result = getSheetData(e.parameter.spreadsheetId, e.parameter.sheetName);
        break;

      case 'test':
        result = { success: true, message: 'Script is working!' };
        break;

      default:
        result = {
          success: false,
          error: 'Invalid action. Use: files, photoAlbums, albumPhotos, allPhotos, sheetData, or test'
        };
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(
      JSON.stringify({ success: false, error: error.toString() })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// CMS — Google Sheets data reader
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads a named sheet from a Google Spreadsheet and returns its rows
 * as an array of objects keyed by the header row.
 *
 * Rows where the "active" column is FALSE / false / 0 / NO are excluded.
 * Rows are sorted ascending by the "order" column (numeric).
 * Results are cached for 5 minutes per sheet to keep things fast.
 *
 * Called via: ?action=sheetData&spreadsheetId=SHEET_ID&sheetName=SHEET_NAME
 */
function getSheetData(spreadsheetId, sheetName) {
 
  if (!spreadsheetId || !sheetName) {
    return { success: false, error: 'Missing spreadsheetId or sheetName parameter' };
  }
 
  // Check cache first
  const cache    = CacheService.getScriptCache();
  const cacheKey = 'cms_' + spreadsheetId + '_' + sheetName;
  const cached   = cache.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }
 
  try {
    const token = ScriptApp.getOAuthToken();
 
    // Encode the sheet name for the URL (handles spaces, ampersands, etc.)
    const encodedSheet = encodeURIComponent(sheetName);
 
    // Call the Sheets REST API to get all values in the sheet
    const response = UrlFetchApp.fetch(
      'https://sheets.googleapis.com/v4/spreadsheets/' +
        spreadsheetId +
        '/values/' +
        encodedSheet,
      {
        headers: { Authorization: 'Bearer ' + token },
        muteHttpExceptions: true
      }
    );
 
    if (response.getResponseCode() !== 200) {
      return {
        success: false,
        error: 'Sheets API error: HTTP ' + response.getResponseCode() +
               ' — ' + response.getContentText()
      };
    }
 
    const json   = JSON.parse(response.getContentText());
    const values = json.values;
 
    if (!values || values.length < 2) {
      return { success: true, rows: [] };
    }
 
    // Normalize headers: lowercase, trim, spaces → underscores
    const headers = values[0].map(function (h) {
      return h.toString().trim().toLowerCase().replace(/\s+/g, '_');
    });
 
    const rows = values.slice(1)
      // Convert each row array → object keyed by header
      .map(function (row) {
        var obj = {};
        headers.forEach(function (h, i) {
          obj[h] = (row[i] !== undefined && row[i] !== null) ? row[i].toString() : '';
        });
        return obj;
      })
      // Filter out inactive rows (active = FALSE / false / 0 / NO)
      .filter(function (row) {
        var active = (row['active'] || '').toString().trim().toUpperCase();
        return active !== 'FALSE' && active !== '0' && active !== 'NO';
      })
      // Sort ascending by order column
      .sort(function (a, b) {
        return (parseInt(a['order'], 10) || 0) - (parseInt(b['order'], 10) || 0);
      });
 
    var result = { success: true, rows: rows };
 
    // Cache for 5 minutes (300 seconds)
    try {
      cache.put(cacheKey, JSON.stringify(result), 300);
    } catch (cacheErr) {
      console.warn('Cache write failed:', cacheErr.toString());
    }
 
    return result;
 
  } catch (error) {
    return { success: false, error: error.toString() };
  }
}


/**
 * Cache-busting utility — run manually from the Apps Script editor
 * whenever you want edits to show up immediately (before the 5-min cache expires).
 * Steps: Editor → select clearCmsCache from the function dropdown → Run.
 */
function clearCmsCache() {
  const cache          = CacheService.getScriptCache();
  const spreadsheetId  = 'YOUR_SPREADSHEET_ID'; // ← replace with your sheet ID

  var sheetNames = [
    'homepage_cards',
    'coaches',
    'team_updates',
    'team_home_info',
    'news_articles',
    'mtfcca_leaders',
    'mtfcca_sections',
    'learn_more_faq'
  ];

  sheetNames.forEach(function (name) {
    cache.remove('cms_' + spreadsheetId + '_' + name);
  });

  console.log('CMS cache cleared for ' + sheetNames.length + ' sheets.');
}


// ─────────────────────────────────────────────────────────────────────────────
// Files
// ─────────────────────────────────────────────────────────────────────────────

function getTeamFiles(folderId) {
  try {
    const folder = DriveApp.getFolderById(folderId);
    const files  = folder.getFiles();
    const fileList = [];

    while (files.hasNext()) {
      const file     = files.next();
      const mimeType = file.getMimeType();

      if (
        mimeType === 'application/pdf' ||
        mimeType === 'application/vnd.google-apps.document' ||
        mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        mimeType === 'application/msword'
      ) {
        fileList.push({
          name:         file.getName(),
          description:  file.getDescription() || 'Team document',
          size:         file.getSize(),
          mimeType:     mimeType,
          downloadUrl:  file.getDownloadUrl(),
          lastModified: file.getLastUpdated().toISOString()
        });
      }
    }

    fileList.sort(function (a, b) {
      return new Date(b.lastModified) - new Date(a.lastModified);
    });

    return { success: true, files: fileList };

  } catch (error) {
    return { success: false, error: error.toString() };
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// Photo albums
// ─────────────────────────────────────────────────────────────────────────────

function getPhotoAlbums(photosFolderId) {
  const cache    = CacheService.getScriptCache();
  const cacheKey = 'albums_' + photosFolderId;
  const cached   = cache.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  try {
    const result = getPhotoAlbumsParallel(photosFolderId);

    if (!result.success) {
      console.warn('Parallel approach failed, falling back to DriveApp:', result.error);
      return getPhotoAlbumsFallback(photosFolderId);
    }

    try {
      cache.put(cacheKey, JSON.stringify(result), 600);
    } catch (cacheError) {
      console.warn('Cache write failed:', cacheError.toString());
    }

    return result;

  } catch (error) {
    console.warn('getPhotoAlbums threw, falling back:', error.toString());
    return getPhotoAlbumsFallback(photosFolderId);
  }
}


// Fast parallel approach using UrlFetchApp — no DriveApp calls
function getPhotoAlbumsParallel(photosFolderId) {
  try {
    const token = ScriptApp.getOAuthToken();
    if (!token) throw new Error('No OAuth token available');

    // Step 1: Get subfolders via Drive API
    const subfoldersResponse = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(
        "'" + photosFolderId + "' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"
      ) + '&fields=files(id,name)&pageSize=100',
      { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true }
    );

    if (subfoldersResponse.getResponseCode() !== 200) {
      throw new Error('Subfolder fetch failed: HTTP ' + subfoldersResponse.getResponseCode());
    }

    const subfoldersData = JSON.parse(subfoldersResponse.getContentText());
    if (subfoldersData.error) {
      throw new Error('Drive API error getting subfolders: ' + JSON.stringify(subfoldersData.error));
    }

    const folderList = [{ id: photosFolderId, name: '__MAIN__' }];
    (subfoldersData.files || []).forEach(function (f) {
      folderList.push({ id: f.id, name: f.name });
    });

    // Step 2: One request per folder — get IDs only
    const requests = folderList.map(function (folder) {
      return {
        url: 'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(
          "'" + folder.id + "' in parents and (mimeType='image/jpeg' or mimeType='image/png') and trashed=false"
        ) + '&fields=files(id)&pageSize=1000',
        headers: { Authorization: 'Bearer ' + token },
        muteHttpExceptions: true
      };
    });

    const responses = UrlFetchApp.fetchAll(requests);

    // Step 3: Process
    let allPhotosCount = 0;
    let allPhotosCover = null;
    const albums = [];

    folderList.forEach(function (folder, i) {
      const response = responses[i];

      if (response.getResponseCode() !== 200) {
        throw new Error('HTTP ' + response.getResponseCode() + ' for folder ' + folder.name);
      }

      const data    = JSON.parse(response.getContentText());
      if (data.error) {
        throw new Error('API error for folder ' + folder.name + ': ' + JSON.stringify(data.error));
      }

      const files   = data.files || [];
      const count   = files.length;
      const coverId = count > 0 ? files[0].id : null;

      allPhotosCount += count;
      if (!allPhotosCover && coverId) allPhotosCover = coverId;

      if (folder.name !== '__MAIN__' && count > 0) {
        albums.push({
          id:            folder.id,
          name:          folder.name,
          description:   count + ' photo' + (count !== 1 ? 's' : ''),
          photoCount:    count,
          coverPhotoUrl: 'https://drive.google.com/thumbnail?id=' + coverId + '&sz=w400'
        });
      }
    });

    albums.sort(function (a, b) { return a.name.localeCompare(b.name); });

    return {
      success:        true,
      albums:         albums,
      allPhotosCount: allPhotosCount,
      allPhotosCover: allPhotosCover
    };

  } catch (error) {
    return { success: false, error: error.toString() };
  }
}


// Reliable DriveApp fallback
function getPhotoAlbumsFallback(photosFolderId) {
  try {
    function getFolderPhotoInfo(folder) {
      let count   = 0;
      let coverId = null;

      const jpegFiles = folder.getFilesByType(MimeType.JPEG);
      if (jpegFiles.hasNext()) {
        coverId = jpegFiles.next().getId();
        count = 1;
        while (jpegFiles.hasNext()) { jpegFiles.next(); count++; }
      }

      const pngFiles = folder.getFilesByType(MimeType.PNG);
      if (!coverId && pngFiles.hasNext()) {
        coverId = pngFiles.next().getId();
        count++;
      }
      while (pngFiles.hasNext()) { pngFiles.next(); count++; }

      return { count, coverId };
    }

    const photosFolder = DriveApp.getFolderById(photosFolderId);
    const mainInfo     = getFolderPhotoInfo(photosFolder);
    let allPhotosCount = mainInfo.count;
    let allPhotosCover = mainInfo.coverId;

    const subfolders = photosFolder.getFolders();
    const albums     = [];

    while (subfolders.hasNext()) {
      const folder = subfolders.next();
      const info   = getFolderPhotoInfo(folder);

      allPhotosCount += info.count;
      if (!allPhotosCover && info.coverId) allPhotosCover = info.coverId;

      if (info.count > 0) {
        albums.push({
          id:            folder.getId(),
          name:          folder.getName(),
          description:   info.count + ' photo' + (info.count !== 1 ? 's' : ''),
          photoCount:    info.count,
          coverPhotoUrl: 'https://drive.google.com/thumbnail?id=' + info.coverId + '&sz=w400'
        });
      }
    }

    albums.sort(function (a, b) { return a.name.localeCompare(b.name); });

    return {
      success:        true,
      albums:         albums,
      allPhotosCount: allPhotosCount,
      allPhotosCover: allPhotosCover
    };

  } catch (error) {
    return { success: false, error: error.toString() };
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// Album photos
// ─────────────────────────────────────────────────────────────────────────────

function getAlbumPhotos(albumId) {
  try {
    const folder = DriveApp.getFolderById(albumId);
    const photos = [];

    const jpegFiles = folder.getFilesByType(MimeType.JPEG);
    while (jpegFiles.hasNext()) {
      photos.push(createPhotoObject(jpegFiles.next()));
    }

    const pngFiles = folder.getFilesByType(MimeType.PNG);
    while (pngFiles.hasNext()) {
      photos.push(createPhotoObject(pngFiles.next()));
    }

    photos.sort(function (a, b) { return a.name.localeCompare(b.name); });

    return { success: true, photos: photos };

  } catch (error) {
    return { success: false, error: error.toString() };
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// All photos (main folder + all subfolders)
// ─────────────────────────────────────────────────────────────────────────────

function getAllPhotos(photosFolderId) {
  try {
    const photosFolder = DriveApp.getFolderById(photosFolderId);
    const photos       = [];

    const jpegFiles = photosFolder.getFilesByType(MimeType.JPEG);
    while (jpegFiles.hasNext()) { photos.push(createPhotoObject(jpegFiles.next())); }

    const pngFiles = photosFolder.getFilesByType(MimeType.PNG);
    while (pngFiles.hasNext()) { photos.push(createPhotoObject(pngFiles.next())); }

    const subfolders = photosFolder.getFolders();
    while (subfolders.hasNext()) {
      const folder = subfolders.next();

      const subJpeg = folder.getFilesByType(MimeType.JPEG);
      while (subJpeg.hasNext()) { photos.push(createPhotoObject(subJpeg.next())); }

      const subPng = folder.getFilesByType(MimeType.PNG);
      while (subPng.hasNext()) { photos.push(createPhotoObject(subPng.next())); }
    }

    photos.sort(function (a, b) {
      return new Date(b.lastModified) - new Date(a.lastModified);
    });

    return { success: true, photos: photos };

  } catch (error) {
    return { success: false, error: error.toString() };
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function createPhotoObject(file) {
  const fileId = file.getId();
  return {
    id:           fileId,
    name:         file.getName(),
    caption:      file.getDescription() || '',
    thumbnailUrl: 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w400',
    fullUrl:      'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w2000',
    fallbackUrl:  'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w1200',
    downloadUrl:  'https://drive.google.com/uc?id=' + fileId + '&export=download',
    lastModified: file.getLastUpdated().toISOString()
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// Diagnostics (run manually from the editor when debugging photo albums)
// ─────────────────────────────────────────────────────────────────────────────

function diagnoseParallel() {
  const photosFolderId = '1iJJURi3pZpsPnCwNvgtHwc1BatJlCPL1';

  const t0 = Date.now();
  let token;
  try {
    token = ScriptApp.getOAuthToken();
    console.log('Token obtained: ' + (token ? 'YES' : 'NO') + ' — ' + (Date.now() - t0) + 'ms');
  } catch (e) {
    console.log('Token FAILED: ' + e);
    return;
  }

  const t1 = Date.now();
  const subfoldersRes  = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(
      "'" + photosFolderId + "' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"
    ) + '&fields=files(id,name)&pageSize=100',
    { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true }
  );
  const subfoldersData = JSON.parse(subfoldersRes.getContentText());
  const folderList     = [{ id: photosFolderId, name: '__MAIN__' }];
  (subfoldersData.files || []).forEach(function (f) {
    folderList.push({ id: f.id, name: f.name });
  });
  console.log('Got ' + folderList.length + ' folders via Drive API in ' + (Date.now() - t1) + 'ms');

  const t2         = Date.now();
  const testRes    = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(
      "'" + photosFolderId + "' in parents and trashed=false"
    ) + '&fields=files(id)&pageSize=1',
    { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true }
  );
  console.log('Single test request: HTTP ' + testRes.getResponseCode() + ' — ' + (Date.now() - t2) + 'ms');

  const t3       = Date.now();
  const requests = folderList.map(function (folder) {
    return {
      url: 'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(
        "'" + folder.id + "' in parents and (mimeType='image/jpeg' or mimeType='image/png') and trashed=false"
      ) + '&fields=files(id)&pageSize=1000',
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    };
  });
  const responses = UrlFetchApp.fetchAll(requests);
  console.log('fetchAll (' + requests.length + ' requests) completed in ' + (Date.now() - t3) + 'ms');
  responses.forEach(function (r, i) {
    const d = JSON.parse(r.getContentText());
    console.log('  ' + folderList[i].name + ': HTTP ' + r.getResponseCode() + ', ' + (d.files || []).length + ' photos, error: ' + (d.error ? JSON.stringify(d.error) : 'none'));
  });

  console.log('TOTAL: ' + (Date.now() - t0) + 'ms');
}