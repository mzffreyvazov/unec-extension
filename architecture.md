## UNEC Extension — Architecture (Background & Data Flow)

This document explains the backend architecture implemented by the extension (the background logic plus related components) and details how it fetches data from the UNEC web portal (`kabinet.unec.edu.az`). It includes a mapping of endpoints, data flow, counting of network requests required to populate the popup, and notes about caching and offscreen parsing.

---

### Components

- `popup.js` (UI): The popup UI that displays subjects, evaluations, seminar scores and exam results. It interacts with the background script using `chrome.runtime.sendMessage` calls.
- `background.js` (Core orchestrator / 'backend'): Handles all heavy-lifting — data orchestration, caching, network requests (via the content script), offscreen parsing requests, and exposing action-based message handlers to the popup.
- `content.js` (Fetcher): Injected into the user’s tab; performs fetch requests in page context (allows same-origin cookies/headers, avoids CORS issues). It listens for messages with `action: "fetchFromWebpage"` and returns fetched HTML content or error.
- `offscreen.js` (HTML parser): An offscreen DOM parser that receives HTML strings and runs DOM queries using `DOMParser`. It performs tasks such as extracting years, semesters, subjects, exam rows, evaluation details, seminar grades, and counts.

---

### High Level Data Flow (popup → background → content script → site → offscreen → background → popup)

1. Popup asks for cached data (`getCachedData`) for `academic` and `exam`.
   - If cache is valid (last fetch less than 30 minutes old), the background returns cached JSON to the popup — no network calls.
2. If cache is invalid, popup asks background to fetch data:
   - `fetchFullAcademicData` (or `fetchDataForYearAndSemester` on changing year/semester) to collect subjects, subject evaluations, seminar grades, and absence counts.
   - `fetchExamResults` (or `fetchExamResultsForYearAndSemester`) to collect exam results.
3. Background ensures `content.js` is available (pings it, otherwise injects it) and then sends fetch requests to the site using `chrome.tabs.sendMessage({ action: 'fetchFromWebpage', url, options })` (content script performs actual network `fetch`).
4. Background receives raw HTML, sends the HTML strings to the offscreen document via message for parsing `parseHTMLTask` with a `task` argument for extraction (like `extractSubjects`, `extractSemesters`, `extractEvaluationDetails`, etc.).
5. The offscreen parser returns typed JS object results, and background aggregates them into data structures that are stored in `chrome.storage.local` for caching, and then returns them to popup.

---

### Base URL + Key Endpoints

- BASE URL: `https://kabinet.unec.edu.az/az/`
- note & announce (used to detect the evaluation link when the user is on that page):
  - `noteandannounce` — if the tab URL matches this path, the extension reads HTML and extracts an internal `'studentEvaluation'` link.
- student evaluations listing page (main):
  - `studentEvaluation` — GET to list subjects. Query parameters used: `eduYear`, `eduSemester`.
- semester POST endpoint (used to list terms/semesters for a year):
  - `getEduSemester` — POST: fields `type=eduYear&id={yearId}`. Responds with HTML (options/`<select>`), parsed by offscreen.
- evaluation popup (used to fetch fine-grained subject evaluation / seminar table / absence counts):
  - `studentEvaluationPopup` — POST: fields `id={subjectId}`, `lessonType`, `edu_form_id` (provides details for a single subject). This popup HTML is used by offscreen to extract evaluation details and seminar/absence info.
- exam results:
  - `eresults` — GET primary page; used (with query params) to fetch results for a specific year and term: `?eyear={value}&term={value}&examType=` .
  - `evadata` — POST: fetch semeseter data for selected exam year (`type=Evaluation_eyear&id={yearId}&current=false`), then parse returned HTML to extract semesters.

---

### Offscreen Parser Tasks (list)

