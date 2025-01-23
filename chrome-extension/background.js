// Store media URLs per tab
const tabMediaUrls = new Map();
const downloadQueue = new Map();
const MAX_CONCURRENT_DOWNLOADS = 3;

// Add a cache for file sizes
const fileSizeCache = new Map();
const FILE_SIZE_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

// Add retry configuration
const FETCH_RETRY_COUNT = 3;
const FETCH_RETRY_DELAY = 1000; // 1 second
const FETCH_TIMEOUT = 30000; // 30 seconds

// Add server status tracking
let isServerOnline = false;

// Change this line at the top of the file
const SERVER_URL = 'your-railway-url'; // Get this from Railway dashboard

// Initialize download queue processor
function processDownloadQueue() {
    if (downloadQueue.size === 0) return;

    const activeDownloads = Array.from(downloadQueue.values()).filter(item => item.status === 'downloading');
    if (activeDownloads.length >= MAX_CONCURRENT_DOWNLOADS) return;

    // Find next pending download
    for (const [downloadId, downloadItem] of downloadQueue) {
        if (downloadItem.status === 'pending') {
            startDownload(downloadId, downloadItem);
            break;
        }
    }
}

function startDownload(downloadId, downloadItem) {
    downloadItem.status = 'downloading';
    
    if (downloadItem.isYouTube) {
        handleYouTubeDownload(downloadId, downloadItem);
    } else {
        handleDirectDownload(downloadId, downloadItem);
    }
}

// Add a helper function for retrying fetches
async function fetchWithRetry(url, options, retries = FETCH_RETRY_COUNT) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
        
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`Server responded with ${response.status}`);
        }
        
        return response;
    } catch (error) {
        if (retries > 0) {
            console.log(`Retrying fetch... (${FETCH_RETRY_COUNT - retries + 1}/${FETCH_RETRY_COUNT})`);
            await new Promise(resolve => setTimeout(resolve, FETCH_RETRY_DELAY));
            return fetchWithRetry(url, options, retries - 1);
        }
        throw error;
    }
}

// Function to check server status with timeout
async function checkServerStatus() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const response = await fetch(`${SERVER_URL}/status`, {
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        const newStatus = response.ok;
        
        // Only notify if status changed
        if (newStatus !== isServerOnline) {
            isServerOnline = newStatus;
            // Notify all listeners of status change
            chrome.runtime.sendMessage({
                type: 'SERVER_STATUS_CHANGED',
                isOnline: isServerOnline
            }).catch(() => {
                // Ignore errors when no listeners
            });
        }
        
        return isServerOnline;
    } catch (error) {
        if (isServerOnline) {
            isServerOnline = false;
            chrome.runtime.sendMessage({
                type: 'SERVER_STATUS_CHANGED',
                isOnline: false
            }).catch(() => {});
        }
        console.error('Server status check failed:', error);
        return false;
    }
}

// Add error handling helper
function handleServerError(error, downloadId, downloadItem) {
    let errorMessage = 'Download failed: ';
    
    if (!isServerOnline) {
        errorMessage += 'Server is offline. Please make sure the download server is running.';
    } else if (error.name === 'AbortError') {
        errorMessage += 'Request timed out. Please try again.';
    } else if (error.message.includes('Failed to fetch')) {
        errorMessage += 'Could not connect to server. Please check if the server is running.';
    } else {
        errorMessage += error.message;
    }

    downloadItem.status = 'error';
    downloadItem.error = errorMessage;
    
    notifyDownloadProgress(downloadId, { 
        status: 'error', 
        error: errorMessage
    });
    
    // Show error notification
    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon.png',
        title: 'Download Error',
        message: errorMessage
    });
}

