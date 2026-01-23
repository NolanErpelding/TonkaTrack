// Force Drive API initialization
var drive = DriveApp;

// Cache to store results temporarily (lasts for script execution)
var cache = CacheService.getScriptCache();
var CACHE_DURATION = 300; // 5 minutes in seconds

function doGet(e) {
  const action = e.parameter.action || 'files';
  
  if (action === 'photos') {
    return getPhotos();
  } else if (action === 'photoAlbums') {
    return getPhotoAlbums();
  } else if (action === 'albumPhotos') {
    const folderId = e.parameter.folderId;
    return getAlbumPhotos(folderId);
  } else if (action === 'allPhotos') {
    return getAllPhotos();
  } else {
    return getFiles();
  }
}

function testDriveAccess() {
  try {
    const folderId = '1iJJURi3pZpsPnCwNvgtHwc1BatJlCPL1';
    const folder = DriveApp.getFolderById(folderId);
    Logger.log('Success! Folder name: ' + folder.getName());
    return 'Success! Can access Drive.';
  } catch (error) {
    Logger.log('Error: ' + error.toString());
    return 'Error: ' + error.toString();
  }
}

function getFiles() {
  const folderId = '14X4jyyR7Gm25R2uF2Swvd3Ir0_8bN_Jg';
  
  try {
    const folder = DriveApp.getFolderById(folderId);
    const files = folder.getFiles();
    
    const fileList = [];
    while (files.hasNext()) {
      const file = files.next();
      
      if (file.getName().startsWith('.')) continue;
      
      const description = file.getDescription() || getDefaultDescription(file.getName());
      
      fileList.push({
        name: file.getName(),
        description: description,
        downloadUrl: `https://drive.google.com/uc?export=download&id=${file.getId()}`,
        size: file.getSize(),
        lastModified: file.getLastUpdated().toISOString()
      });
    }
    
    var output = ContentService.createTextOutput(JSON.stringify({ files: fileList, success: true }));
    output.setMimeType(ContentService.MimeType.JSON);
    return output;
      
  } catch (error) {
    var output = ContentService.createTextOutput(JSON.stringify({ error: error.toString(), success: false }));
    output.setMimeType(ContentService.MimeType.JSON);
    return output;
  }
}

function getPhotoAlbums() {
  const photosFolderId = '1iJJURi3pZpsPnCwNvgtHwc1BatJlCPL1';
  
  // Try cache first
  const cacheKey = 'photoAlbums_' + photosFolderId;
  const cached = cache.get(cacheKey);
  if (cached) {
    var output = ContentService.createTextOutput(cached);
    output.setMimeType(ContentService.MimeType.JSON);
    return output;
  }
  
  try {
    const mainFolder = DriveApp.getFolderById(photosFolderId);
    
    // Get subfolders (albums)
    const subfolders = mainFolder.getFolders();
    const albums = [];
    
    while (subfolders.hasNext()) {
      const folder = subfolders.next();
      
      if (folder.getName().startsWith('.')) continue;
      
      // Count photos in folder
      const files = folder.getFiles();
      let photoCount = 0;
      let coverPhoto = null;
      
      while (files.hasNext()) {
        const file = files.next();
        if (file.getMimeType().startsWith('image/') && !file.getName().startsWith('.')) {
          photoCount++;
          if (!coverPhoto) {
            coverPhoto = file.getId();
          }
        }
      }
      
      if (photoCount > 0) {
        const createdDate = folder.getDateCreated();
        const formattedDate = Utilities.formatDate(createdDate, Session.getScriptTimeZone(), 'MMM d, yyyy');
        
        albums.push({
          id: folder.getId(),
          name: folder.getName(),
          description: `${formattedDate} • ${photoCount} photo${photoCount !== 1 ? 's' : ''}`,
          photoCount: photoCount,
          coverPhotoUrl: coverPhoto ? `https://drive.google.com/thumbnail?id=${coverPhoto}&sz=w400` : null,
          createdDate: createdDate.toISOString(),
          lastModified: folder.getLastUpdated().toISOString()
        });
      }
    }
    
    // Count ALL photos recursively - OPTIMIZED VERSION
    const allPhotosList = [];
    countAllPhotosRecursive(mainFolder, allPhotosList, 1); // Only get first photo for cover
    
    const allPhotosCount = allPhotosList.length;
    const allPhotosCover = allPhotosList.length > 0 ? allPhotosList[0].getId() : null;
    
    // Sort by creation date (newest first)
    albums.sort((a, b) => new Date(b.createdDate) - new Date(a.createdDate));
    
    const result = JSON.stringify({ 
      albums: albums, 
      allPhotosCount: allPhotosCount,
      allPhotosCover: allPhotosCover,
      mainFolderId: photosFolderId,
      success: true 
    });
    
    // Cache the result
    cache.put(cacheKey, result, CACHE_DURATION);
    
    var output = ContentService.createTextOutput(result);
    output.setMimeType(ContentService.MimeType.JSON);
    return output;
      
  } catch (error) {
    var output = ContentService.createTextOutput(JSON.stringify({ 
      error: error.toString(), 
      stack: error.stack,
      success: false 
    }));
    output.setMimeType(ContentService.MimeType.JSON);
    return output;
  }
}

