// Force Drive API initialization
var drive = DriveApp;

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
    const folderId = '1eW5s-bl0d9dhrUpT91xhDTTtVh_lVlTE';
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
  const photosFolderId = '1eW5s-bl0d9dhrUpT91xhDTTtVh_lVlTE';
  
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
    
    // Count ALL photos recursively in main folder and ALL subfolders
    const allPhotosList = [];
    countAllPhotosRecursive(mainFolder, allPhotosList);
    
    const allPhotosCount = allPhotosList.length;
    const allPhotosCover = allPhotosList.length > 0 ? allPhotosList[0].getId() : null;
    
    // Sort by creation date (newest first)
    albums.sort((a, b) => new Date(b.createdDate) - new Date(a.createdDate));
    
    var output = ContentService.createTextOutput(JSON.stringify({ 
      albums: albums, 
      allPhotosCount: allPhotosCount,
      allPhotosCover: allPhotosCover,
      mainFolderId: photosFolderId,
      success: true 
    }));
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

// Helper function to count photos recursively
function countAllPhotosRecursive(folder, photoList) {
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    if (file.getName().startsWith('.')) continue;
    if (file.getMimeType().startsWith('image/')) {
      photoList.push(file);
    }
  }
  
  const subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    const subfolder = subfolders.next();
    if (subfolder.getName().startsWith('.')) continue;
    countAllPhotosRecursive(subfolder, photoList);
  }
}

function getAlbumPhotos(folderId) {
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
    
    var output = ContentService.createTextOutput(JSON.stringify({ 
      photos: photoList, 
      albumName: folder.getName(),
      success: true 
    }));
    output.setMimeType(ContentService.MimeType.JSON);
    return output;
      
  } catch (error) {
    var output = ContentService.createTextOutput(JSON.stringify({ error: error.toString(), success: false }));
    output.setMimeType(ContentService.MimeType.JSON);
    return output;
  }
}

function getAllPhotosRecursive(folder, photoList) {
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    if (file.getName().startsWith('.')) continue;
    if (file.getMimeType().startsWith('image/')) {
      photoList.push(file);
    }
  }
  
  const subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    const subfolder = subfolders.next();
    if (subfolder.getName().startsWith('.')) continue;
    getAllPhotosRecursive(subfolder, photoList);
  }
}

function getAllPhotos() {
  const photosFolderId = '1eW5s-bl0d9dhrUpT91xhDTTtVh_lVlTE';
  
  try {
    const mainFolder = DriveApp.getFolderById(photosFolderId);
    const allPhotos = [];
    
    getAllPhotosRecursive(mainFolder, allPhotos);
    
    const photoList = [];
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
        downloadUrl: `https://drive.google.com/uc?export=download&id=${fileId}`,
        lastModified: file.getLastUpdated().toISOString()
      });
    });
    
    photoList.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
    
    var output = ContentService.createTextOutput(JSON.stringify({ 
      photos: photoList, 
      albumName: 'All Photos',
      success: true 
    }));
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