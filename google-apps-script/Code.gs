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
        const albumId = e.parameter.albumId;
        if (!albumId) {
          return ContentService.createTextOutput(
            JSON.stringify({
              success: false,
              error: 'Missing albumId parameter'
            })
          ).setMimeType(ContentService.MimeType.JSON);
        }
        result = getAlbumPhotos(albumId);
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
  try {
    const photosFolder = DriveApp.getFolderById(photosFolderId);
    const subfolders = photosFolder.getFolders();
    const albums = [];
    
    let allPhotosCount = 0;
    let allPhotosCover = null;
    
    // Get all photos directly in the main photos folder for "All Photos"
    const allPhotosInMain = photosFolder.getFilesByType(MimeType.JPEG);
    const pngPhotos = photosFolder.getFilesByType(MimeType.PNG);
    
    while (allPhotosInMain.hasNext()) {
      const photo = allPhotosInMain.next();
      allPhotosCount++;
      if (!allPhotosCover) {
        allPhotosCover = photo.getId();
      }
    }
    
    while (pngPhotos.hasNext()) {
      const photo = pngPhotos.next();
      allPhotosCount++;
      if (!allPhotosCover) {
        allPhotosCover = photo.getId();
      }
    }
    
    // Process each subfolder as an album
    while (subfolders.hasNext()) {
      const folder = subfolders.next();
      const folderName = folder.getName();
      
      // Count photos in this album
      const jpegFiles = folder.getFilesByType(MimeType.JPEG);
      const pngFiles = folder.getFilesByType(MimeType.PNG);
      
      let photoCount = 0;
      let coverPhotoId = null;
      
      while (jpegFiles.hasNext()) {
        const file = jpegFiles.next();
        photoCount++;
        allPhotosCount++;
        if (!coverPhotoId) {
          coverPhotoId = file.getId();
        }
        if (!allPhotosCover) {
          allPhotosCover = file.getId();
        }
      }
      
      while (pngFiles.hasNext()) {
        const file = pngFiles.next();
        photoCount++;
        allPhotosCount++;
        if (!coverPhotoId) {
          coverPhotoId = file.getId();
        }
        if (!allPhotosCover) {
          allPhotosCover = file.getId();
        }
      }
      
      if (photoCount > 0) {
        albums.push({
          id: folder.getId(),
          name: folderName,
          description: `${photoCount} photo${photoCount !== 1 ? 's' : ''}`,
          photoCount: photoCount,
          coverPhotoUrl: coverPhotoId ? `https://drive.google.com/thumbnail?id=${coverPhotoId}&sz=w400` : null
        });
      }
    }
    
    // Sort albums by name
    albums.sort((a, b) => a.name.localeCompare(b.name));
    
    return {
      success: true,
      albums: albums,
      allPhotosCount: allPhotosCount,
      allPhotosCover: allPhotosCover
    };
    
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
    fullUrl: `https://drive.google.com/uc?export=view&id=${fileId}`,
    downloadUrl: file.getDownloadUrl(),
    lastModified: file.getLastUpdated().toISOString()
  };
}