// background.js
const BASE_AZ_URL = "https://kabinet.unec.edu.az/az/";
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';

let creatingOffscreenPromise = null;

// --- Offscreen Document Management ---
async function hasOffscreenDocument() {
    const contexts = await chrome.runtime.getContexts({
        contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
        documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
    });
    return contexts.length > 0;
}

async function setupOffscreenDocument() {
    console.log("BG: Checking for offscreen document...");
    if (await hasOffscreenDocument()) {
        console.log("BG: Offscreen document already exists.");
        return true; // Indicate success or existence
    }

    if (creatingOffscreenPromise) {
        console.log("BG: Offscreen document creation is already in progress. Waiting...");
        return creatingOffscreenPromise; // Wait for the existing promise
    }

    console.log("BG: Creating offscreen document...");
    creatingOffscreenPromise = chrome.offscreen.createDocument({
        url: OFFSCREEN_DOCUMENT_PATH,
        reasons: [chrome.offscreen.Reason.DOM_PARSER],
        justification: 'Parse HTML content because DOMParser is not reliably available in Service Worker.',
    }).then(() => {
        console.log("BG: Offscreen document created successfully.");
        return true;
    }).catch(error => {
        console.error("BG: Error creating offscreen document:", error);
        if (error.message.includes("Only a single offscreen document may be created")) {
            console.warn("BG: Race condition likely, assuming document exists or will exist.");
            return true; // Still resolve true, assuming it's usable or will be
        }
        return false; // Indicate failure
    }).finally(() => {
        creatingOffscreenPromise = null;
    });
    return creatingOffscreenPromise;
}

// --- HTML Parsing via Offscreen Document ---
async function parseHTMLViaOffscreen(htmlString, task) {
    const setupSuccess = await setupOffscreenDocument();
    if (!setupSuccess && !(await hasOffscreenDocument())) { // Double check if setup truly failed
        console.error("BG: Offscreen document is not available or could not be created. Cannot parse.");
        throw new Error("Offscreen document unavailable for parsing.");
    }

    return new Promise((resolve, reject) => {
        const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        let listener;

        const timeoutId = setTimeout(() => {
            chrome.runtime.onMessage.removeListener(listener);
            console.error(`BG: Timeout waiting for response from offscreen for task "${task}", Req ID: ${requestId}`);
            reject(new Error(`Timeout waiting for offscreen document response for task: ${task}`));
        }, 10000); // 10-second timeout

        listener = (message) => {
            if (message.action === 'parseHTMLResult' && message.originalRequestId === requestId && message.source === 'offscreen_document') {
                clearTimeout(timeoutId);
                chrome.runtime.onMessage.removeListener(listener);
                if (message.success) {
                    console.log(`BG: Received parsing result for task "${task}" from offscreen:`, message.data);
                    resolve(message.data);
                } else {
                    console.error(`BG: Error result for task "${task}" from offscreen:`, message.error);
                    reject(new Error(message.error || `Unknown error during offscreen parsing for task: ${task}`));
                }
            }
        };
        chrome.runtime.onMessage.addListener(listener);

        console.log(`BG: Sending HTML to offscreen for task "${task}", Req ID: ${requestId}`);
        chrome.runtime.sendMessage({
            target: 'offscreen_document', // Ensure target matches what offscreen.js expects
            action: 'parseHTMLTask',
            htmlString: htmlString,
            task: task,
            originalRequestId: requestId
        }).catch(err => {
            clearTimeout(timeoutId);
            chrome.runtime.onMessage.removeListener(listener);
            console.error("BG: Error sending message to offscreen document:", err);
            reject(new Error(`Failed to send message to offscreen document: ${err.message}`));
        });
    });
}


// --- Core Logic Functions (using offscreen parsing) ---
async function getStudentEvaluationPageUrlFromHTML(pageHtml) {
    console.log("BG: Requesting offscreen to parse for evaluation link href.");
    const href = await parseHTMLViaOffscreen(pageHtml, 'extractEvaluationLinkHref');
    if (!href || typeof href !== 'string') {
        throw new Error("BG: Did not receive a valid href for evaluation link from offscreen.");
    }
    return new URL(href, BASE_AZ_URL).href;
}

