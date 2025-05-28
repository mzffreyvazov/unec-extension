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
    
    if (request.action === "checkLoginStatus") {
        // Check if user is logged in by looking for login indicators
        const isLoggedIn = !window.location.href.includes('/login') && 
                          (document.querySelector('.user-info') || 
                           document.querySelector('.sidebar-menu') ||
                           document.querySelector('#user-menu'));
        
        sendResponse({ 
            success: true, 
            isLoggedIn: isLoggedIn,
            currentUrl: window.location.href
        });
        return true;
    }
});
