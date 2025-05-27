// background.js
console.log("BG: Script loaded (Subjects Test Version).");

const BASE_AZ_URL = "https://kabinet.unec.edu.az/az/";
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
let creatingOffscreenPromise = null;

// --- Offscreen Document Management & parseHTMLViaOffscreen (Keep same as message #17) ---
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
async function parseHTMLViaOffscreen(htmlString, task) { /* ... same (ensure logging and timeout are robust) ... */
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

// --- Core Logic Functions ---
async function getStudentEvalUrlFromNotePageHTML(pageHtml) { /* ... same ... */
    if (!pageHtml) throw new Error("BG: HTML for note/announce page is empty.");
    const href = await parseHTMLViaOffscreen(pageHtml, 'extractEvaluationLinkHref');
    if (!href || typeof href !== 'string') throw new Error("BG: Invalid href for eval link.");
    return new URL(href, BASE_AZ_URL).href;
}
async function extractYearsFromEvalPageHTML(pageHtml) { /* ... same ... */
    if (!pageHtml) throw new Error("BG: HTML for year extraction is empty.");
    const years = await parseHTMLViaOffscreen(pageHtml, 'extractYears');
    if (!Array.isArray(years)) throw new Error("BG: Invalid data for years.");
    return years;
}
async function fetchSemestersForYearPOST(yearId, csrfToken) { /* ... same from message #17 ... */
    const semesterUrl = new URL('getEduSemester', BASE_AZ_URL).href;
    console.log(`BG: POST to ${semesterUrl} for year ID: ${yearId}`);
    const formData = new URLSearchParams(); formData.append('type', 'eduYear'); formData.append('id', yearId);
    // if (csrfToken) formData.append('YII_CSRF_TOKEN', csrfToken); // TODO: Handle CSRF if needed
    const reqOpts = { method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest'}, body: formData.toString()};
    const response = await fetch(semesterUrl, reqOpts);
    if (!response.ok) throw new Error(`Failed POST to get semesters: ${response.status} ${response.statusText}`);
    const semesterHtmlResp = await response.text();
    if (!semesterHtmlResp) throw new Error("Empty resp from getEduSemester POST.");
    console.log("BG: Raw HTML from getEduSemester POST (first 300):", semesterHtmlResp.substring(0,300));
    return await parseHTMLViaOffscreen(semesterHtmlResp, 'extractSemesters');
}
async function extractSubjectsFromEvalPageHTML(pageHtml) { // Keep this name
    console.log("BG: extractSubjectsFromEvalPageHTML called.");
    if (!pageHtml) throw new Error("BG: HTML for subject extraction is empty.");
    const subjects = await parseHTMLViaOffscreen(pageHtml, 'extractSubjects');
    if (!Array.isArray(subjects)) throw new Error("BG: Invalid data for subjects from offscreen.");
    // Log to check if eduFormId is present
    console.log("BG: Subjects extracted by offscreen (first one):", subjects.length > 0 ? subjects[0] : "No subjects");
    return subjects;
}
async function fetchSubjectEvaluationData(subjectId, eduFormId) { // Added eduFormId parameter
    console.log(`BG: Fetching evaluation data for subject ID: ${subjectId}, eduFormId: ${eduFormId}`);
    const evalPopupUrl = new URL('studentEvaluationPopup', BASE_AZ_URL).href;
    
    // Setup form data
    const formData = new URLSearchParams();
    formData.append('id', subjectId);
    formData.append('lessonType', '');
    if (!eduFormId) {
        console.warn(`BG: eduFormId is missing for subjectId ${subjectId}. Using default '450'.`);
        formData.append('edu_form_id', '450'); // Fallback, though ideally it should always be provided
    } else {
        formData.append('edu_form_id', eduFormId); // Use the provided eduFormId
    }
    
    const reqOpts = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest'
        },
        body: formData.toString()
    };
    
    try {
        const response = await fetch(evalPopupUrl, reqOpts);
        if (!response.ok) {
            throw new Error(`Failed POST to get evaluation popup: ${response.status} ${response.statusText}`);
        }
        
        const popupHtml = await response.text();
        if (!popupHtml) throw new Error("Empty response from studentEvaluationPopup POST");
        
        // Extract attendance percentage from the popup HTML
        const attendancePercentage = await parseHTMLViaOffscreen(popupHtml, 'extractAttendancePercentage');
        return { 
            success: true, 
            attendancePercentage: attendancePercentage || "N/A"
        };
    } catch (error) {
        console.error(`BG: Error fetching evaluation data for subject ${subjectId}:`, error);
        return { success: false, error: error.message };
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "fetchFullAcademicData") { // Renamed action for clarity
        (async () => {
            console.log("BG: 'fetchFullAcademicData' action started. Tab ID:", request.tabId);
            let studentEvaluationPageUrl;
            let initialHtmlForYears;
            let htmlWithSubjects; // This will be like html_content3

            let selectedYear = null, allYears = [];
            let selectedSemester = null, semestersForSelectedYear = [];
            let subjectsForSelectedSemester = [];
            let csrfToken = null; // Placeholder

            try {
                if (!request.tabId) throw new Error("Tab ID missing.");
                const currentTab = await chrome.tabs.get(request.tabId);
                if (!currentTab || !currentTab.url) throw new Error("Could not get tab info.");

                // 1. Get Initial Page HTML (for Years and potential CSRF)
                const noteAndAnnounceUrl = new URL('noteandannounce', BASE_AZ_URL).href;
                const studentEvalDirectUrl = new URL('studentEvaluation', BASE_AZ_URL).href;
                if (currentTab.url.startsWith(noteAndAnnounceUrl)) {
                    const noteResponse = await fetch(currentTab.url);
                    if(!noteResponse.ok) throw new Error("Failed note fetch");
                    const noteHtml = await noteResponse.text();
                    studentEvaluationPageUrl = await getStudentEvalUrlFromNotePageHTML(noteHtml);
                    const initialEvalResponse = await fetch(studentEvaluationPageUrl);
                    if(!initialEvalResponse.ok) throw new Error("Failed initial eval fetch");
                    initialHtmlForYears = await initialEvalResponse.text();
                } else if (currentTab.url.startsWith(studentEvalDirectUrl)) {
                    studentEvaluationPageUrl = currentTab.url.split('?')[0];
                    const initialEvalResponse = await fetch(studentEvaluationPageUrl);
                    if(!initialEvalResponse.ok) throw new Error("Failed direct eval fetch");
                    initialHtmlForYears = await initialEvalResponse.text();
                } else {
                    studentEvaluationPageUrl = new URL('studentEvaluation', BASE_AZ_URL).href;
                    const initialEvalResponse = await fetch(studentEvaluationPageUrl);
                    if(!initialEvalResponse.ok) throw new Error("Failed default eval fetch");
                    initialHtmlForYears = await initialEvalResponse.text();
                }
                if (!initialHtmlForYears) throw new Error("HTML for year parsing is empty.");
                console.log("BG: Student Eval URL for operations:", studentEvaluationPageUrl);
                // TODO: Extract CSRF from initialHtmlForYears if needed

                // 2. Extract Years, Select Latest
                allYears = await extractYearsFromEvalPageHTML(initialHtmlForYears);
                if (!allYears || allYears.length === 0) throw new Error("No academic years extracted.");
                selectedYear = allYears[0]; // Assuming sorted: latest is first
                console.log(`BG: Selected Year: ${selectedYear.text} (ID: ${selectedYear.value})`);

                // 3. Fetch Semesters for Selected Year (via POST)
                semestersForSelectedYear = await fetchSemestersForYearPOST(selectedYear.value, csrfToken);
                if (!semestersForSelectedYear || semestersForSelectedYear.length === 0) {
                    console.warn(`BG: No semesters found via POST for year ${selectedYear.text}.`);
                    // Don't throw error yet, let popup display "no semesters"
                } else {
                    console.log(`BG: Semesters for ${selectedYear.text}:`, semestersForSelectedYear.length);
                }
                // Select a semester (e.g., first one or "I semestr")
                selectedSemester = semestersForSelectedYear.find(s => s.text.includes("II semestr") || s.text.includes("Payız")) || semestersForSelectedYear[0];
                if (!selectedSemester && semestersForSelectedYear.length > 0) { // Fallback if specific not found but list exists
                    selectedSemester = semestersForSelectedYear[0];
                }

                if (!selectedSemester) { // If still no semester after POST and trying to pick one
                    console.warn(`BG: Could not select a semester for year ${selectedYear.text}. Subject fetching will be skipped.`);
                    // We can still send back what we have so far
                    sendResponse({ data: { selectedYear, selectedSemester: null, semesters: semestersForSelectedYear, subjects: [] }});
                    return; // Stop here if no semester to proceed with
                }
                console.log(`BG: Selected Semester: ${selectedSemester.text} (ID: ${selectedSemester.value})`);

                // 4. Fetch HTML for Page with Year & Semester selected (this is html_content3)
                const urlForSubjects = `${studentEvaluationPageUrl}?eduYear=${selectedYear.value}&eduSemester=${selectedSemester.value}`;
                console.log("BG: Fetching HTML for subjects from:", urlForSubjects);
                const subjectPageResponse = await fetch(urlForSubjects);
                if (!subjectPageResponse.ok) throw new Error(`Fetch failed for ${urlForSubjects}: ${subjectPageResponse.statusText}`);
                htmlWithSubjects = await subjectPageResponse.text();
                if (!htmlWithSubjects) throw new Error("HTML for subject parsing is empty.");
                console.log("BG: HTML for subject parsing ready, length:", htmlWithSubjects.length);

                // 5. Extract Subjects
                subjectsForSelectedSemester = await extractSubjectsFromEvalPageHTML(htmlWithSubjects);
                console.log(`BG: Subjects extracted for ${selectedSemester.text}:`, subjectsForSelectedSemester.length);

                sendResponse({
                    data: {
                        selectedYear,
                        selectedSemester,
                        semesters: semestersForSelectedYear, // All semesters for the selected year
                        subjects: subjectsForSelectedSemester
                    }
                });

            } catch (error) {
                console.error("BG: Error in 'fetchFullAcademicData':", error.message, error.stack ? error.stack.split('\n').slice(0,3).join('\n') : '');
                sendResponse({ error: `BG Error: ${error.message}` });
            }
        })();
        return true;
    } 
    else if (request.action === "fetchSubjectEvaluation") {
        (async () => {
            try {
                if (!request.subjectId) throw new Error("Subject ID is missing");
                if (!request.eduFormId) throw new Error("eduFormId is missing"); // Make it required
                const result = await fetchSubjectEvaluationData(request.subjectId, request.eduFormId);
                sendResponse(result);
            } catch (error) {
                console.error("BG: Error in fetchSubjectEvaluation handler:", error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }
    else if (request.action === "fetchAllSubjectsEvaluation") {
        (async () => {
            try {
                if (!request.subjects || !Array.isArray(request.subjects)) {
                    throw new Error("Invalid subjects array");
                }
                
                const results = {};
                for (const subject of request.subjects) {
                    if (!subject.id || !subject.eduFormId) {
                        console.warn(`BG: Skipping subject due to missing id or eduFormId:`, subject);
                        results[subject.id || `unknown-${Math.random()}`] = { success: false, error: "Missing subject id or eduFormId", attendancePercentage: "N/A" };
                        continue;
                    }
                    console.log(`BG: Fetching evaluation for subject: ${subject.name} (ID: ${subject.id}, eduFormId: ${subject.eduFormId})`);
                    const result = await fetchSubjectEvaluationData(subject.id, subject.eduFormId); // Pass eduFormId
                    results[subject.id] = result;
                    await new Promise(resolve => setTimeout(resolve, 250)); // Slightly reduced delay
                }
                
                sendResponse({ success: true, data: results });
            } catch (error) {
                console.error("BG: Error in fetchAllSubjectsEvaluation handler:", error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }
});

setupOffscreenDocument().catch(err => console.warn("BG: Initial offscreen setup failed.", err));
console.log("BG: Background script (Subjects Test) fully loaded.");