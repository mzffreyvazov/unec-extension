// background.js
console.log("BG: Script loaded (Subjects Test Version).");

const BASE_AZ_URL = "https://kabinet.unec.edu.az/az/";
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
let creatingOffscreenPromise = null;

// Storage utilities - moved to top to avoid hoisting issues
const STORAGE_KEYS = {
    ACADEMIC_DATA: 'academic_data',
    ALL_YEARS: 'all_years',
    SUBJECT_EVALUATIONS: 'subject_evaluations',
    SEMINAR_GRADES: 'seminar_grades',
    ABSENCE_COUNTS: 'absence_counts',
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
async function getStudentEvalUrlFromNotePageHTML(pageHtml) { 
    if (!pageHtml) throw new Error("BG: HTML for note/announce page is empty.");
    const href = await parseHTMLViaOffscreen(pageHtml, 'extractEvaluationLinkHref');
    if (!href || typeof href !== 'string') throw new Error("BG: Invalid href for eval link.");
    // Ensure the URL uses HTTPS to avoid Mixed Content errors
    const fullUrl = new URL(href, BASE_AZ_URL).href;
    return fullUrl.replace(/^http:/, 'https:');
}
async function extractYearsFromEvalPageHTML(pageHtml) {
    if (!pageHtml) throw new Error("BG: HTML for year extraction is empty.");
    const years = await parseHTMLViaOffscreen(pageHtml, 'extractYears');
    if (!Array.isArray(years)) throw new Error("BG: Invalid data for years.");
    return years;
}
async function fetchSemestersForYearPOST(yearId, csrfToken, tabId) { 
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
async function extractLessonTypesFromHTML(pageHtml) {
    console.log("BG: extractLessonTypesFromHTML called.");
    if (!pageHtml) throw new Error("BG: HTML for lesson type extraction is empty.");
    const lessonTypes = await parseHTMLViaOffscreen(pageHtml, 'extractLessonTypes');
    if (!Array.isArray(lessonTypes)) throw new Error("BG: Invalid data for lesson types from offscreen.");
    console.log("BG: Lesson types extracted:", lessonTypes.length);
    return lessonTypes;
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
async function fetchSeminarGradesForSubject(subjectId, eduFormId, lessonTypeValue, tabId) {
    console.log(`BG: Fetching seminar grades for subject ID: ${subjectId}, lessonType: ${lessonTypeValue}`);
    const evalPopupUrl = new URL('studentEvaluationPopup', BASE_AZ_URL).href;
    
    const formData = new URLSearchParams();
    formData.append('id', subjectId);
    formData.append('lessonType', lessonTypeValue);
    formData.append('edu_form_id', eduFormId || '450');
    
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
        const seminarGrades = await parseHTMLViaOffscreen(popupHtml, 'extractSeminarGrades');
        return { 
            success: true, 
            grades: seminarGrades || []
        };
    } catch (error) {
        console.error(`BG: Error fetching seminar grades for subject ${subjectId}:`, error);
        return { success: false, error: error.message, grades: [] };
    }
}
async function countAbsencesForSubject(subjectId, eduFormId, lessonTypeValue, tabId) {
    console.log(`BG: Counting absences for subject ID: ${subjectId}, lessonType: ${lessonTypeValue}`);
    const evalPopupUrl = new URL('studentEvaluationPopup', BASE_AZ_URL).href;
    
    const formData = new URLSearchParams();
    formData.append('id', subjectId);
    formData.append('lessonType', lessonTypeValue);
    formData.append('edu_form_id', eduFormId || '450');
    
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
        const absenceCount = await parseHTMLViaOffscreen(popupHtml, 'countAbsences');
        return { 
            success: true, 
            count: absenceCount || 0
        };
    } catch (error) {
        console.error(`BG: Error counting absences for subject ${subjectId}:`, error);
        return { success: false, error: error.message, count: 0 };
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

async function fetchExamResultsForYearAndSemester(tabId, yearValue, semesterValue) {
    console.log("BG: Fetching exam results for specific year/semester:", yearValue, semesterValue);
    
    try {
        const eresultsUrl = new URL('eresults', BASE_AZ_URL).href;
        const examResultsUrl = `${eresultsUrl}?eyear=${yearValue}&term=${semesterValue}&examType=`;
        const resultsHtml = await fetchViaContentScript(tabId, examResultsUrl);
        
        const examResults = await parseHTMLViaOffscreen(resultsHtml, 'extractExamResults');
        
        return {
            success: true,
            data: {
                examResults
            }
        };
        
    } catch (error) {
        console.error("BG: Error fetching exam results for year/semester:", error);
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

// New function to fetch seminar grades for all subjects
async function fetchAllSeminarGrades(subjects, lessonTypeValue, tabId) {
    console.log("BG: Fetching seminar grades for all subjects");
    const results = {};
    
    for (const subject of subjects) {
        if (!subject.id || !subject.eduFormId) {
            console.warn(`BG: Skipping subject due to missing id or eduFormId:`, subject);
            results[subject.id || `unknown-${Math.random()}`] = { 
                success: false, 
                error: "Missing subject id or eduFormId", 
                grades: []
            };
            continue;
        }
        console.log(`BG: Fetching seminar grades for subject: ${subject.name} (ID: ${subject.id})`);
        const result = await fetchSeminarGradesForSubject(subject.id, subject.eduFormId, lessonTypeValue, tabId);
        results[subject.id] = result;
        await new Promise(resolve => setTimeout(resolve, 250)); // Rate limiting
    }
    
    return results;
}

// New function to count absences for all subjects (Seminar + Mühazirə)
async function countAllAbsences(subjects, seminarTypeValue, muhazireTypeValue, tabId) {
    console.log("BG: Counting absences for all subjects (Seminar + Mühazirə)");
    const results = {};
    
    for (const subject of subjects) {
        if (!subject.id || !subject.eduFormId) {
            console.warn(`BG: Skipping subject due to missing id or eduFormId:`, subject);
            results[subject.id || `unknown-${Math.random()}`] = { 
                success: false, 
                error: "Missing subject id or eduFormId", 
                totalCount: 0
            };
            continue;
        }
        
        console.log(`BG: Counting absences for subject: ${subject.name} (ID: ${subject.id})`);
        let totalCount = 0;
        
        // Count absences in Seminar
        if (seminarTypeValue) {
            const seminarResult = await countAbsencesForSubject(subject.id, subject.eduFormId, seminarTypeValue, tabId);
            if (seminarResult.success) {
                totalCount += seminarResult.count;
            }
            await new Promise(resolve => setTimeout(resolve, 250)); // Rate limiting
        }
        
        // Count absences in Mühazirə
        if (muhazireTypeValue) {
            const muhazireResult = await countAbsencesForSubject(subject.id, subject.eduFormId, muhazireTypeValue, tabId);
            if (muhazireResult.success) {
                totalCount += muhazireResult.count;
            }
            await new Promise(resolve => setTimeout(resolve, 250)); // Rate limiting
        }
        
        results[subject.id] = { 
            success: true, 
            totalCount: totalCount
        };
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
                        const cachedAllYears = await getFromStorage(STORAGE_KEYS.ALL_YEARS);
                        const cachedSubjectEvals = await getFromStorage(STORAGE_KEYS.SUBJECT_EVALUATIONS);
                        const cachedSeminarGrades = await getFromStorage(STORAGE_KEYS.SEMINAR_GRADES);
                        const cachedAbsenceCounts = await getFromStorage(STORAGE_KEYS.ABSENCE_COUNTS);
                        
                        if (cachedData) {
                            console.log("BG: Returning cached academic data with subject evaluations, seminar grades, and absence counts");
                            sendResponse({ 
                                success: true, 
                                data: cachedData,
                                allYears: cachedAllYears || [],
                                subjectEvaluations: cachedSubjectEvals || {},
                                seminarGrades: cachedSeminarGrades || {},
                                absenceCounts: cachedAbsenceCounts || {}
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
                        const cachedSeminarGrades = await getFromStorage(STORAGE_KEYS.SEMINAR_GRADES);
                        const cachedAbsenceCounts = await getFromStorage(STORAGE_KEYS.ABSENCE_COUNTS);
                        
                        if (cachedData) {
                            console.log("BG: Using cached academic data with subject evaluations, seminar grades, and absence counts");
                            sendResponse({ 
                                data: cachedData, 
                                subjectEvaluations: cachedSubjectEvals || {},
                                seminarGrades: cachedSeminarGrades || {},
                                absenceCounts: cachedAbsenceCounts || {},
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

                // 5. Extract Subjects and Lesson Types
                subjectsForSelectedSemester = await extractSubjectsFromEvalPageHTML(htmlWithSubjects);
                console.log(`BG: Subjects extracted for ${selectedSemester.text}:`, subjectsForSelectedSemester.length);
                
                // Extract lesson types to find Seminar and Mühazirə options
                const lessonTypes = await extractLessonTypesFromHTML(htmlWithSubjects);
                const seminarLessonType = lessonTypes.find(lt => lt.text.toLowerCase().includes('seminar') && !lt.text.toLowerCase().includes('distant'));
                const muhazireLessonType = lessonTypes.find(lt => lt.text.toLowerCase().includes('mühazirə') || lt.text.toLowerCase().includes('muhazire'));
                console.log("BG: Lesson types found:", lessonTypes.length, "Seminar type:", seminarLessonType, "Mühazirə type:", muhazireLessonType);

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
                
                // 7. Fetch seminar grades if we found the Seminar lesson type
                let seminarGrades = {};
                if (seminarLessonType && subjectsForSelectedSemester && subjectsForSelectedSemester.length > 0) {
                    console.log("BG: Fetching seminar grades for all subjects");
                    seminarGrades = await fetchAllSeminarGrades(subjectsForSelectedSemester, seminarLessonType.value, request.tabId);
                    console.log("BG: Seminar grades completed, keys:", Object.keys(seminarGrades));
                }
                
                // 8. Count absences (q/b) for Seminar and Mühazirə
                let absenceCounts = {};
                if (subjectsForSelectedSemester && subjectsForSelectedSemester.length > 0) {
                    console.log("BG: Counting absences for all subjects (Seminar + Mühazirə)");
                    absenceCounts = await countAllAbsences(
                        subjectsForSelectedSemester, 
                        seminarLessonType?.value, 
                        muhazireLessonType?.value, 
                        request.tabId
                    );
                    console.log("BG: Absence counting completed, keys:", Object.keys(absenceCounts));
                }

                // Save academic data, subject evaluations, seminar grades, and absence counts to cache
                await saveToStorage(STORAGE_KEYS.ACADEMIC_DATA, freshAcademicData);
                await saveToStorage(STORAGE_KEYS.ALL_YEARS, allYears);
                await saveToStorage(STORAGE_KEYS.SUBJECT_EVALUATIONS, subjectEvaluations);
                await saveToStorage(STORAGE_KEYS.SEMINAR_GRADES, seminarGrades);
                await saveToStorage(STORAGE_KEYS.ABSENCE_COUNTS, absenceCounts);
                await saveToStorage(STORAGE_KEYS.LAST_FETCH_TIME, Date.now());

                sendResponse({ 
                    data: freshAcademicData,
                    allYears: allYears,
                    subjectEvaluations: subjectEvaluations,
                    seminarGrades: seminarGrades,
                    absenceCounts: absenceCounts,
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
    else if (request.action === "fetchSemestersForYear") {
        (async () => {
            try {
                console.log("BG: fetchSemestersForYear for year:", request.yearValue);
                
                // Use provided tabId or get current tab
                const tabId = request.tabId || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
                if (!tabId) {
                    throw new Error("No tab ID available");
                }
                
                // CSRF token is not needed for this request
                const csrfToken = null;
                
                const semesters = await fetchSemestersForYearPOST(request.yearValue, csrfToken, tabId);
                sendResponse({ success: true, semesters: semesters });
            } catch (error) {
                console.error("BG: Error fetching semesters:", error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }
    else if (request.action === "fetchDataForYearAndSemester") {
        (async () => {
            try {
                console.log("BG: fetchDataForYearAndSemester - year:", request.yearValue, "semester:", request.semesterValue);
                
                const studentEvaluationPageUrl = new URL('studentEvaluation', BASE_AZ_URL).href;
                const urlForSubjects = `${studentEvaluationPageUrl}?eduYear=${request.yearValue}&eduSemester=${request.semesterValue}`;
                
                const htmlWithSubjects = await fetchViaContentScript(request.tabId, urlForSubjects);
                const subjects = await extractSubjectsFromEvalPageHTML(htmlWithSubjects);
                
                // Extract lesson types
                const lessonTypes = await extractLessonTypesFromHTML(htmlWithSubjects);
                const seminarLessonType = lessonTypes.find(lt => lt.text.toLowerCase().includes('seminar') && !lt.text.toLowerCase().includes('distant'));
                const muhazireLessonType = lessonTypes.find(lt => lt.text.toLowerCase().includes('mühazirə') || lt.text.toLowerCase().includes('muhazire'));
                
                // Fetch evaluations, seminar grades, and absence counts
                let subjectEvaluations = {};
                let seminarGrades = {};
                let absenceCounts = {};
                
                if (subjects && subjects.length > 0) {
                    subjectEvaluations = await fetchAllSubjectEvaluations(subjects, request.tabId);
                    if (seminarLessonType) {
                        seminarGrades = await fetchAllSeminarGrades(subjects, seminarLessonType.value, request.tabId);
                    }
                    absenceCounts = await countAllAbsences(subjects, seminarLessonType?.value, muhazireLessonType?.value, request.tabId);
                }
                
                const data = {
                    selectedYear: { value: request.yearValue },
                    selectedSemester: { value: request.semesterValue },
                    subjects: subjects
                };
                
                sendResponse({ 
                    data: data,
                    subjectEvaluations: subjectEvaluations,
                    seminarGrades: seminarGrades,
                    absenceCounts: absenceCounts
                });
            } catch (error) {
                console.error("BG: Error fetching data for year/semester:", error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }
    else if (request.action === "fetchExamResultsForYearAndSemester") {
        (async () => {
            try {
                console.log("BG: fetchExamResultsForYearAndSemester - year:", request.yearValue, "semester:", request.semesterValue);
                
                const result = await fetchExamResultsForYearAndSemester(request.tabId, request.yearValue, request.semesterValue);
                sendResponse(result);
            } catch (error) {
                console.error("BG: Error in fetchExamResultsForYearAndSemester handler:", error);
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