- `extractYears`: parse `#eduYear` select options and sort/select most recent.
- `extractSemesters`: parse `<option>` nodes (often returned inside a select fragment) to produce a semester list.
- `extractSubjects`: parse `#studentEvaluation-grid` rows: `id`, `name`, `credit`, `edu_form_id`.
- `extractLessonTypes`: parse `#lessonType` select to find seminar / lecture / distant options.
- `extractEvaluationDetails`: parse `#finalEval table` and extract `currentEvaluation` and `attendancePercentage` (used for % of absence analysis — 'Qaib faizi').
- `extractSeminarGrades`: parse `#evaluation table` to return all seminar date/grade/topic rows.
- `countAbsences`: count absences (q/b rows) in the `#evaluation table`.
- `extractExamYears`, `extractExamSemesters`, `extractExamResults`: parse `#Evaluation_eyear` select and `#eresults-grid` rows for exam result list.

---

### Caching & Storage

- `chrome.storage.local` keys and caching:
  - `academic_data` — the core academic dataset (selectedYear, selectedSemester, semesters, subjects)
  - `all_years` — list of available years
  - `subject_evaluations` — evaluation details per subject
  - `seminar_grades` — seminar grades per subject
  - `absence_counts` — total absences per subject
  - `exam_results` — structured exam results
  - `last_fetch_time`, `last_subject_eval_fetch_time`, `last_exam_fetch_time` — timestamps used to determine if cache is still valid
- Cache time equals 30 minutes (CONFIG: `CACHE_DURATION = 30 * 60 * 1000`)

---

### Message Contract (popup ↔ background ↔ content)

- Popup → Background
  - `getCachedData` { dataType: 'academic' | 'exam' }
  - `fetchFullAcademicData` { tabId, forceFresh? }
  - `fetchSemestersForYear` { yearValue, tabId }
  - `fetchDataForYearAndSemester` { tabId, yearValue, semesterValue }
  - `fetchExamResults`, `fetchExamResultsForYearAndSemester`
  - `clearCache` — clears `chrome.storage.local` cache keys

- Background → Content
  - `fetchFromWebpage`: action with `url`, `options` (method, headers, body); content script executes `fetch()` in the page as same-origin.

- Background → Offscreen
  - `parseHTMLTask`: pass `htmlString`, `task`, `originalRequestId`.

---

### Rate limiting & throttling

- The background script uses a small delay to avoid flooding the server:
  - `await new Promise(resolve => setTimeout(resolve, 250));` between per-subject calls in `fetchAllSubjectEvaluations`, `fetchAllSeminarGrades`, and `countAllAbsences`.
  - This effectively spaces out POST requests to `studentEvaluationPopup` in the loop.

---

### How many network requests are sent to populate the popup?

Key assumptions:
- N = number of subjects in the semester.
- The following counts refer to network `fetch` calls made by the content script (i.e. actual remote requests to the portal). They do not include local extension messages.

Case A: Minimal / Common flow (user tab already on `studentEvaluation` page, both Seminar and Mühazirə lesson types exist)
- GET initial studentEvaluation page (for years/lesson types): 1 GET
- POST `getEduSemester` to get semesters for selected year: 1 POST
- GET `studentEvaluation?eduYear=...&eduSemester=...` to list subjects: 1 GET
- For each subject (N subjects):
  - POST to `studentEvaluationPopup` to fetch evaluation details (1)
  - POST to `studentEvaluationPopup` to fetch seminar grades (1)
  - POST to `studentEvaluationPopup` to count absences (seminar) (1)
  - POST to `studentEvaluationPopup` to count absences (mühazirə) (1)
  => Per-subject = 4 POSTs
=> Academic section total = 3 + 4*N

Exam results (on popup load):
- GET `eresults` (initial exam page): 1 GET
- POST `evadata` to fetch terms/semesters for selected exam year: 1 POST
- GET `eresults?eyear=...&term=...` to fetch results list: 1 GET
=> Exam total = 3

Total (both academic + exam) = 6 + 4*N network calls.

