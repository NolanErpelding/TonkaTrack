// Universal Google Apps Script for Team Files & Photos
// This script can be used by all teams by passing different folder IDs

function doGet(e) {
  const action = e.parameter.action;
  const folderId = e.parameter.folderId;
  
  // Validate that folderId is provided for actions that need it
  if (!folderId && action !== 'test') {
    return ContentService.createTextOutput(
      JSON.stringify({
        success: false,
        error: 'Missing folderId parameter'
      })
    ).setMimeType(ContentService.MimeType.JSON);
  }
  
  try {
    let result;
    
    switch(action) {
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
      case 'test':
        result = { success: true, message: 'Script is working!' };
        break;
      default:
        result = {
          success: false,
          error: 'Invalid action. Use: files, photoAlbums, albumPhotos, allPhotos, or test'
        };
    }
    
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    return ContentService.createTextOutput(
      JSON.stringify({
        success: false,
        error: error.toString()
      })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

// Get all files from the specified folder
function getTeamFiles(folderId) {
  try {
    const folder = DriveApp.getFolderById(folderId);
    const files = folder.getFiles();
    const fileList = [];
    
    while (files.hasNext()) {
      const file = files.next();
      const mimeType = file.getMimeType();
      
      // Only include PDF and common document types
      if (mimeType === 'application/pdf' || 
          mimeType === 'application/vnd.google-apps.document' ||
          mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
          mimeType === 'application/msword') {
        
        fileList.push({
          name: file.getName(),
          description: file.getDescription() || 'Team document',
          size: file.getSize(),
          mimeType: mimeType,
          downloadUrl: file.getDownloadUrl(),
          lastModified: file.getLastUpdated().toISOString()
        });
      }
    }
    
    // Sort by last modified date (newest first)
    fileList.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
    
    return {
      success: true,
      files: fileList
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.toString()
    };
  }
}

// Get photo albums (subfolders) from the specified photos folder
function getPhotoAlbums(photosFolderId) {
  // --- Check cache first ---
  const cache = CacheService.getScriptCache();
  const cacheKey = `albums_${photosFolderId}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  try {
    const result = getPhotoAlbumsParallel(photosFolderId);
    
    // If parallel approach failed for any reason, fall back to DriveApp
    if (!result.success) {
      console.warn('Parallel approach failed, falling back to DriveApp:', result.error);
      return getPhotoAlbumsFallback(photosFolderId);
    }

    // Cache the successful result for 10 minutes
    try {
      cache.put(cacheKey, JSON.stringify(result), 600);
    } catch (cacheError) {
      console.warn('Cache write failed:', cacheError.toString());
    }

    return result;

  } catch (error) {
    // If anything throws unexpectedly, still try the fallback
    console.warn('getPhotoAlbums threw, falling back:', error.toString());
    return getPhotoAlbumsFallback(photosFolderId);
  }
}

// Fast parallel approach using only UrlFetchApp — no DriveApp calls
function getPhotoAlbumsParallel(photosFolderId) {
  try {
    const token = ScriptApp.getOAuthToken();
    if (!token) throw new Error('No OAuth token available');

    // Step 1: Get subfolders via Drive API
    const subfoldersResponse = UrlFetchApp.fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
        `'${photosFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
      )}&fields=files(id,name)&pageSize=100`,
      { headers: { Authorization: `Bearer ${token}` }, muteHttpExceptions: true }
    );

    if (subfoldersResponse.getResponseCode() !== 200) {
      throw new Error(`Subfolder fetch failed: HTTP ${subfoldersResponse.getResponseCode()}`);
    }

    const subfoldersData = JSON.parse(subfoldersResponse.getContentText());
    if (subfoldersData.error) {
      throw new Error(`Drive API error getting subfolders: ${JSON.stringify(subfoldersData.error)}`);
    }

    const folderList = [{ id: photosFolderId, name: '__MAIN__' }];
    (subfoldersData.files || []).forEach(f => folderList.push({ id: f.id, name: f.name }));

    // Step 2: One request per folder — get IDs only (cover = first, count = length)
    const requests = folderList.map(folder => ({
      url: `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
        `'${folder.id}' in parents and (mimeType='image/jpeg' or mimeType='image/png') and trashed=false`
      )}&fields=files(id)&pageSize=1000`,
      headers: { Authorization: `Bearer ${token}` },
      muteHttpExceptions: true
    }));

    // Fire all in parallel
    const responses = UrlFetchApp.fetchAll(requests);

    // Step 3: Process
    let allPhotosCount = 0;
    let allPhotosCover = null;
    const albums = [];

    folderList.forEach((folder, i) => {
      const response = responses[i];

      if (response.getResponseCode() !== 200) {
        throw new Error(`HTTP ${response.getResponseCode()} for folder ${folder.name}`);
      }

      const data = JSON.parse(response.getContentText());
      if (data.error) {
        throw new Error(`API error for folder ${folder.name}: ${JSON.stringify(data.error)}`);
      }

      const files = data.files || [];
      const count = files.length;
      const coverId = count > 0 ? files[0].id : null;

      allPhotosCount += count;
      if (!allPhotosCover && coverId) allPhotosCover = coverId;

      if (folder.name !== '__MAIN__' && count > 0) {
        albums.push({
          id: folder.id,
          name: folder.name,
          description: `${count} photo${count !== 1 ? 's' : ''}`,
          photoCount: count,
          coverPhotoUrl: `https://drive.google.com/thumbnail?id=${coverId}&sz=w400`
        });
      }
    });

    albums.sort((a, b) => a.name.localeCompare(b.name));

    return {
      success: true,
      albums: albums,
      allPhotosCount: allPhotosCount,
      allPhotosCover: allPhotosCover
    };

  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

