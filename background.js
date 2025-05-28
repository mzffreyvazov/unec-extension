// background.js
console.log("BG: Script loaded (Subjects Test Version).");

const BASE_AZ_URL = "https://kabinet.unec.edu.az/az/";
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
let creatingOffscreenPromise = null;

// Storage utilities - moved to top to avoid hoisting issues
const STORAGE_KEYS = {
    ACADEMIC_DATA: 'academic_data',
    SUBJECT_EVALUATIONS: 'subject_evaluations',
    EXAM_RESULTS: 'exam_results',
    LAST_FETCH_TIME: 'last_fetch_time',
    LAST_SUBJECT_EVAL_FETCH_TIME: 'last_subject_eval_fetch_time',
    LAST_EXAM_FETCH_TIME: 'last_exam_fetch_time'
};

const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes in milliseconds

async function saveToStorage(key, data) {
    try {
        await chrome.storage.local.set({ [key]: data });
        console.log(`BG: Saved ${key} to storage`);
    } catch (error) {
        console.error(`BG: Failed to save ${key} to storage:`, error);
    }
}

async function getFromStorage(key) {
    try {
        const result = await chrome.storage.local.get([key]);
        return result[key] || null;
    } catch (error) {
        console.error(`BG: Failed to get ${key} from storage:`, error);
        return null;
    }
}

async function checkCacheValidity(timestampKey) {
    const lastFetchTime = await getFromStorage(timestampKey);
    if (!lastFetchTime) return false;
    
    const now = Date.now();
    const timeDiff = now - lastFetchTime;
    return timeDiff < CACHE_DURATION;
}

async function clearOldCache() {
    try {
        await chrome.storage.local.clear();
        console.log("BG: Cleared old cache");
    } catch (error) {
        console.error("BG: Failed to clear cache:", error);
    }
}

// --- Offscreen Document Management & parseHTMLViaOffscreen ---
async function hasOffscreenDocument() {
    const contexts = await chrome.runtime.getContexts({contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]});
    return contexts.length > 0;
}

async function setupOffscreenDocument() {
    if (await hasOffscreenDocument()) return true;
    if (creatingOffscreenPromise) return creatingOffscreenPromise;
    creatingOffscreenPromise = chrome.offscreen.createDocument({ url: OFFSCREEN_DOCUMENT_PATH,reasons: [chrome.offscreen.Reason.DOM_PARSER], justification: 'Parse HTML.'})
    .then(() => true).catch(err => { if (err.message.includes("single offscreen document")) return true; console.error("BG: Err create offscreen:", err); return false;})
    .finally(() => { creatingOffscreenPromise = null; });
    return creatingOffscreenPromise;
}