Case B: If the user tab is `noteandannounce`, or popup triggers initial extraction via `noteandannounce` (this adds 1 GET):
- +1 GET, for example: 7 + 4*N total.

Case C: If the portal doesn't have `mühazirə` and only has Seminar: per-subject requests drop by 1 (absences), yielding `3 + 3*N` for academic and total `6 + 3*N`.

Example counts:
- For N = 6 subjects: Typical total = 6 + 4*6 = 30 requests; worst-case (note page) = 31 requests.
- For N = 8 subjects: Typical total = 6 + 32 = 38 requests.
- The actual number might be smaller if some parts were cached; the background uses caching to avoid repeating these requests within 30 minutes.

Note: In addition to plain per-subject POSTs, other small background calls (e.g., `fetchSemestersForYear` when the user clicks a year) add 1 POST per action.

---

### Important Implementation details, constraints and assumptions

- CORS and credentials: The extension uses `content.js` to run a `fetch()` in the browser page context so cookies / session information are included and the portal responds with authenticated HTML. The content script is required to be in-page to bypass cross origin restrictions.
- `studentEvaluationPopup` is used for multiple purposes (evaluation detail, seminar grades, absence counting). Calls are independent and the code currently fetches them independently (not batched).
- CSRF tokens: The code contains a placeholder for adding CSRF token to semester POST (`YII_CSRF_TOKEN`), but is currently commented out. This may work because the request is same-origin and the server may accept the `X-Requested-With` header. In some server configs CSRF token is still required — this was considered but not implemented.
- Offscreen parsing: The `offscreen.html` document runs `offscreen.js` as an independent context; it uses `DOMParser` to parse HTML returned by `fetch()` calls and extract data with DOM selectors. This keeps the background worker code free from DOM dependencies and avoids injecting parsing logic into page contexts.
- Retry & injection: Background verifies that the `content.js` is active using `ping` and injects it when needed with `chrome.scripting.executeScript`(tabId, files: ['content.js']). It also injects with minimal delay to let `content.js` initialize.

---

### Performance & UX considerations

- The extension uses per-subject rate limiting of 250ms between POSTs to avoid overloading the server and to avoid being rate-limited by the portal.
- Because of many per-subject POSTs, the total fetch time increases linearly with N and can be significantly noticeable (e.g. 8 subjects x 4 requests each with 250ms delay ≈ a few seconds overhead just for throttling, plus network time).
- The caching (30 min) reduces frequent re-fetches; if users open the popup frequently in <30 min, no network fetch occurs.

---

### Suggested improvements (optional)

- Consolidate per-subject data fetches if the portal can be adjusted to return multiple datasets in one response, or use fewer calls by re-using `studentEvaluationPopup` responses if same content covers multiple needs.
- Add caching/TTL per subject subsystem (e.g., seminar grades and absences can be cached separately with their own timestamp). This would reduce redundant requests if only specific parts change.
- Expose a soft-progress UI in the popup while the background finishes all subject-level requests.
- Introduce parallel request batching (with a small concurrency limit) to reduce total run time while avoiding over-burdening the server.

---

If you'd like, I can also add a small flow diagram and sample request timelines (for typical N values) to this file, or annotate the exact lines in `background.js` where each fetch is made.

---


---

## Exam Results — Detailed Fetch Flow

This section expands on the exam-related sequence of calls used to populate the exam results portion of the `popup` and how it's implemented in `background.js`.

Triggering
- The `popup` triggers exam fetch with one of the following actions: `fetchExamResults` or `fetchExamResultsForYearAndSemester`.
- Both commands are handled in `background.js` inside `chrome.runtime.onMessage` and map to the helper functions `fetchExamResults(tabId)` and `fetchExamResultsForYearAndSemester(tabId, yearValue, semesterValue)` respectively.