async function extractAcademicYearsFromHTML(pageHtml) {
    console.log("BG: Requesting offscreen to parse for academic years.");
    const years = await parseHTMLViaOffscreen(pageHtml, 'extractYears');
    if (!Array.isArray(years)) {
        console.warn("BG: Expected an array of years from offscreen, received:", years);
        throw new Error("Invalid data format for years received from offscreen document.");
    }
    return years;
}


// --- Message Listener ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "fetchAcademicYearsViaOffscreen") {
        (async () => {
            console.log("BG: Received fetchAcademicYearsViaOffscreen. Tab ID:", request.tabId);
            try {
                const tabId = request.tabId;
                const tab = await chrome.tabs.get(tabId);
                if (!tab || !tab.url) {
                    throw new Error("BG: Could not get tab information or tab URL.");
                }

                let studentEvaluationActualUrl;
                let htmlToParseForYears;

                const noteAndAnnounceUrlPattern = new URL('noteandannounce', BASE_AZ_URL).href;
                const studentEvalDirectUrlPattern = new URL('studentEvaluation', BASE_AZ_URL).href;

                if (tab.url.startsWith(noteAndAnnounceUrlPattern)) {
                    console.log("BG: On noteandannounce. Fetching its content to find link...");
                    const notePageResponse = await fetch(tab.url);
                    if (!notePageResponse.ok) throw new Error(`Failed to fetch ${tab.url}: ${notePageResponse.statusText}`);
                    const notePageHtml = await notePageResponse.text();
                    studentEvaluationActualUrl = await getStudentEvaluationPageUrlFromHTML(notePageHtml);
                    console.log("BG: Determined Student Evaluation URL:", studentEvaluationActualUrl);

                    console.log("BG: Fetching Student Evaluation page content...");
                    const evalPageResponse = await fetch(studentEvaluationActualUrl);
                    if (!evalPageResponse.ok) throw new Error(`Failed to fetch ${studentEvaluationActualUrl}: ${evalPageResponse.statusText}`);
                    htmlToParseForYears = await evalPageResponse.text();

                } else if (tab.url.startsWith(studentEvalDirectUrlPattern)) {
                    console.log("BG: On studentEvaluation page. Fetching its content directly.");
                    studentEvaluationActualUrl = tab.url.split('?')[0]; // Base URL
                    const evalPageResponse = await fetch(studentEvaluationActualUrl); // Fetch current page content
                    if (!evalPageResponse.ok) throw new Error(`Failed to fetch ${studentEvaluationActualUrl}: ${evalPageResponse.statusText}`);
                    htmlToParseForYears = await evalPageResponse.text();
                } else {
                    console.warn("BG: Not on a recognized page. Defaulting to fetching studentEvaluation page URL.");
                    studentEvaluationActualUrl = new URL('studentEvaluation', BASE_AZ_URL).href;
                    const evalPageResponse = await fetch(studentEvaluationActualUrl);
                    if (!evalPageResponse.ok) throw new Error(`Failed to fetch ${studentEvaluationActualUrl}: ${evalPageResponse.statusText}`);
                    htmlToParseForYears = await evalPageResponse.text();
                }

                const years = await extractAcademicYearsFromHTML(htmlToParseForYears);
                sendResponse({ years: years });

            } catch (error) {
                console.error("BG: Error in fetchAcademicYearsViaOffscreen handler:", error.message, error.stack ? error.stack.split('\n').slice(0, 5).join('\n') : '');
                sendResponse({ error: `BG Error: ${error.message}` });
            }
        })();
        return true; // Indicates asynchronous response
    }
    // Note: No explicit closing of offscreen document here.
    // It will close if the service worker becomes inactive for a while,
    // or you can implement manual closing logic if needed (e.g., after a period of inactivity).
});

// Attempt initial setup of the offscreen document when the service worker starts.
// This is optional; it can also be set up on demand when first needed.
setupOffscreenDocument().catch(err => console.warn("BG: Initial offscreen setup failed (might be okay, will retry on demand).", err));

console.log("BG: UNEC Cabinet Offscreen Years background script loaded.");