function handleYouTubeDownload(downloadId, downloadItem) {
    if (!isServerOnline) {
        handleServerError(new Error('Server is offline'), downloadId, downloadItem);
        return;
    }

    // Better YouTube URL validation
    try {
        const urlObj = new URL(downloadItem.url);
        const isValidYouTube = (
            (urlObj.hostname.includes('youtube.com') && urlObj.pathname === '/watch' && urlObj.searchParams.has('v')) ||
            (urlObj.hostname.includes('youtu.be') && urlObj.pathname.length > 1)
        );
        
        if (!isValidYouTube) {
            throw new Error('Invalid YouTube URL');
        }
    } catch (error) {
        handleServerError(error, downloadId, downloadItem);
        return;
    }

    fetchWithRetry(`${SERVER_URL}/download`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            url: downloadItem.url,
            isYouTube: true,
            filename: downloadItem.filename,
            userId: downloadItem.userId
        })
    })
    .then(async response => {
        // Get the filename from the Content-Disposition header
        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = downloadItem.filename;
        if (contentDisposition) {
            const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(contentDisposition);
            if (matches != null && matches[1]) {
                filename = matches[1].replace(/['"]/g, '');
            }
        }

        // Ensure filename has .mp4 extension for YouTube videos
        if (!filename.toLowerCase().endsWith('.mp4')) {
            filename += '.mp4';
        }

        // Clean filename of invalid characters
        filename = filename.replace(/[/\\?%*:|"<>]/g, '-');

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        
        return new Promise((resolve, reject) => {
            chrome.downloads.download({
                url: url,
                filename: filename,
                saveAs: false,
                conflictAction: 'uniquify'
            }, (chromeDownloadId) => {
                if (chrome.runtime.lastError) {
                    window.URL.revokeObjectURL(url);
                    reject(chrome.runtime.lastError);
                } else {
                    downloadItem.chromeDownloadId = chromeDownloadId;
                    downloadItem.filename = filename;
                    window.URL.revokeObjectURL(url);
                    resolve(chromeDownloadId);
                }
            });
        });
    })
    .then(chromeDownloadId => {
        notifyDownloadProgress(downloadId, { 
            status: 'started', 
            chromeDownloadId,
            filename: downloadItem.filename
        });
    })
    .catch(error => {
        handleServerError(error, downloadId, downloadItem);
        processDownloadQueue();
    });
}

function handleDirectDownload(downloadId, downloadItem) {
    const filename = downloadItem.filename || 'download';
    
    chrome.downloads.download({
        url: downloadItem.url,
        filename: filename,
        saveAs: false,
        conflictAction: 'uniquify'
    }, (chromeDownloadId) => {
        if (chrome.runtime.lastError) {
            downloadItem.status = 'error';
            downloadItem.error = chrome.runtime.lastError.message;
            notifyDownloadProgress(downloadId, { 
                status: 'error', 
                error: chrome.runtime.lastError.message 
            });
        } else {
            downloadItem.chromeDownloadId = chromeDownloadId;
            notifyDownloadProgress(downloadId, { 
                status: 'started', 
                chromeDownloadId 
            });
        }
        processDownloadQueue();
    });
}

function notifyDownloadProgress(downloadId, progress) {
    chrome.runtime.sendMessage({
        type: 'DOWNLOAD_PROGRESS',
        downloadId,
        progress
    });
}

// Handle tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading') {
        // Clear media for this tab only
        tabMediaUrls.set(tabId, new Set());
    }
});

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
    tabMediaUrls.delete(tabId);
});