// OPTIMIZED: Now accepts maxPhotos parameter to stop early
function countAllPhotosRecursive(folder, photoList, maxPhotos) {
  if (maxPhotos && photoList.length >= maxPhotos) return;
  
  const files = folder.getFiles();
  while (files.hasNext()) {
    if (maxPhotos && photoList.length >= maxPhotos) return;
    
    const file = files.next();
    if (file.getName().startsWith('.')) continue;
    if (file.getMimeType().startsWith('image/')) {
      photoList.push(file);
    }
  }
  
  const subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    if (maxPhotos && photoList.length >= maxPhotos) return;
    
    const subfolder = subfolders.next();
    if (subfolder.getName().startsWith('.')) continue;
    countAllPhotosRecursive(subfolder, photoList, maxPhotos);
  }
}

function getAlbumPhotos(folderId) {
  // Try cache first
  const cacheKey = 'albumPhotos_' + folderId;
  const cached = cache.get(cacheKey);
  if (cached) {
    var output = ContentService.createTextOutput(cached);
    output.setMimeType(ContentService.MimeType.JSON);
    return output;
  }
  
  try {
    const folder = DriveApp.getFolderById(folderId);
    const files = folder.getFiles();
    
    const photoList = [];
    while (files.hasNext()) {
      const file = files.next();
      
      if (file.getName().startsWith('.')) continue;
      
      const mimeType = file.getMimeType();
      if (!mimeType.startsWith('image/')) continue;
      
      const caption = file.getDescription() || '';
      const fileId = file.getId();
      
      photoList.push({
        id: fileId,
        name: file.getName(),
        caption: caption,
        thumbnailUrl: `https://drive.google.com/thumbnail?id=${fileId}&sz=w400`,
        fullUrl: `https://drive.google.com/thumbnail?id=${fileId}&sz=w2000`,
        fallbackUrl: `https://drive.google.com/thumbnail?id=${fileId}&sz=w1600`,
        downloadUrl: `https://drive.google.com/uc?export=download&id=${fileId}`,
        lastModified: file.getLastUpdated().toISOString()
      });
    }
    
    photoList.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
    
    const result = JSON.stringify({ 
      photos: photoList, 
      albumName: folder.getName(),
      success: true 
    });
    
    // Cache the result
    cache.put(cacheKey, result, CACHE_DURATION);
    
    var output = ContentService.createTextOutput(result);
    output.setMimeType(ContentService.MimeType.JSON);
    return output;
      
  } catch (error) {
    var output = ContentService.createTextOutput(JSON.stringify({ error: error.toString(), success: false }));
    output.setMimeType(ContentService.MimeType.JSON);
    return output;
  }
}

// OPTIMIZED: Limit photos and skip unnecessary date calls
function getAllPhotosRecursive(folder, photoList, maxPhotos) {
  if (maxPhotos && photoList.length >= maxPhotos) return;
  
  const files = folder.getFiles();
  while (files.hasNext()) {
    if (maxPhotos && photoList.length >= maxPhotos) return;
    
    const file = files.next();
    if (file.getName().startsWith('.')) continue;
    if (file.getMimeType().startsWith('image/')) {
      photoList.push(file);
    }
  }
  
  const subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    if (maxPhotos && photoList.length >= maxPhotos) return;
    
    const subfolder = subfolders.next();
    if (subfolder.getName().startsWith('.')) continue;
    getAllPhotosRecursive(subfolder, photoList, maxPhotos);
  }
}

function getAllPhotos() {
  const photosFolderId = '1iJJURi3pZpsPnCwNvgtHwc1BatJlCPL1';
  
  // Try cache first
  const cacheKey = 'allPhotos_' + photosFolderId;
  const cached = cache.get(cacheKey);
  if (cached) {
    var output = ContentService.createTextOutput(cached);
    output.setMimeType(ContentService.MimeType.JSON);
    return output;
  }
  
  try {
    const mainFolder = DriveApp.getFolderById(photosFolderId);
    const allPhotos = [];
    
    // OPTIMIZATION: Limit to first 100 photos to speed up response
    const MAX_PHOTOS = 100;
    getAllPhotosRecursive(mainFolder, allPhotos, MAX_PHOTOS);
    
    const photoList = [];
    
    // OPTIMIZATION: Batch process files - get all IDs first, then build URLs
    allPhotos.forEach(file => {
      const caption = file.getDescription() || '';
      const fileId = file.getId();
      
      photoList.push({
        id: fileId,
        name: file.getName(),
        caption: caption,
        thumbnailUrl: `https://drive.google.com/thumbnail?id=${fileId}&sz=w400`,
        fullUrl: `https://drive.google.com/thumbnail?id=${fileId}&sz=w2000`,
        fallbackUrl: `https://drive.google.com/thumbnail?id=${fileId}&sz=w1600`,
        downloadUrl: `https://drive.google.com/uc?export=download&id=${fileId}`
        // REMOVED: lastModified to speed up - it's expensive!
      });
    });
    
    // OPTIMIZATION: Skip sorting by date since we removed lastModified
    // Photos will be in the order they're found (usually newest folders first)
    
    const result = JSON.stringify({ 
      photos: photoList, 
      albumName: 'All Photos',
      totalPhotos: photoList.length,
      isLimited: photoList.length >= MAX_PHOTOS,
      success: true 
    });
    
    // Cache for 5 minutes
    cache.put(cacheKey, result, CACHE_DURATION);
    
    var output = ContentService.createTextOutput(result);
    output.setMimeType(ContentService.MimeType.JSON);
    return output;
      
  } catch (error) {
    var output = ContentService.createTextOutput(JSON.stringify({ error: error.toString(), success: false }));
    output.setMimeType(ContentService.MimeType.JSON);
    return output;
  }
}

function getDefaultDescription(fileName) {
  const extension = fileName.split('.').pop().toUpperCase();
  return `${extension} document`;
}