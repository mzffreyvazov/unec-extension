// background.js
console.log("BG: Script loaded (POST for Semesters Version).");

const BASE_AZ_URL = "https://kabinet.unec.edu.az/az/";
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
let creatingOffscreenPromise = null;

// --- Offscreen Document Management & parseHTMLViaOffscreen (Keep same as before) ---
async function hasOffscreenDocument() { /* ... same ... */
    const contexts = await chrome.runtime.getContexts({contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]});
    return contexts.length > 0;
}
async function setupOffscreenDocument() { /* ... same ... */
    if (await hasOffscreenDocument()) return true;
    if (creatingOffscreenPromise) return creatingOffscreenPromise;
    creatingOffscreenPromise = chrome.offscreen.createDocument({ url: OFFSCREEN_DOCUMENT_PATH,reasons: [chrome.offscreen.Reason.DOM_PARSER], justification: 'Parse HTML.'})
    .then(() => true).catch(err => { if (err.message.includes("single offscreen document")) return true; console.error("BG: Err create offscreen:", err); return false;})
    .finally(() => { creatingOffscreenPromise = null; });
    return creatingOffscreenPromise;
}
async function parseHTMLViaOffscreen(htmlString, task) { /* ... same, ensure logging is good ... */
    const setupSuccess = await setupOffscreenDocument();
    if (!setupSuccess && !(await hasOffscreenDocument())) throw new Error("Offscreen doc unavailable.");
    return new Promise((resolve, reject) => {
        const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(2,7)}`;
        let listener;
        const timeoutId = setTimeout(() => { chrome.runtime.onMessage.removeListener(listener); reject(new Error(`Timeout (10s) for offscreen task: ${task}`)); }, 10000);
        listener = (msg) => { if (msg.action==='parseHTMLResult' && msg.originalRequestId===requestId && msg.source==='offscreen_document'){ clearTimeout(timeoutId); chrome.runtime.onMessage.removeListener(listener); if(msg.success) resolve(msg.data); else reject(new Error(msg.error||`Offscreen task ${task} failed`));}};
        chrome.runtime.onMessage.addListener(listener);
        if (!htmlString || typeof htmlString !== 'string' || htmlString.trim() === "") return reject(new Error(`Invalid HTML for task: ${task}`));
        chrome.runtime.sendMessage({target:'offscreen_document', action:'parseHTMLTask', htmlString, task, originalRequestId:requestId})
        .catch(err => {clearTimeout(timeoutId); chrome.runtime.onMessage.removeListener(listener); reject(new Error(`BG: Send to offscreen failed: ${err.message}`));});
    });
}

// --- Core Logic Functions (using offscreen parsing) ---
async function getStudentEvalUrlFromNotePageHTML(pageHtml) {
    if (!pageHtml) throw new Error("BG: HTML for note/announce page is empty.");
    const href = await parseHTMLViaOffscreen(pageHtml, 'extractEvaluationLinkHref');
    if (!href || typeof href !== 'string') throw new Error("BG: Invalid href for eval link from offscreen.");
    return new URL(href, BASE_AZ_URL).href;
}

async function extractYearsFromEvalPageHTML(pageHtml) {
    if (!pageHtml) throw new Error("BG: HTML for year extraction is empty.");
    const years = await parseHTMLViaOffscreen(pageHtml, 'extractYears');
    if (!Array.isArray(years)) throw new Error("BG: Invalid data for years from offscreen.");
    return years;
}

// ***** NEW FUNCTION TO FETCH SEMESTERS VIA POST *****
async function fetchSemestersForYearPOST(yearId, csrfToken) { // Added csrfToken parameter
    const semesterUrl = new URL('getEduSemester', BASE_AZ_URL).href;
    console.log(`BG: Fetching semesters via POST from: ${semesterUrl} for year ID: ${yearId}`);

    const formData = new URLSearchParams();
    formData.append('type', 'eduYear');
    formData.append('id', yearId);

    // Add CSRF token if available and needed
    // The website's own POST request might include a YII_CSRF_TOKEN or similar.
    // We need to find out how to get this token. For now, we'll try without.
    // if (csrfToken) {
    //     formData.append('YII_CSRF_TOKEN', csrfToken); // Or whatever the token name is
    // }

    const requestOptions = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest' // Often required by Yii
        },
        body: formData.toString()
    };

    const response = await fetch(semesterUrl, requestOptions);
    if (!response.ok) {
        const errorText = await response.text();
        console.error(`BG: Failed to fetch semesters via POST. Status: ${response.status}. Body: ${errorText.substring(0,500)}`);
        throw new Error(`Failed to fetch semesters: ${response.status} ${response.statusText}`);
    }
    const semesterHtmlResponse = await response.text(); // This is likely the <option>...</option> HTML
    if (!semesterHtmlResponse) throw new Error("Empty response from getEduSemester POST request.");
    console.log("BG: Raw HTML response from getEduSemester POST:", semesterHtmlResponse.substring(0, 500) + "...");

    // Now parse this HTML snippet (which should be just options)
    const semesters = await parseHTMLViaOffscreen(semesterHtmlResponse, 'extractSemesters');
    if (!Array.isArray(semesters)) throw new Error("BG: Semesters from POST not parsed into an array.");
    return semesters;
}


async function extractSubjectsFromEvalPageHTML(pageHtml) { // New function for clarity
    console.log("BG: extractSubjectsFromEvalPageHTML called.");
    if (!pageHtml) throw new Error("BG: HTML for subject extraction is empty.");
    const subjects = await parseHTMLViaOffscreen(pageHtml, 'extractSubjects');
    if (!Array.isArray(subjects)) throw new Error("BG: Invalid data for subjects from offscreen.");
    return subjects;
}


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "fetchYearsAndSemesters") {
        (async () => {
            console.log("BG: 'fetchYearsAndSemesters' action started. Tab ID:", request.tabId);
            let studentEvaluationPageUrl; // Base URL for studentEvaluation
            let initialHtmlForYears;
            // We no longer fetch a full page for semesters, but use a POST request
            // let htmlWithSemesters;
            let selectedYear = null;
            let allYears = [];
            let semestersForSelectedYear = [];
            // Placeholder for CSRF token - we need to figure out how to get this
            let csrfToken = null;

            try {
                if (!request.tabId) throw new Error("Tab ID missing.");
                const currentTab = await chrome.tabs.get(request.tabId);
                if (!currentTab || !currentTab.url) throw new Error("Could not get current tab info.");

                const noteAndAnnounceUrl = new URL('noteandannounce', BASE_AZ_URL).href;
                const studentEvalDirectUrl = new URL('studentEvaluation', BASE_AZ_URL).href;

                // 1. Determine Student Evaluation Base URL & Get Initial HTML (for years and potentially CSRF)
                if (currentTab.url.startsWith(noteAndAnnounceUrl)) {
                    const noteResponse = await fetch(currentTab.url);
                    if (!noteResponse.ok) throw new Error(`Fetch failed for ${currentTab.url}`);
                    const noteHtml = await noteResponse.text();
                    studentEvaluationPageUrl = await getStudentEvalUrlFromNotePageHTML(noteHtml);
                    const initialEvalResponse = await fetch(studentEvaluationPageUrl);
                    if (!initialEvalResponse.ok) throw new Error(`Fetch failed for ${studentEvaluationPageUrl}`);
                    initialHtmlForYears = await initialEvalResponse.text();
                } else if (currentTab.url.startsWith(studentEvalDirectUrl)) {
                    studentEvaluationPageUrl = currentTab.url.split('?')[0];
                    const initialEvalResponse = await fetch(studentEvaluationPageUrl);
                    if (!initialEvalResponse.ok) throw new Error(`Fetch failed for ${studentEvaluationPageUrl}`);
                    initialHtmlForYears = await initialEvalResponse.text();
                } else {
                    studentEvaluationPageUrl = new URL('studentEvaluation', BASE_AZ_URL).href;
                    const initialEvalResponse = await fetch(studentEvaluationPageUrl);
                    if (!initialEvalResponse.ok) throw new Error(`Fetch failed for default ${studentEvaluationPageUrl}`);
                    initialHtmlForYears = await initialEvalResponse.text();
                }
                if (!initialHtmlForYears) throw new Error("HTML for year parsing is empty.");
                console.log("BG: Student Evaluation URL for operations:", studentEvaluationPageUrl);

                // TODO: Extract CSRF token from initialHtmlForYears if present and needed for POST
                // For now, csrfToken remains null. If POST fails, this is the first place to look.
                // Example: const docForCsrf = await parseHTMLViaOffscreen(initialHtmlForYears, 'extractCsrf');
                // (Need to define 'extractCsrf' task in offscreen.js)

                // 2. Extract Academic Years
                allYears = await extractYearsFromEvalPageHTML(initialHtmlForYears);
                if (!allYears || allYears.length === 0) throw new Error("No academic years extracted.");
                selectedYear = allYears[0]; // Select the latest year
                console.log(`BG: Latest year selected: ${selectedYear.text} (ID: ${selectedYear.value})`);

                // 3. Fetch Semesters for the selected year using the NEW POST request method
                semestersForSelectedYear = await fetchSemestersForYearPOST(selectedYear.value, csrfToken);
                console.log(`BG: Semesters via POST for ${selectedYear.text}:`, semestersForSelectedYear.length);
                if (semestersForSelectedYear.length === 0) {
                    console.warn(`BG: No semesters found via POST for year ${selectedYear.text}. The response from /getEduSemester might have been empty or unparseable.`);
                }

                sendResponse({ data: { selectedYear, semesters: semestersForSelectedYear, allYears } });

            } catch (error) {
                console.error("BG: Error in 'fetchYearsAndSemesters':", error.message, error.stack ? error.stack.split('\n').slice(0,3).join('\n') : '');
                sendResponse({ error: `BG Error: ${error.message}` });
            }
        })();
        return true;
    }
});

setupOffscreenDocument().catch(err => console.warn("BG: Initial offscreen setup failed.", err));
console.log("BG: Background script (POST for Semesters) fully loaded.");