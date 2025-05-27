// offscreen.js
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
            // For semesters, the htmlString might just be options, not a full document or select tag
            // So, we might need to wrap it to parse it correctly if it's just option tags.
            let effectiveHtmlString = htmlString;
            if (task === 'extractSemesters' && !htmlString.trim().toLowerCase().startsWith('<select')) {
                // If it doesn't look like a select element, wrap it so querySelectorAll works on options
                effectiveHtmlString = `<select>${htmlString}</select>`;
                console.log("OFFSCREEN (extractSemesters): Wrapped HTML string for parsing options.");
            }

            const doc = parser.parseFromString(effectiveHtmlString, "text/html");
            console.log("OFFSCREEN: HTML parsed for task:", task);

            if (task === 'extractYears') {
                const yearOptionsElements = doc.querySelectorAll('#eduYear option'); // From full page
                let years = [];
                if (yearOptionsElements && yearOptionsElements.length > 0) {
                    years = Array.from(yearOptionsElements)
                        .filter(opt => opt.value && opt.value.trim() !== "")
                        .map(opt => ({ value: opt.value, text: opt.textContent.trim() }))
                        .sort((a, b) => {
                            const yearA = parseInt(a.text.split(' - ')[0]);
                            const yearB = parseInt(b.text.split(' - ')[0]);
                            return yearB - yearA;
                        });
                }
                responsePayload.data = years;
                responsePayload.success = true;
            } else if (task === 'extractEvaluationLinkHref') {
                const evalLinkElement = doc.querySelector('.sidebar-menu a[href*="/studentEvaluation"]'); // From full page
                if (!evalLinkElement) throw new Error("OFFSCREEN: Could not find 'Elektron Jurnal' link.");
                responsePayload.data = evalLinkElement.getAttribute('href');
                responsePayload.success = true;
            } else if (task === 'extractSemesters') {
                // Now querySelectorAll should work on the potentially wrapped 'select' or the original if it was a select
                const semesterOptionsElements = doc.querySelectorAll('option'); // Target options directly
                let semesters = [];
                if (semesterOptionsElements && semesterOptionsElements.length > 0) {
                    semesters = Array.from(semesterOptionsElements)
                        .filter(opt => opt.value && opt.value.trim() !== "")
                        .map(opt => ({ value: opt.value, text: opt.textContent.trim() }));
                    console.log(`OFFSCREEN (extractSemesters): Found ${semesterOptionsElements.length} options, mapped to ${semesters.length} semesters.`);
                } else {
                    console.warn("OFFSCREEN (extractSemesters): No 'option' elements found in the provided HTML string for semesters:", htmlString.substring(0,200));
                }
                responsePayload.data = semesters;
                responsePayload.success = true;
            } else if (task === 'extractSubjects') {
                const subjectRows = doc.querySelectorAll('#studentEvaluation-grid tbody tr:not(.empty)'); // From full page
                let subjects = [];
                 if (subjectRows && subjectRows.length > 0) {
                    subjectRows.forEach(row => { /* ... subject extraction ... */ });
                }
                responsePayload.data = subjects; responsePayload.success = true;
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