Caching & TTL
- Before performing network requests, the background checks:
  - `STORAGE_KEYS.LAST_EXAM_FETCH_TIME` — reads the last exam fetch timestamp
  - `STORAGE_KEYS.EXAM_RESULTS` — cached exam results structure
- If the cache is still valid (less than `CACHE_DURATION`), the cached data is returned immediately and no network calls are made.

Detailed Sequence (fetchExamResults)
1. Ensure `content.js` is ready (calls `ensureContentScriptReady`, injects via `injectContentScriptIfNeeded` if needed).
2. GET https://kabinet.unec.edu.az/az/eresults
   - Purpose: obtain the initial page HTML which contains a select for exam years (this page is parsed offscreen with `extractExamYears`).
3. Offscreen parse `initialHtml` → `extractExamYears` to get a list of available years.
4. Select `selectedYear` (the code picks `years[0]`, presuming the list is sorted descending — the latest year).
5. POST https://kabinet.unec.edu.az/az/evadata
   - Form: `type=Evaluation_eyear&id={selectedYear.value}&current=false` (Content-Type: `application/x-www-form-urlencoded`, header `X-Requested-With: XMLHttpRequest`)
   - Purpose: returns HTML option nodes for semesters in that exam year; parsed via `extractExamSemesters`.
6. Offscreen parse `semesterHtml` → `extractExamSemesters` to obtain semester options.
7. Select `selectedSemester`: prefer a semester whose text includes `"II semestr"`; fallback is first semester returned.
8. GET https://kabinet.unec.edu.az/az/eresults?eyear={value}&term={value}&examType=
   - Purpose: fetch the final exam results HTML for the selected year and term; parsed via `extractExamResults`.
9. Offscreen parse final `resultsHtml` → `extractExamResults` to obtain structured exam results.
10. Store resulting object in `STORAGE_KEYS.EXAM_RESULTS` and timestamp in `STORAGE_KEYS.LAST_EXAM_FETCH_TIME`.

Alternative (fetchExamResultsForYearAndSemester)
- If the frontend calls `fetchExamResultsForYearAndSemester`, the background skips steps 2-6 and directly calls:
  - `GET /az/eresults?eyear={value}&term={value}&examType=` and runs `extractExamResults` on the HTML. This reduces the request count to 1 for this flow.

Number of Requests (exam-only)
- Full auto flow (fetchExamResults): 3 network requests:
  - 1 GET /az/eresults
  - 1 POST /az/evadata
  - 1 GET /az/eresults?eyear=...&term=... (final list)
- Direct year/semester fetch (fetchExamResultsForYearAndSemester): 1 network request (the final GET only).

Error Handling & Edge Cases
- If no exam years or no exam semesters are found, the code throws and returns an error result with `success: false`.
- If the `content.js` is not available or fails to fetch, the background returns an error advising the user to refresh the page.
- Parsing and timeout: the offscreen parse request has a 10s timeout configured; if the parse does not return in time, it throws.

Offscreen parsing tasks
- `extractExamYears` — parse `#Evaluation_eyear` select options into an array of `{ value, text }`.
- `extractExamSemesters` — parse `<option>` nodes to gather semester options.
- `extractExamResults` — parse `#eresults-grid` table rows into structured result objects: { subject, score, type, date }.

References (functions & handlers)
- Handler: `chrome.runtime.onMessage` case `fetchExamResults` → calls `fetchExamResults(tabId)`
- Function: `fetchExamResults(tabId)` — orchestrates the GET/POST GET sequence, parsing and selection logic.
- Handler: `fetchExamResultsForYearAndSemester` → calls `fetchExamResultsForYearAndSemester(tabId, yearValue, semesterValue)`.

---

If you'd like, I can add a short log snippet or point to exact line numbers inside `background.js` where the flow is implemented (e.g., where `const eresultsUrl = new URL('eresults', BASE_AZ_URL).href;` is declared and used), and add a small diagram to visualize the flow.