async function parseHTMLViaOffscreen(htmlString, task) {
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
async function fetchSemestersForYearPOST(yearId, csrfToken, tabId) { /* ... same from message #17 ... */
    const semesterUrl = new URL('getEduSemester', BASE_AZ_URL).href;
    console.log(`BG: POST to ${semesterUrl} for year ID: ${yearId}`);
    const formData = new URLSearchParams(); formData.append('type', 'eduYear'); formData.append('id', yearId);
    // if (csrfToken) formData.append('YII_CSRF_TOKEN', csrfToken); // TODO: Handle CSRF if needed
    const reqOpts = { method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest'}, body: formData.toString()};
    const semesterHtmlResp = await fetchViaContentScript(tabId, semesterUrl, reqOpts);
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
async function fetchSubjectEvaluationData(subjectId, eduFormId, tabId) { // Added eduFormId parameter
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
        const popupHtml = await fetchViaContentScript(tabId, evalPopupUrl, reqOpts);
        const evaluationDetails = await parseHTMLViaOffscreen(popupHtml, 'extractEvaluationDetails');
        return { 
            success: true, 
            details: evaluationDetails // Return the whole object from offscreen
        };
    } catch (error) {
        console.error(`BG: Error fetching evaluation data for subject ${subjectId}:`, error);
        return { success: false, error: error.message, details: { attendancePercentage: null, currentEvaluation: null } };
    }
}
async function fetchExamResults(tabId) {
    console.log("BG: Starting exam results fetch process");
    
    try {
        // 1. Fetch initial exam results page to get years
        const eresultsUrl = new URL('eresults', BASE_AZ_URL).href;
        const initialHtml = await fetchViaContentScript(tabId, eresultsUrl);
        
        // 2. Extract available years
        const years = await parseHTMLViaOffscreen(initialHtml, 'extractExamYears');
        if (!years || years.length === 0) throw new Error("No exam years found");
        
        // 3. Select latest year
        const selectedYear = years[0];
        console.log(`BG: Selected exam year: ${selectedYear.text} (ID: ${selectedYear.value})`);
        
        // 4. Fetch semesters for selected year
        const evadataUrl = new URL('evadata', BASE_AZ_URL).href;
        const formData = new URLSearchParams();
        formData.append('type', 'Evaluation_eyear');
        formData.append('id', selectedYear.value);
        formData.append('current', 'false');
        
        const semesterOptions = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: formData.toString()
        };
        
        const semesterHtml = await fetchViaContentScript(tabId, evadataUrl, semesterOptions);
        
        // 5. Extract semesters
        const semesters = await parseHTMLViaOffscreen(semesterHtml, 'extractExamSemesters');
        if (!semesters || semesters.length === 0) throw new Error("No exam semesters found");
        
        // 6. Select latest semester (preferably "II semestr")
        const selectedSemester = semesters.find(s => s.text.includes("II semestr")) || semesters[0];
        console.log(`BG: Selected exam semester: ${selectedSemester.text} (ID: ${selectedSemester.value})`);
        
        // 7. Fetch exam results for selected year and semester
        const examResultsUrl = `${eresultsUrl}?eyear=${selectedYear.value}&term=${selectedSemester.value}&examType=`;
        const resultsHtml = await fetchViaContentScript(tabId, examResultsUrl);
        
        // 8. Extract exam results
        const examResults = await parseHTMLViaOffscreen(resultsHtml, 'extractExamResults');
        
        return {
            success: true,
            data: {
                selectedYear,
                selectedSemester,
                examResults
            }
        };
        
    } catch (error) {
        console.error("BG: Error fetching exam results:", error);
        return { success: false, error: error.message };
    }
}

// Helper function to ensure content script is ready
async function ensureContentScriptReady(tabId, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await chrome.tabs.sendMessage(tabId, { action: "ping" });
            if (response && response.success) {
                console.log("BG: Content script is ready");
                return true;
            }
        } catch (error) {
            console.log(`BG: Content script not ready, attempt ${i + 1}/${maxRetries}`);
            if (i < maxRetries - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
            }
        }
    }
    return false;
}

// Helper function to inject content script if needed
async function injectContentScriptIfNeeded(tabId) {
    try {
        // Try to ping the content script first
        const isReady = await ensureContentScriptReady(tabId, 1);
        if (isReady) return true;
        
        console.log("BG: Injecting content script");
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js']
        });
        
        // Wait a bit for the script to initialize
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Check if it's ready now
        return await ensureContentScriptReady(tabId, 2);
    } catch (error) {
        console.error("BG: Failed to inject content script:", error);
        return false;
    }
}

// Helper function to make requests through content script
async function fetchViaContentScript(tabId, url, options = {}) {
    try {
        console.log("BG: Requesting fetch via content script for URL:", url);
        
        // Ensure content script is ready
        const isReady = await ensureContentScriptReady(tabId);
        if (!isReady) {
            // Try to inject the content script
            const injected = await injectContentScriptIfNeeded(tabId);
            if (!injected) {
                throw new Error("Content script is not available and could not be injected");
            }
        }
        
        const response = await chrome.tabs.sendMessage(tabId, {
            action: "fetchFromWebpage",
            url: url,
            options: options
        });
        
        if (!response.success) {
            throw new Error(response.error || "Content script fetch failed");
        }
        
        return response.data; // Return the HTML content
    } catch (error) {
        console.error("BG: Content script fetch error:", error);
        throw new Error(`Content script fetch failed: ${error.message}`);
    }
}

