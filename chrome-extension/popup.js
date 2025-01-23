let downloadLocations = [];
let currentLocation = '';

function getCurrentUserId() {
    // For now, return a default user ID. You can modify this to get actual user identification
    return 'default_user';
    
    // If you want to implement actual user tracking later, you could:
    // 1. Get it from chrome.storage
    // 2. Generate a unique ID per installation
    // 3. Use chrome identity API
    // Example with chrome.storage:
    /*
    chrome.storage.sync.get(['userId'], (result) => {
        if (!result.userId) {
            const newUserId = 'user_' + Date.now();
            chrome.storage.sync.set({ userId: newUserId });
            return newUserId;
        }
        return result.userId;
    });
    */
}

function initializeUserId() {
    chrome.storage.sync.get(['userId'], (result) => {
        if (!result.userId) {
            const newUserId = 'user_' + Date.now();
            chrome.storage.sync.set({ userId: newUserId });
        }
    });
}

document.addEventListener('DOMContentLoaded', function() {
  initializeUserId();
  initializeSettings();
  chrome.runtime.sendMessage({type: 'GET_MEDIA'}, function(mediaInfos) {
    const videoList = document.getElementById('videoList');
    const imageList = document.getElementById('imageList');
    
    const videos = [];
    const images = [];
    
    mediaInfos.forEach(mediaInfo => {
      if (isVideoUrl(mediaInfo.url)) {
        videos.push(mediaInfo);
      } else if (isImageUrl(mediaInfo.url)) {
        images.push(mediaInfo);
      }
    });
    
    if (videos.length > 0) {
      videos.forEach(mediaInfo => {
        videoList.appendChild(createMediaItem(mediaInfo, 'video'));
      });
    } else {
      videoList.innerHTML = '<div class="no-items">No videos detected</div>';
    }
    
    if (images.length > 0) {
      images.forEach(mediaInfo => {
        imageList.appendChild(createMediaItem(mediaInfo, 'image'));
      });
    } else {
      imageList.innerHTML = '<div class="no-items">No images detected</div>';
    }
  });

  // Add clear button handler
  const clearBtn = document.getElementById('clearBtn');
  clearBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear all detected media?')) {
      chrome.runtime.sendMessage({ type: 'CLEAR_ALL_MEDIA' }, () => {
        // Clear the UI
        const videoList = document.getElementById('videoList');
        const imageList = document.getElementById('imageList');
        videoList.innerHTML = '<div class="no-items">No videos detected</div>';
        imageList.innerHTML = '<div class="no-items">No images detected</div>';
      });
    }
  });

  // Add server status check
  chrome.runtime.getBackgroundPage(function(bg) {
    updateServerStatus(bg.isServerOnline);
  });
});

function initializeSettings() {
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsPanel = document.getElementById('settingsPanel');
  const addLocationBtn = document.getElementById('addLocationBtn');

  // Load saved locations
  chrome.storage.sync.get(['downloadLocations', 'currentLocation'], (result) => {
    downloadLocations = result.downloadLocations || [];
    currentLocation = result.currentLocation || '';
    updateLocationsList();
  });

  settingsBtn.addEventListener('click', () => {
    settingsPanel.style.display = settingsPanel.style.display === 'none' ? 'block' : 'none';
  });

  addLocationBtn.addEventListener('click', () => {
    // Create an input element of type "file" 
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true; // Allow directory selection
    input.directory = true;
    
    input.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        // Get the directory path from the first file
        const path = e.target.files[0].webkitRelativePath.split('/')[0];
        if (path && !downloadLocations.includes(path)) {
          downloadLocations.push(path);
          currentLocation = path;
          chrome.storage.sync.set({ downloadLocations, currentLocation });
          updateLocationsList();
        }
      }
    });

    input.click(); // Trigger the file picker
  });

  // Close panel when clicking outside
  document.addEventListener('click', (e) => {
    if (!settingsPanel.contains(e.target) && !settingsBtn.contains(e.target)) {
      settingsPanel.style.display = 'none';
    }
  });
}

function updateLocationsList() {
  const locationList = document.getElementById('locationList');
  locationList.innerHTML = '';

  downloadLocations.forEach(location => {
    const item = document.createElement('div');
    item.className = `location-item ${location === currentLocation ? 'active' : ''}`;
    item.innerHTML = `
      <i class="fas fa-folder"></i>
      <span style="margin-left: 8px;">${location}</span>
    `;
    item.onclick = () => {
      currentLocation = location;
      chrome.storage.sync.set({ currentLocation });
      updateLocationsList();
    };
    locationList.appendChild(item);
  });
}

