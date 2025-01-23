// This file can be empty for now
// It will be used for future content script functionality 

// Wrap everything in a try-catch with auto-reconnect functionality
(function initializeExtension() {
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 3;
    const RECONNECT_DELAY = 2000; // 2 seconds
    const SCAN_INTERVAL = 5000; // 5 seconds between scans

    function initialize() {
        try {
            let isConnected = true;
            let observer = null;
            let scanInterval = null;
            let lastScanTime = 0;
            const videoElements = new Set();
            const mediaUrls = new Set();

            // Function to safely send messages with retry
            async function sendMessageToBackground(message, retryCount = 0) {
                if (!isConnected || retryCount >= 3) return;
                
                try {
                    return await chrome.runtime.sendMessage(message);
                } catch (error) {
                    if (error.message.includes('Extension context invalidated')) {
                        isConnected = false;
                        cleanupAndReconnect();
                    } else if (retryCount < 2) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        return sendMessageToBackground(message, retryCount + 1);
                    }
                    console.error('Message sending error:', error);
                }
            }

            // Function to handle YouTube specifically
            async function handleYouTubeVideo() {
                if (!window.location.hostname.includes('youtube.com')) return;
                
                try {
                    // Only process actual video pages
                    if (window.location.pathname !== '/watch') return;
                    
                    const videoId = new URLSearchParams(window.location.search).get('v');
                    if (!videoId) return;

                    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
                    if (mediaUrls.has(videoUrl)) return; // Skip if already processed

                    // Get metadata from YouTube's page data
                    const videoTitle = document.querySelector('meta[property="og:title"]')?.content
                        || document.querySelector('title')?.textContent?.replace(' - YouTube', '')
                        || 'YouTube Video';
                        
                    const channelName = document.querySelector('link[itemprop="name"]')?.content
                        || document.querySelector('[itemprop="author"] [itemprop="name"]')?.content
                        || '';
                        
                    const thumbnail = document.querySelector('meta[property="og:image"]')?.content || '';
                    
                    mediaUrls.add(videoUrl);
                    await sendMessageToBackground({
                        type: 'NEW_MEDIA',
                        videoInfo: {
                            url: videoUrl,
                            title: videoTitle,
                            isYouTube: true,
                            timestamp: Date.now(),
                            channelName: channelName,
                            thumbnail: thumbnail
                        }
                    });
                } catch (error) {
                    console.error('YouTube handling error:', error);
                }
            }

            // Function to extract media with retry
            async function extractMediaSources(retryCount = 0) {
                if (!isConnected || retryCount >= 3) return;

                try {
                    // Fast YouTube detection
                    if (window.location.hostname.includes('youtube.com')) {
                        await handleYouTubeVideo();
                        return; // Exit early for YouTube pages
                    }

                    // Use more efficient selectors for other media
                    const mediaSelectors = [
                        'video[src]',
                        'video > source[src]',
                        'audio[src]',
                        'audio > source[src]',
                        'a[href*=".mp4"]',
                        'a[href*=".webm"]',
                        'a[href*=".m3u8"]'
                    ].join(',');

                    const mediaElements = document.querySelectorAll(mediaSelectors);
                    if (!mediaElements.length) return;

                    // Process in batches
                    const BATCH_SIZE = 5;
                    for (let i = 0; i < mediaElements.length; i += BATCH_SIZE) {
                        const batch = Array.from(mediaElements).slice(i, i + BATCH_SIZE);
                        await Promise.all(batch.map(async element => {
                            const src = element.src || element.href;
                            if (src && !mediaUrls.has(src) && !src.includes('manifest.webmanifest')) {
                                mediaUrls.add(src);
                                await sendMessageToBackground({
                                    type: 'NEW_MEDIA',
                                    videoInfo: {
                                        url: src,
                                        title: document.title,
                                        timestamp: Date.now(),
                                        isYouTube: false
                                    }
                                });
                            }
                        }));
                    }
                } catch (error) {
                    console.error('Media extraction error:', error);
                    if (retryCount < 2) {
                        setTimeout(() => extractMediaSources(retryCount + 1), 1000);
                    }
                }
            }

            // Cleanup function
            function cleanupAndReconnect() {
                if (observer) {
                    observer.disconnect();
                    observer = null;
                }
                if (scanInterval) {
                    clearInterval(scanInterval);
                    scanInterval = null;
                }
                videoElements.clear();
                mediaUrls.clear();

                if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                    reconnectAttempts++;
                    setTimeout(initialize, RECONNECT_DELAY);
                }
            }

            // Set up mutation observer with throttling
            observer = new MutationObserver(() => {
                if (!isConnected) return;
                
                const now = Date.now();
                if (now - lastScanTime > 1000) { // Throttle to max once per second
                    lastScanTime = now;
                    extractMediaSources();
                }
            });

            // Start observing
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            // Set up periodic scan
            scanInterval = setInterval(() => {
                if (isConnected) {
                    extractMediaSources();
                }
            }, SCAN_INTERVAL);

            // Initial scan
            extractMediaSources();

            // Handle cleanup
            window.addEventListener('unload', () => {
                if (observer) {
                    observer.disconnect();
                }
                if (scanInterval) {
                    clearInterval(scanInterval);
                }
            });

            // Reset reconnect attempts on successful initialization
            reconnectAttempts = 0;

        } catch (error) {
            console.error('Initialization error:', error);
            cleanupAndReconnect();
        }
    }

    // Start the extension
    initialize();
})(); 