// Function to check if a URL is a media URL
function isMediaUrl(url) {
    try {
        const urlObj = new URL(url);
        
        // Better YouTube URL detection
        if (urlObj.hostname.includes('youtube.com')) {
            // Only match actual video URLs
            return urlObj.pathname === '/watch' && urlObj.searchParams.has('v');
        }
        if (urlObj.hostname.includes('youtu.be')) {
            // Short YouTube URLs
            return urlObj.pathname.length > 1; // Has video ID
        }

        // Ignore common ad and tracking domains
        const blockedDomains = [
            'ads', 'ad.', 'analytics', 'tracker', 'pixel',
            'doubleclick', 'google-analytics', 'facebook'
        ];
        
        if (blockedDomains.some(domain => urlObj.hostname.includes(domain))) {
            return false;
        }

        // Check for common video/media patterns
        const mediaPatterns = [
            '/video/', '/media/', '/stream/', '/watch/', '/embed/',
            '.mp4', '.m3u8', '.ts', '.m4v', '.mkv', '.webm', '.mov', '.avi',
            '.jpg', '.jpeg', '.png', '.gif', '.webp'
        ];

        return mediaPatterns.some(pattern => url.toLowerCase().includes(pattern));
    } catch (e) {
        return false;
    }
}

// Function to get all media from all tabs
function getAllMedia() {
    const allMedia = [];
    for (const mediaSet of tabMediaUrls.values()) {
        const mediaArray = Array.from(mediaSet).map(item => JSON.parse(item));
        allMedia.push(...mediaArray);
    }
    return allMedia;
}

// Update getFileSize function
async function getFileSize(url, isYouTube) {
    const cacheKey = `${url}_${isYouTube}`;
    const cachedSize = fileSizeCache.get(cacheKey);
    
    if (cachedSize && (Date.now() - cachedSize.timestamp < FILE_SIZE_CACHE_DURATION)) {
        return cachedSize.size;
    }

    if (!isServerOnline) {
        console.warn('Server is offline, cannot fetch file size');
        return null;
    }

    try {
        const response = await fetchWithRetry(`${SERVER_URL}/get-file-size`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ url, isYouTube })
        });
        
        const data = await response.json();
        if (data.error) {
            throw new Error(data.error);
        }
        
        if (data.size) {
            fileSizeCache.set(cacheKey, {
                size: data.size,
                timestamp: Date.now()
            });
            return data.size;
        }
    } catch (error) {
        console.error('Error fetching file size:', error);
        return null;
    }
}

// Clean up cache periodically
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of fileSizeCache) {
        if (now - value.timestamp > FILE_SIZE_CACHE_DURATION) {
            fileSizeCache.delete(key);
        }
    }
}, 300000); // Clean every 5 minutes

// Message handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const tabId = sender.tab?.id;

    switch (message.type) {
        case 'CLEAR_ALL_MEDIA':
            tabMediaUrls.clear();
            sendResponse({ success: true });
            break;

        case 'NEW_MEDIA':
            if (message.videoInfo) {
                const mediaInfo = {
                    ...message.videoInfo,
                    tabId: tabId || 'popup',
                    timestamp: Date.now()
                };
                if (tabId) {
                    addMediaInfo(tabId, mediaInfo);
                }
                sendResponse({ success: true });
            }
            break;

        case 'GET_MEDIA':
            sendResponse(getAllMedia());
            break;

        case 'CLEAR_TAB_MEDIA':
            if (tabId) {
                tabMediaUrls.set(tabId, new Set());
                sendResponse({ success: true });
            }
            break;

        case 'DOWNLOAD':
            const downloadId = Date.now().toString();
            downloadQueue.set(downloadId, {
                url: message.url,
                filename: message.filename,
                isYouTube: message.url.includes('youtube.com') || message.url.includes('youtu.be'),
                status: 'pending',
                timestamp: Date.now(),
                userId: message.userId || 'default'
            });
            
            processDownloadQueue();
            sendResponse({ downloadId });
            return true;

        case 'GET_FILE_SIZE':
            getFileSize(message.url, message.isYouTube)
                .then(size => sendResponse({ size }));
            return true; // Keep channel open for async response

        case 'CHECK_SERVER_STATUS':
            // Return current status immediately and check in background
            sendResponse({ isOnline: isServerOnline });
            checkServerStatus(); // This will update if changed
            break;
    }
});

