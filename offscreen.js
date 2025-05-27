// offscreen.js
// (Should be the same as message #17 - ensure 'extractSubjects' case is present and correct)
console.log("OFFSCREEN: Script loaded. DOMParser type:", typeof DOMParser);

chrome.runtime.onMessage.addListener(async (request) => {
    if (request.target !== 'offscreen_document') {
        return false;
    }
    console.log("OFFSCREEN: Message received", request.action, "Task:", request.task, "Req ID:", request.originalRequestId);

    if (request.action === 'parseHTMLTask') {
        const { htmlString, task, originalRequestId } = request;
        let responsePayload = {
            action: 'parseHTMLResult',
            source: 'offscreen_document',
            originalRequestId: originalRequestId,
            success: false, data: null, error: null
        };

        try {
            if (typeof DOMParser === 'undefined') throw new Error("DOMParser unavailable in offscreen.");
            const parser = new DOMParser();
            let effectiveHtmlString = htmlString;
            if (task === 'extractSemesters' && !htmlString.trim().toLowerCase().startsWith('<select')) {
                effectiveHtmlString = `<select>${htmlString}</select>`;
            }
            const doc = parser.parseFromString(effectiveHtmlString, "text/html");
            console.log("OFFSCREEN: HTML parsed for task:", task);

            if (task === 'extractYears') { /* ... years logic ... */
                const yearOptionsElements = doc.querySelectorAll('#eduYear option');
                let years = [];
                if (yearOptionsElements && yearOptionsElements.length > 0) {
                    years = Array.from(yearOptionsElements)
                        .filter(opt => opt.value && opt.value.trim() !== "")
                        .map(opt => ({ value: opt.value, text: opt.textContent.trim() }))
                        .sort((a, b) => { const yA = parseInt(a.text.split(' - ')[0]), yB = parseInt(b.text.split(' - ')[0]); return yB - yA; });
                }
                responsePayload.data = years; responsePayload.success = true;
            } else if (task === 'extractEvaluationLinkHref') { /* ... link logic ... */
                const evalLinkElement = doc.querySelector('.sidebar-menu a[href*="/studentEvaluation"]');
                if (!evalLinkElement) throw new Error("OFFSCREEN: Could not find 'Elektron Jurnal' link.");
                responsePayload.data = evalLinkElement.getAttribute('href'); responsePayload.success = true;
            } else if (task === 'extractSemesters') { /* ... semesters logic from message #17 ... */
                const semesterOptionsElements = doc.querySelectorAll('option'); // In wrapped or original select
                let semesters = [];
                if (semesterOptionsElements && semesterOptionsElements.length > 0) {
                    semesters = Array.from(semesterOptionsElements)
                        .filter(opt => opt.value && opt.value.trim() !== "")
                        .map(opt => ({ value: opt.value, text: opt.textContent.trim() }));
                }
                responsePayload.data = semesters; responsePayload.success = true;
                console.log("OFFSCREEN: Semesters extracted count:", semesters.length);
            } else if (task === 'extractSubjects') {
                const subjectRows = doc.querySelectorAll('#studentEvaluation-grid tbody tr:not(.empty)');
                let subjects = [];
                if (subjectRows && subjectRows.length > 0) {
                    subjectRows.forEach(row => {
                        const cells = row.querySelectorAll('td');
                        if (cells.length >= 3) { // Original HTML shows №, hidden ID, Name, Credit, Group
                            const idCell = cells[1];    // Hidden ID
                            const nameCell = cells[2];  // Subject Name
                            const subjectId = idCell?.textContent?.trim();
                            const subjectName = nameCell?.textContent?.trim();
                            if (subjectId && subjectName) {
                                subjects.push({ id: subjectId, name: subjectName });
                            }
                        }
                    });
                }
                responsePayload.data = subjects;
                responsePayload.success = true;
                console.log("OFFSCREEN: Subjects extracted count:", subjects.length);
            } else {
                throw new Error(`Unknown parsing task: ${task}`);
            }
        } catch (e) {
            console.error("OFFSCREEN: Error in task:", task, e);
            responsePayload.error = e.message;
        }
        chrome.runtime.sendMessage(responsePayload);
    }
    return true;
});