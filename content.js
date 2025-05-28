console.log("CONTENT: Content script loaded on", window.location.href);

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("CONTENT: Received message:", request.action);
    
    if (request.action === "fetchFromWebpage") {
        (async () => {
            try {
                const { url, options } = request;
                console.log("CONTENT: Fetching URL:", url);
                
                const response = await fetch(url, options);
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                const html = await response.text();
                console.log("CONTENT: Fetch successful, HTML length:", html.length);
                
                sendResponse({ 
                    success: true, 
                    data: html,
                    status: response.status,
                    statusText: response.statusText
                });
            } catch (error) {
                console.error("CONTENT: Fetch error:", error);
                sendResponse({ 
                    success: false, 
                    error: error.message 
                });
            }
        })();
        return true; // Keep the message channel open for async response
    }
    
    if (request.action === "ping") {
        sendResponse({ success: true, message: "Content script is ready" });
        return true;
    }
});

// Signal that content script is ready
chrome.runtime.sendMessage({ action: "contentScriptReady", url: window.location.href })
    .catch(() => {
        // Ignore errors if background script isn't ready yet
    });