function formatFileSize(bytes) {
    if (!bytes) return 'Unknown size';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function createMediaItem(mediaInfo, type) {
  const item = document.createElement('div');
  item.className = 'media-item';
  
  const mediaInfoDiv = document.createElement('div');
  mediaInfoDiv.className = 'media-info';
  
  const nameElem = document.createElement('div');
  nameElem.className = 'media-name';
  
  let displayName = '';
  if (mediaInfo.url.includes('youtube.com') || mediaInfo.url.includes('youtu.be')) {
    displayName = mediaInfo.title || 'YouTube Video';
  } else {
    displayName = decodeURIComponent(new URL(mediaInfo.url).pathname.split('/').pop());
  }
  nameElem.textContent = displayName;
  
  const statusBadge = document.createElement('span');
  statusBadge.className = 'status-badge pending';
  statusBadge.textContent = 'Ready';
  nameElem.appendChild(statusBadge);
  
  const progressBar = document.createElement('div');
  progressBar.className = 'download-progress';
  progressBar.innerHTML = `
    <div class="progress-bar"></div>
    <div class="progress-text">0%</div>
  `;
  mediaInfoDiv.appendChild(progressBar);
  
  const sizeElem = document.createElement('div');
  sizeElem.className = 'media-size';
  sizeElem.textContent = 'Fetching size...';
  mediaInfoDiv.appendChild(sizeElem);
  
  mediaInfoDiv.appendChild(nameElem);
  
  const downloadBtn = document.createElement('button');
  downloadBtn.className = 'download-btn';
  downloadBtn.innerHTML = '<i class="fas fa-download"></i> Download';
  
  // Fetch file size using cached data
  chrome.runtime.sendMessage({
    type: 'GET_FILE_SIZE',
    url: mediaInfo.url,
    isYouTube: mediaInfo.url.includes('youtube.com') || mediaInfo.url.includes('youtu.be')
  }, response => {
    if (response && response.size) {
      sizeElem.textContent = formatFileSize(parseInt(response.size));
      if (response.title) {
        displayName = response.title;
        nameElem.textContent = displayName;
      }
    } else {
      sizeElem.textContent = 'Size unavailable';
    }
  });

  downloadBtn.onclick = () => {
    statusBadge.className = 'status-badge downloading';
    statusBadge.textContent = 'Queued';
    downloadBtn.disabled = true;
    downloadBtn.innerHTML = '<i class="fas fa-clock"></i> Queued';

    const bar = progressBar.querySelector('.progress-bar');
    const text = progressBar.querySelector('.progress-text');

    // Clean filename
    const cleanFilename = displayName.replace(/[/\\?%*:|"<>]/g, '-');

    chrome.runtime.sendMessage({
        type: 'DOWNLOAD',
        url: mediaInfo.url,
        filename: cleanFilename,
        mediaType: type,
        userId: getCurrentUserId()
    }, (response) => {
        if (response.error) {
            handleDownloadError(response.error);
            return;
        }

        const downloadId = response.downloadId;
        
        chrome.runtime.onMessage.addListener(function onProgress(msg) {
            if (msg.type === 'DOWNLOAD_PROGRESS' && msg.downloadId === downloadId) {
                switch (msg.progress.status) {
                    case 'started':
                        statusBadge.textContent = 'Downloading';
                        downloadBtn.innerHTML = '<i class="fas fa-spinner loading"></i> Downloading';
                        break;
                        
                    case 'progress':
                        const percent = (msg.progress.received / msg.progress.total * 100).toFixed(1);
                        bar.style.width = `${percent}%`;
                        text.textContent = `${formatFileSize(msg.progress.received)} of ${formatFileSize(msg.progress.total)} (${percent}%)`;
                        break;
                        
                    case 'complete':
                        statusBadge.className = 'status-badge complete';
                        statusBadge.textContent = 'Complete';
                        downloadBtn.innerHTML = '<i class="fas fa-check"></i> Complete';
                        chrome.runtime.onMessage.removeListener(onProgress);
                        break;
                        
                    case 'error':
                        handleDownloadError(msg.progress.error);
                        chrome.runtime.onMessage.removeListener(onProgress);
                        break;
                }
            }
        });
    });
  };

  function handleDownloadError(error) {
    console.error('Download error:', error);
    statusBadge.className = 'status-badge error';
    statusBadge.textContent = 'Error';
    downloadBtn.innerHTML = '<i class="fas fa-exclamation-circle"></i> Error';
    downloadBtn.disabled = false;
  }
  
  item.appendChild(mediaInfoDiv);
  item.appendChild(downloadBtn);
  return item;
}

function isVideoUrl(url) {
  const videoExtensions = ['.mp4', '.m4v', '.mkv', '.webm', '.mov', '.avi', '.wmv'];
  return videoExtensions.some(ext => url.toLowerCase().includes(ext)) ||
         url.includes('youtube.com/watch?v=') ||
         url.includes('youtu.be/');
}

function isImageUrl(url) {
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
  return imageExtensions.some(ext => url.toLowerCase().includes(ext));
}

// Batch process media items
function updateMediaList(mediaInfos) {
    const BATCH_SIZE = 5;
    const videoList = document.getElementById('videoList');
    const imageList = document.getElementById('imageList');
    
    const videos = [];
    const images = [];
    
    mediaInfos.forEach(mediaInfo => {
        if (isVideoUrl(mediaInfo.url)) {
            videos.push(mediaInfo);
        } else if (isImageUrl(mediaInfo.url)) {
            images.push(mediaInfo);
        }
    });

    // Process videos in batches
    for (let i = 0; i < videos.length; i += BATCH_SIZE) {
        const batch = videos.slice(i, i + BATCH_SIZE);
        setTimeout(() => {
            batch.forEach(mediaInfo => {
                videoList.appendChild(createMediaItem(mediaInfo, 'video'));
            });
        }, i * 50); // Stagger updates
    }

    // Process images in batches
    for (let i = 0; i < images.length; i += BATCH_SIZE) {
        const batch = images.slice(i, i + BATCH_SIZE);
        setTimeout(() => {
            batch.forEach(mediaInfo => {
                imageList.appendChild(createMediaItem(mediaInfo, 'image'));
            });
        }, i * 50); // Stagger updates
    }
}

// Add server status indicator
function updateServerStatus(isOnline) {
    const statusIndicator = document.createElement('div');
    statusIndicator.className = `server-status ${isOnline ? 'online' : 'offline'}`;
    statusIndicator.textContent = isOnline ? 'Server Online' : 'Server Offline';
    document.querySelector('.header').appendChild(statusIndicator);
} 