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
            } else if (request.task === 'extractEvaluationLinkHref') { /* ... link logic ... */
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
                        // Expecting: 0:№, 1:ID(hidden), 2:Name, 3:Credit, 4:edu_form_id(hidden)
                        if (cells.length >= 5) { 
                            const idCell = cells[1];
                            const nameCell = cells[2];
                            const eduFormIdCell = cells[4]; 

                            const subjectId = idCell?.textContent?.trim();
                            const subjectName = nameCell?.textContent?.trim();
                            const eduFormId = eduFormIdCell?.textContent?.trim();

                            if (subjectId && subjectName && eduFormId) {
                                subjects.push({ id: subjectId, name: subjectName, eduFormId: eduFormId });
                            } else {
                                console.warn("OFFSCREEN: Missing data for subject row. ID:", subjectId, "Name:", subjectName, "eduFormId:", eduFormId);
                            }
                        }
                    });
                }
                responsePayload.data = subjects;
                responsePayload.success = true;
                console.log("OFFSCREEN: Subjects extracted count:", subjects.length, "Example subject:", subjects[0]);
            } else if (task === 'extractEvaluationDetails') { // Renamed from extractAttendancePercentage
                let attendancePercentage = null;
                let currentEvaluation = null;
                const finalEvalTable = doc.querySelector('#finalEval table');

                if (finalEvalTable) {
                    const headers = Array.from(finalEvalTable.querySelectorAll('thead th'));
                    const cariQHeaderExists = headers.some(th => th.textContent.trim() === "Cari qiymətləndirmə");
                    const qaibHeaderExists = headers.some(th => th.textContent.trim() === "Qaib faizi");

                    if (cariQHeaderExists && qaibHeaderExists) {
                        const dataRows = finalEvalTable.querySelectorAll('tbody tr');
                        if (dataRows.length > 0) {
                            const cells = dataRows[0].querySelectorAll('td');
                            if (cells.length >= 15) { // Need at least 15 cells for "Qaib faizi" at index 14
                                currentEvaluation = cells[9]?.textContent?.trim() || null; // 10th cell, index 9
                                attendancePercentage = cells[14]?.textContent?.trim() || null; // 15th cell, index 14
                            } else if (cells.length >= 10) { // Fallback if less than 15 but at least 10
                                currentEvaluation = cells[9]?.textContent?.trim() || null;
                                console.warn("OFFSCREEN: Not enough cells for 'Qaib faizi' (expected 15, got " + cells.length + "). 'Cari qiymətləndirmə' might be available.");
                            } else {
                                console.warn("OFFSCREEN: Not enough cells in data row for evaluation details. Cells found:", cells.length);
                            }
                        } else {
                            console.warn("OFFSCREEN: No data rows found in #finalEval table.");
                        }
                    } else {
                        console.warn("OFFSCREEN: Required headers ('Cari qiymətləndirmə' or 'Qaib faizi') not found in #finalEval table.");
                    }
                } else {
                    console.warn("OFFSCREEN: #finalEval table not found for evaluation details extraction.");
                }
                
                responsePayload.data = {
                    attendancePercentage: attendancePercentage,
                    currentEvaluation: currentEvaluation
                };
                responsePayload.success = true;
                console.log("OFFSCREEN: Evaluation details extracted:", responsePayload.data);
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