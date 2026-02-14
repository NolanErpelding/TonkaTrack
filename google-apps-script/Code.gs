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
    const albums = [];
    let allPhotosCount = 0;
    let allPhotosCover = null;

    // --- Helper: get count + cover ID from a folder using Drive v3 in one call ---
    function getFolderPhotoInfo(folderId) {
      let count = 0;
      let coverId = null;
      let pageToken = null;

      do {
        const params = {
          q: `'${folderId}' in parents and (mimeType='image/jpeg' or mimeType='image/png') and trashed=false`,
          fields: 'nextPageToken, files(id)',
          pageSize: 1000,
          spaces: 'drive'
        };
        if (pageToken) params.pageToken = pageToken;

        const result = Drive.Files.list(params);
        const files = result.files || [];

        count += files.length;
        if (!coverId && files.length > 0) {
          coverId = files[0].id;
        }

        pageToken = result.nextPageToken;
      } while (pageToken);

      return { count, coverId };
    }

    // Count photos directly in the main folder
    const mainInfo = getFolderPhotoInfo(photosFolderId);
    allPhotosCount += mainInfo.count;
    if (!allPhotosCover) allPhotosCover = mainInfo.coverId;

    // Process each subfolder as an album
    const photosFolder = DriveApp.getFolderById(photosFolderId);
    const subfolders = photosFolder.getFolders();

    while (subfolders.hasNext()) {
      const folder = subfolders.next();
      const folderId = folder.getId();
      const folderName = folder.getName();

      const info = getFolderPhotoInfo(folderId);
      allPhotosCount += info.count;
      if (!allPhotosCover) allPhotosCover = info.coverId;

      if (info.count > 0) {
        albums.push({
          id: folderId,
          name: folderName,
          description: `${info.count} photo${info.count !== 1 ? 's' : ''}`,
          photoCount: info.count,
          coverPhotoUrl: info.coverId
            ? `https://drive.google.com/thumbnail?id=${info.coverId}&sz=w400`
            : null
        });
      }
    }

    // Sort albums by name
    albums.sort((a, b) => a.name.localeCompare(b.name));

    const result = {
      success: true,
      albums: albums,
      allPhotosCount: allPhotosCount,
      allPhotosCover: allPhotosCover
    };

    // --- Store in cache for 10 minutes (600 seconds) ---
    // CacheService has a 100KB value limit; if you ever hit that, reduce cache duration or remove allPhotos caching
    try {
      cache.put(cacheKey, JSON.stringify(result), 600);
    } catch (cacheError) {
      // Cache write failed (e.g. value too large) — not critical, just skip caching
      console.warn('Cache write failed:', cacheError.toString());
    }

    return result;

  } catch (error) {
    return {
      success: false,
      error: error.toString()
    };
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