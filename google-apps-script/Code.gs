// Google Apps Script - Code.gs
// This script works with your existing HTML without any changes

function doGet(e) {
  const action = e.parameter.action;
  
  try {
    if (action === 'photoAlbums') {
      const photosFolderId = e.parameter.photosFolderId;
      return getPhotoAlbums(photosFolderId);
    } else if (action === 'albumPhotos') {
      // Accept BOTH folderId and albumId for compatibility
      const folderId = e.parameter.folderId || e.parameter.albumId;
      return getAlbumPhotos(folderId);
    } else if (action === 'allPhotos') {
      const photosFolderId = e.parameter.photosFolderId;
      return getAllPhotos(photosFolderId);
    } else if (action === 'files') {
      const filesFolderId = e.parameter.filesFolderId;
      return getFiles(filesFolderId);
    } else {
      // Default action - backward compatibility with old URL format
      const filesFolderId = e.parameter.filesFolderId;
      return getFiles(filesFolderId);
    }
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// Get list of photo albums (subfolders in Photos folder)
function getPhotoAlbums(photosFolderId) {
  try {
    if (!photosFolderId) {
      throw new Error('Missing photosFolderId parameter');
    }
    
    const photosFolder = DriveApp.getFolderById(photosFolderId);
    const subfolders = photosFolder.getFolders();
    const albums = [];
    let totalPhotosCount = 0;
    let firstPhotoId = null;
    
    while (subfolders.hasNext()) {
      const folder = subfolders.next();
      const folderId = folder.getId();
      const folderName = folder.getName();
      
      // Get photos in this folder
      const photos = folder.getFilesByType(MimeType.JPEG);
      const pngPhotos = folder.getFilesByType(MimeType.PNG);
      
      let photoCount = 0;
      let coverPhotoId = null;
      
      // Count JPEG photos
      while (photos.hasNext()) {
        const photo = photos.next();
        photoCount++;
        totalPhotosCount++;
        if (!coverPhotoId) coverPhotoId = photo.getId();
        if (!firstPhotoId) firstPhotoId = photo.getId();
      }
      
      // Count PNG photos
      while (pngPhotos.hasNext()) {
        const photo = pngPhotos.next();
        photoCount++;
        totalPhotosCount++;
        if (!coverPhotoId) coverPhotoId = photo.getId();
        if (!firstPhotoId) firstPhotoId = photo.getId();
      }
      
      if (photoCount > 0) {
        albums.push({
          id: folderId,
          name: folderName,
          description: `${photoCount} photo${photoCount !== 1 ? 's' : ''}`,
          photoCount: photoCount,
          coverPhotoUrl: coverPhotoId
        });
      }
    }
    
    // Sort albums by name (newest first, assuming date format in name)
    albums.sort((a, b) => b.name.localeCompare(a.name));
    
    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      albums: albums,
      allPhotosCount: totalPhotosCount,
      allPhotosCover: firstPhotoId
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// Get photos from a specific album
function getAlbumPhotos(folderId) {
  try {
    if (!folderId) {
      throw new Error('Missing folderId parameter');
    }
    
    const folder = DriveApp.getFolderById(folderId);
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
    
    // Sort photos by name
    photos.sort((a, b) => a.name.localeCompare(b.name));
    
    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      photos: photos,
      count: photos.length
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.toString(),
      folderId: folderId
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// Get all photos from all subfolders
function getAllPhotos(photosFolderId) {
  try {
    if (!photosFolderId) {
      throw new Error('Missing photosFolderId parameter');
    }
    
    const photosFolder = DriveApp.getFolderById(photosFolderId);
    const allPhotos = [];
    const subfolders = photosFolder.getFolders();
    
    // Iterate through all subfolders
    while (subfolders.hasNext()) {
      const folder = subfolders.next();
      
      // Get JPEG files
      const jpegFiles = folder.getFilesByType(MimeType.JPEG);
      while (jpegFiles.hasNext()) {
        const file = jpegFiles.next();
        allPhotos.push(createPhotoObject(file));
      }
      
      // Get PNG files
      const pngFiles = folder.getFilesByType(MimeType.PNG);
      while (pngFiles.hasNext()) {
        const file = pngFiles.next();
        allPhotos.push(createPhotoObject(file));
      }
    }
    
    // Sort by date (newest first)
    allPhotos.sort((a, b) => b.name.localeCompare(a.name));
    
    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      photos: allPhotos,
      count: allPhotos.length
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// Helper function to create photo object
function createPhotoObject(file) {
  const fileId = file.getId();
  const fileName = file.getName();
  
  return {
    id: fileId,
    name: fileName,
    thumbnailUrl: `https://drive.google.com/thumbnail?id=${fileId}&sz=w400`,
    fullUrl: `https://drive.google.com/uc?export=view&id=${fileId}`,
    downloadUrl: `https://drive.google.com/uc?export=download&id=${fileId}`,
    fallbackUrl: `https://drive.google.com/uc?export=view&id=${fileId}`,
    caption: fileName.replace(/\.(jpg|jpeg|png)$/i, '').replace(/[-_]/g, ' ')
  };
}

// Get files from Files folder
function getFiles(filesFolderId) {
  try {
    if (!filesFolderId) {
      throw new Error('Missing filesFolderId parameter');
    }
    
    const folder = DriveApp.getFolderById(filesFolderId);
    const files = folder.getFiles();
    const fileList = [];
    
    while (files.hasNext()) {
      const file = files.next();
      fileList.push({
        name: file.getName(),
        description: file.getDescription() || 'No description',
        size: file.getSize(),
        downloadUrl: file.getDownloadUrl(),
        mimeType: file.getMimeType()
      });
    }
    
    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      files: fileList
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}