// Reliable DriveApp fallback (slower but always works)
function getPhotoAlbumsFallback(photosFolderId) {
  try {
    function getFolderPhotoInfo(folder) {
      let count = 0;
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
    const mainInfo = getFolderPhotoInfo(photosFolder);
    let allPhotosCount = mainInfo.count;
    let allPhotosCover = mainInfo.coverId;

    const subfolders = photosFolder.getFolders();
    const albums = [];

    while (subfolders.hasNext()) {
      const folder = subfolders.next();
      const info = getFolderPhotoInfo(folder);

      allPhotosCount += info.count;
      if (!allPhotosCover && info.coverId) allPhotosCover = info.coverId;

      if (info.count > 0) {
        albums.push({
          id: folder.getId(),
          name: folder.getName(),
          description: `${info.count} photo${info.count !== 1 ? 's' : ''}`,
          photoCount: info.count,
          coverPhotoUrl: `https://drive.google.com/thumbnail?id=${info.coverId}&sz=w400`
        });
      }
    }

    albums.sort((a, b) => a.name.localeCompare(b.name));

    return {
      success: true,
      albums: albums,
      allPhotosCount: allPhotosCount,
      allPhotosCover: allPhotosCover
    };

  } catch (error) {
    return { success: false, error: error.toString() };
  }
}
// Get all photos from a specific album (subfolder)
function getAlbumPhotos(albumId) {
  try {
    const folder = DriveApp.getFolderById(albumId);
    const photos = [];
    
    // Get JPEG files
    const jpegFiles = folder.getFilesByType(MimeType.JPEG);
    while (jpegFiles.hasNext()) {
      const file = jpegFiles.next();
      photos.push(createPhotoObject(file));
    }
    
    // Get PNG files
    const pngFiles = folder.getFilesByType(MimeType.PNG);
    while (pngFiles.hasNext()) {
      const file = pngFiles.next();
      photos.push(createPhotoObject(file));
    }
    
    // Sort by name
    photos.sort((a, b) => a.name.localeCompare(b.name));
    
    return {
      success: true,
      photos: photos
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.toString()
    };
  }
}

// Get all photos from the main folder and all subfolders
function getAllPhotos(photosFolderId) {
  try {
    const photosFolder = DriveApp.getFolderById(photosFolderId);
    const photos = [];
    
    // Get photos from main folder
    const jpegFiles = photosFolder.getFilesByType(MimeType.JPEG);
    while (jpegFiles.hasNext()) {
      const file = jpegFiles.next();
      photos.push(createPhotoObject(file));
    }
    
    const pngFiles = photosFolder.getFilesByType(MimeType.PNG);
    while (pngFiles.hasNext()) {
      const file = pngFiles.next();
      photos.push(createPhotoObject(file));
    }
    
    // Get photos from all subfolders
    const subfolders = photosFolder.getFolders();
    while (subfolders.hasNext()) {
      const folder = subfolders.next();
      
      const subJpegFiles = folder.getFilesByType(MimeType.JPEG);
      while (subJpegFiles.hasNext()) {
        const file = subJpegFiles.next();
        photos.push(createPhotoObject(file));
      }
      
      const subPngFiles = folder.getFilesByType(MimeType.PNG);
      while (subPngFiles.hasNext()) {
        const file = subPngFiles.next();
        photos.push(createPhotoObject(file));
      }
    }
    
    // Sort by date modified (newest first)
    photos.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
    
    return {
      success: true,
      photos: photos
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.toString()
    };
  }
}

// Helper function to create photo object
function createPhotoObject(file) {
  const fileId = file.getId();
  return {
    id: fileId,
    name: file.getName(),
    caption: file.getDescription() || '',
    thumbnailUrl: `https://drive.google.com/thumbnail?id=${fileId}&sz=w400`,
    fullUrl: `https://drive.google.com/thumbnail?id=${fileId}&sz=w2000`,
    fallbackUrl: `https://drive.google.com/thumbnail?id=${fileId}&sz=w1200`,
    downloadUrl: `https://drive.google.com/uc?id=${fileId}&export=download`,
    lastModified: file.getLastUpdated().toISOString()
  };
}

function diagnoseParallel() {
  const photosFolderId = '1iJJURi3pZpsPnCwNvgtHwc1BatJlCPL1';
  
  // Test 1: Can we get a token?
  const t0 = Date.now();
  let token;
  try {
    token = ScriptApp.getOAuthToken();
    console.log(`Token obtained: ${token ? 'YES' : 'NO'} — ${Date.now() - t0}ms`);
  } catch(e) {
    console.log(`Token FAILED: ${e}`);
    return;
  }

  // Test 2: Get subfolders via Drive API (not DriveApp)
  const t1 = Date.now();
  const subfoldersRes = UrlFetchApp.fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      `'${photosFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    )}&fields=files(id,name)&pageSize=100`,
    { headers: { Authorization: `Bearer ${token}` }, muteHttpExceptions: true }
  );
  const subfoldersData = JSON.parse(subfoldersRes.getContentText());
  const folderList = [{ id: photosFolderId, name: '__MAIN__' }];
  (subfoldersData.files || []).forEach(f => folderList.push({ id: f.id, name: f.name }));
  console.log(`Got ${folderList.length} folders via Drive API in ${Date.now() - t1}ms`);

  // Test 3: Fire one test request to check auth
  const t2 = Date.now();
  const testResponse = UrlFetchApp.fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${photosFolderId}' in parents and trashed=false`)}&fields=files(id)&pageSize=1`,
    { headers: { Authorization: `Bearer ${token}` }, muteHttpExceptions: true }
  );
  console.log(`Single test request: HTTP ${testResponse.getResponseCode()} — ${Date.now() - t2}ms`);
  console.log(`Response body: ${testResponse.getContentText().substring(0, 300)}`);

  // Test 4: Fire all requests in parallel and time it
  const t3 = Date.now();
  const requests = folderList.map(folder => ({
    url: `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      `'${folder.id}' in parents and (mimeType='image/jpeg' or mimeType='image/png') and trashed=false`
    )}&fields=files(id)&pageSize=1000`,
    headers: { Authorization: `Bearer ${token}` },
    muteHttpExceptions: true
  }));
  const responses = UrlFetchApp.fetchAll(requests);
  console.log(`fetchAll (${requests.length} requests) completed in ${Date.now() - t3}ms`);
  responses.forEach((r, i) => {
    const data = JSON.parse(r.getContentText());
    console.log(`  ${folderList[i].name}: HTTP ${r.getResponseCode()}, ${(data.files||[]).length} photos, error: ${data.error ? JSON.stringify(data.error) : 'none'}`);
  });

  console.log(`TOTAL: ${Date.now() - t0}ms`);
}