// Web request listener for media detection
chrome.webRequest.onBeforeRequest.addListener(
    function(details) {
        if (details.tabId === -1) return; // Ignore non-tab requests
        
        const url = details.url;
        if (isMediaUrl(url)) {
            chrome.tabs.get(details.tabId, function(tab) {
                if (chrome.runtime.lastError || !tab) return;

                const mediaInfo = {
                    url: url,
                    title: tab.title || 'Untitled',
                    tabId: details.tabId,
                    timestamp: Date.now(),
                    type: url.includes('youtube.com') || url.includes('youtu.be') ? 'youtube' : 'direct'
                };

                addMediaInfo(details.tabId, mediaInfo);
            });
        }
    },
    { urls: ["<all_urls>"] },
    ["requestBody"]
);

// Function to add media info and handle duplicates
function addMediaInfo(tabId, mediaInfo) {
    const mediaSet = tabMediaUrls.get(tabId) || new Set();
    
    // Skip manifest files and other non-media URLs
    if (mediaInfo.url.includes('manifest.webmanifest')) return;
    
    // Check if we already have this URL from any tab
    const isDuplicate = Array.from(tabMediaUrls.values()).some(set => 
        Array.from(set).some(item => {
            const parsed = JSON.parse(item);
            return parsed.url === mediaInfo.url;
        })
    );

    if (!isDuplicate) {
        mediaSet.add(JSON.stringify(mediaInfo));
        tabMediaUrls.set(tabId, mediaSet);
        
        // Notify popup of new media
        chrome.runtime.sendMessage({
            type: 'NEW_MEDIA_DETECTED',
            mediaInfo: mediaInfo
        }).catch(() => {
            // Ignore errors when popup is not open
        });
    }
}

// Monitor download progress
chrome.downloads.onChanged.addListener((delta) => {
    for (const [downloadId, downloadItem] of downloadQueue) {
        if (downloadItem.chromeDownloadId === delta.id) {
            if (delta.state) {
                switch (delta.state.current) {
                    case 'complete':
                        downloadItem.status = 'complete';
                        notifyDownloadProgress(downloadId, { 
                            status: 'complete',
                            filename: downloadItem.filename,
                            success: true
                        });
                        // Show notification
                        chrome.notifications.create({
                            type: 'basic',
                            iconUrl: 'icon.png',
                            title: 'Download Complete',
                            message: `Successfully downloaded: ${downloadItem.filename}`
                        });
                        downloadQueue.delete(downloadId);
                        processDownloadQueue();
                        break;
                        
                    case 'interrupted':
                        downloadItem.status = 'error';
                        notifyDownloadProgress(downloadId, { 
                            status: 'error', 
                            error: 'Download interrupted',
                            filename: downloadItem.filename
                        });
                        downloadQueue.delete(downloadId);
                        processDownloadQueue();
                        break;
                }
            }
            
            if (delta.bytesReceived && delta.totalBytes) {
                notifyDownloadProgress(downloadId, {
                    status: 'progress',
                    received: delta.bytesReceived.current,
                    total: delta.totalBytes.current,
                    filename: downloadItem.filename
                });
            }
        }
    }
});

// Cleanup old downloads periodically
setInterval(() => {
    const oneHourAgo = Date.now() - 3600000;
    for (const [downloadId, downloadItem] of downloadQueue) {
        if (downloadItem.timestamp < oneHourAgo) {
            downloadQueue.delete(downloadId);
        }
    }
}, 300000); // Run every 5 minutes

// Handle tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        if (tab.url.startsWith('http')) {
            chrome.tabs.sendMessage(tabId, { type: 'TAB_UPDATED' }).catch(() => {
                // Ignore errors from tabs that don't have our content script
                console.log('Could not send message to tab', tabId);
            });
        }
    }
});

// Initialize server status check
checkServerStatus();

// Add periodic server status check
setInterval(checkServerStatus, 30000); // Check every 30 seconds 