// New function to fetch all subject evaluations and cache them
async function fetchAllSubjectEvaluations(subjects, tabId) {
    console.log("BG: Fetching evaluations for all subjects");
    const results = {};
    
    for (const subject of subjects) {
        if (!subject.id || !subject.eduFormId) {
            console.warn(`BG: Skipping subject due to missing id or eduFormId:`, subject);
            results[subject.id || `unknown-${Math.random()}`] = { 
                success: false, 
                error: "Missing subject id or eduFormId", 
                details: { attendancePercentage: null, currentEvaluation: null }
            };
            continue;
        }
        console.log(`BG: Fetching evaluation for subject: ${subject.name} (ID: ${subject.id}, eduFormId: ${subject.eduFormId})`);
        const result = await fetchSubjectEvaluationData(subject.id, subject.eduFormId, tabId);
        results[subject.id] = result;
        await new Promise(resolve => setTimeout(resolve, 250)); // Rate limiting
    }
    
    return results;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "contentScriptReady") {
        console.log("BG: Content script ready on:", request.url);
        return;
    }
    
    if (request.action === "getCachedData") {
        (async () => {
            try {
                console.log("BG: getCachedData request for:", request.dataType);
                
                if (request.dataType === "academic") {
                    const isCacheStillValid = await checkCacheValidity(STORAGE_KEYS.LAST_FETCH_TIME);
                    if (isCacheStillValid) {
                        const cachedData = await getFromStorage(STORAGE_KEYS.ACADEMIC_DATA);
                        const cachedSubjectEvals = await getFromStorage(STORAGE_KEYS.SUBJECT_EVALUATIONS);
                        
                        if (cachedData) {
                            console.log("BG: Returning cached academic data with subject evaluations");
                            sendResponse({ 
                                success: true, 
                                data: cachedData,
                                subjectEvaluations: cachedSubjectEvals || {}
                            });
                            return;
                        }
                    }
                } else if (request.dataType === "exam") {
                    const isCacheStillValid = await checkCacheValidity(STORAGE_KEYS.LAST_EXAM_FETCH_TIME);
                    if (isCacheStillValid) {
                        const cachedData = await getFromStorage(STORAGE_KEYS.EXAM_RESULTS);
                        if (cachedData && cachedData.success) {
                            console.log("BG: Returning cached exam results");
                            sendResponse({ success: true, data: cachedData.data });
                            return;
                        }
                    }
                }
                
                console.log("BG: No valid cached data found for:", request.dataType);
                sendResponse({ success: false, message: "No valid cached data" });
                
            } catch (error) {
                console.error("BG: Error getting cached data:", error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }
    
    if (request.action === "fetchFullAcademicData") {
        (async () => {
            console.log("BG: 'fetchFullAcademicData' action started. Tab ID:", request.tabId);
            
            try {
                // Only use cache for subsequent calls, not if explicitly forcing fresh fetch
                const forceFresh = request.forceFresh === true;
                
                if (!forceFresh) {
                    // Check if we have valid cached data
                    const isCacheStillValid = await checkCacheValidity(STORAGE_KEYS.LAST_FETCH_TIME);
                    if (isCacheStillValid) {
                        const cachedData = await getFromStorage(STORAGE_KEYS.ACADEMIC_DATA);
                        const cachedSubjectEvals = await getFromStorage(STORAGE_KEYS.SUBJECT_EVALUATIONS);
                        
                        if (cachedData) {
                            console.log("BG: Using cached academic data with subject evaluations");
                            sendResponse({ 
                                data: cachedData, 
                                subjectEvaluations: cachedSubjectEvals || {},
                                fromCache: true 
                            });
                            return;
                        }
                    }
                }

                // Proceed with fresh fetch
                if (!request.tabId) throw new Error("Tab ID missing.");
                const currentTab = await chrome.tabs.get(request.tabId);
                if (!currentTab || !currentTab.url) throw new Error("Could not get tab info.");

                // Ensure content script is ready before proceeding
                const isReady = await ensureContentScriptReady(request.tabId);
                if (!isReady) {
                    const injected = await injectContentScriptIfNeeded(request.tabId);
                    if (!injected) {
                        throw new Error("Content script is not available. Please refresh the page and try again.");
                    }
                }

                // Declare variables
                let studentEvaluationPageUrl;
                let initialHtmlForYears;
                let htmlWithSubjects;
                let allYears = [];
                let selectedYear = null;
                let selectedSemester = null;
                let semestersForSelectedYear = [];
                let subjectsForSelectedSemester = [];
                let csrfToken = null;

                // 1. Get Initial Page HTML (for Years and potential CSRF)
                const noteAndAnnounceUrl = new URL('noteandannounce', BASE_AZ_URL).href;
                const studentEvalDirectUrl = new URL('studentEvaluation', BASE_AZ_URL).href;
                if (currentTab.url.startsWith(noteAndAnnounceUrl)) {
                    const noteHtml = await fetchViaContentScript(request.tabId, currentTab.url);
                    studentEvaluationPageUrl = await getStudentEvalUrlFromNotePageHTML(noteHtml);
                    initialHtmlForYears = await fetchViaContentScript(request.tabId, studentEvaluationPageUrl);
                } else if (currentTab.url.startsWith(studentEvalDirectUrl)) {
                    studentEvaluationPageUrl = currentTab.url.split('?')[0];
                    initialHtmlForYears = await fetchViaContentScript(request.tabId, studentEvaluationPageUrl);
                } else {
                    studentEvaluationPageUrl = new URL('studentEvaluation', BASE_AZ_URL).href;
                    initialHtmlForYears = await fetchViaContentScript(request.tabId, studentEvaluationPageUrl);
                }
                if (!initialHtmlForYears) throw new Error("BG: HTML for year parsing is empty.");
                console.log("BG: Student Eval URL for operations:", studentEvaluationPageUrl);

                // 2. Extract Years, Select Latest
                allYears = await extractYearsFromEvalPageHTML(initialHtmlForYears);
                if (!allYears || allYears.length === 0) throw new Error("No academic years extracted.");
                selectedYear = allYears[0];
                console.log(`BG: Selected Year: ${selectedYear.text} (ID: ${selectedYear.value})`);

                // 3. Fetch Semesters for Selected Year (via POST)
                semestersForSelectedYear = await fetchSemestersForYearPOST(selectedYear.value, csrfToken, request.tabId);
                if (!semestersForSelectedYear || semestersForSelectedYear.length === 0) {
                    console.warn(`BG: No semesters found via POST for year ${selectedYear.text}.`);
                } else {
                    console.log(`BG: Semesters for ${selectedYear.text}:`, semestersForSelectedYear.length);
                }

                selectedSemester = semestersForSelectedYear.find(s => s.text.includes("II semestr") || s.text.includes("Payız")) || semestersForSelectedYear[0];
                if (!selectedSemester && semestersForSelectedYear.length > 0) {
                    selectedSemester = semestersForSelectedYear[0];
                }

                if (!selectedSemester) {
                    console.warn(`BG: Could not select a semester for year ${selectedYear.text}. Subject fetching will be skipped.`);
                    sendResponse({ data: { selectedYear, selectedSemester: null, semesters: semestersForSelectedYear, subjects: [] }});
                    return;
                }
                console.log(`BG: Selected Semester: ${selectedSemester.text} (ID: ${selectedSemester.value})`);

                // 4. Fetch HTML for Page with Year & Semester selected
                const urlForSubjects = `${studentEvaluationPageUrl}?eduYear=${selectedYear.value}&eduSemester=${selectedSemester.value}`;
                console.log("BG: Fetching HTML for subjects from:", urlForSubjects);
                htmlWithSubjects = await fetchViaContentScript(request.tabId, urlForSubjects);
                if (!htmlWithSubjects) throw new Error("HTML for subject parsing is empty.");
                console.log("BG: HTML for subject parsing ready, length:", htmlWithSubjects.length);

                // 5. Extract Subjects
                subjectsForSelectedSemester = await extractSubjectsFromEvalPageHTML(htmlWithSubjects);
                console.log(`BG: Subjects extracted for ${selectedSemester.text}:`, subjectsForSelectedSemester.length);

                const freshAcademicData = {
                    selectedYear,
                    selectedSemester,
                    semesters: semestersForSelectedYear,
                    subjects: subjectsForSelectedSemester
                };

                // 6. Fetch subject evaluations if we have subjects
                let subjectEvaluations = {};
                if (subjectsForSelectedSemester && subjectsForSelectedSemester.length > 0) {
                    console.log("BG: Fetching subject evaluations for all subjects");
                    subjectEvaluations = await fetchAllSubjectEvaluations(subjectsForSelectedSemester, request.tabId);
                    console.log("BG: Subject evaluations completed, keys:", Object.keys(subjectEvaluations));
                }

                // Save both academic data and subject evaluations to cache
                await saveToStorage(STORAGE_KEYS.ACADEMIC_DATA, freshAcademicData);
                await saveToStorage(STORAGE_KEYS.SUBJECT_EVALUATIONS, subjectEvaluations);
                await saveToStorage(STORAGE_KEYS.LAST_FETCH_TIME, Date.now());

                sendResponse({ 
                    data: freshAcademicData, 
                    subjectEvaluations: subjectEvaluations,
                    fromCache: false 
                });

            } catch (error) {
                console.error("BG: Error in 'fetchFullAcademicData':", error.message);
                sendResponse({ error: `BG Error: ${error.message}` });
            }
        })();
        return true;
    }
    else if (request.action === "fetchSubjectEvaluation") {
        (async () => {
            try {
                if (!request.subjectId) throw new Error("Subject ID is missing");
                if (!request.eduFormId) throw new Error("eduFormId is missing");
                const result = await fetchSubjectEvaluationData(request.subjectId, request.eduFormId, sender.tab.id);
                sendResponse(result);
            } catch (error) {
                console.error("BG: Error in fetchSubjectEvaluation handler:", error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }
    else if (request.action === "fetchExamResults") {
        (async () => {
            try {
                // Check if we have valid cached exam results
                const isCacheStillValid = await checkCacheValidity(STORAGE_KEYS.LAST_EXAM_FETCH_TIME);
                if (isCacheStillValid) {
                    const cachedExamResults = await getFromStorage(STORAGE_KEYS.EXAM_RESULTS);
                    if (cachedExamResults) {
                        console.log("BG: Using cached exam results");
                        sendResponse({ ...cachedExamResults, fromCache: true });
                        return;
                    }
                }

                // Get current tab ID
                const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (!currentTab?.id) throw new Error("Could not get current tab");
                
                // Ensure content script is ready
                const isReady = await ensureContentScriptReady(currentTab.id);
                if (!isReady) {
                    const injected = await injectContentScriptIfNeeded(currentTab.id);
                    if (!injected) {
                        throw new Error("Content script is not available. Please refresh the page and try again.");
                    }
                }
                
                const result = await fetchExamResults(currentTab.id);
                
                // Save to cache if successful
                if (result.success) {
                    await saveToStorage(STORAGE_KEYS.EXAM_RESULTS, result);
                    await saveToStorage(STORAGE_KEYS.LAST_EXAM_FETCH_TIME, Date.now());
                }
                
                sendResponse({ ...result, fromCache: false });
            } catch (error) {
                console.error("BG: Error in fetchExamResults handler:", error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }
    else if (request.action === "clearCache") {
        (async () => {
            await clearOldCache();
            sendResponse({ success: true });
        })();
        return true;
    }
});

setupOffscreenDocument().catch(err => console.warn("BG: Initial offscreen setup failed.", err));
console.log("BG: Background script (Subjects Test) fully loaded.");