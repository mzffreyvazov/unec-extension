// offscreen.js
console.log("OFFSCREEN: Script loaded. DOMParser type:", typeof DOMParser);

chrome.runtime.onMessage.addListener(async (request) => {
    if (request.target !== 'offscreen_document') { // Ensure message is for offscreen
        // console.log("OFFSCREEN: Message not for offscreen, ignoring.", request);
        return false; // Indicate that we are not handling this message asynchronously
    }

    console.log("OFFSCREEN: Message received", request.action, "Task:", request.task);

    if (request.action === 'parseHTMLTask') {
        const { htmlString, task, originalRequestId } = request;
        let responsePayload = {
            action: 'parseHTMLResult',
            source: 'offscreen_document',
            originalRequestId: originalRequestId,
            success: false, // Default to false
            data: null,
            error: null
        };

        try {
            if (typeof DOMParser === 'undefined') {
                console.error("OFFSCREEN: DOMParser is UNDEFINED even in offscreen document!");
                throw new Error("DOMParser is critically unavailable in the offscreen document context.");
            }
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlString, "text/html");
            console.log("OFFSCREEN: HTML parsed successfully with DOMParser.");

            if (task === 'extractYears') {
                const yearOptionsElements = doc.querySelectorAll('#eduYear option');
                let years = [];
                if (yearOptionsElements && yearOptionsElements.length > 0) {
                    years = Array.from(yearOptionsElements)
                        .filter(opt => opt.value && opt.value.trim() !== "") // Ensure value exists
                        .map(opt => ({ value: opt.value, text: opt.textContent.trim() }))
                        .sort((a, b) => { // Sort numerically by the year part of the text, newer first
                            const yearA = parseInt(a.text.split(' - ')[0]);
                            const yearB = parseInt(b.text.split(' - ')[0]);
                            return yearB - yearA;
                        });
                }
                responsePayload.data = years;
                responsePayload.success = true;
                console.log("OFFSCREEN: Years extracted:", years.length);
            } else if (task === 'extractEvaluationLinkHref') {
                const evalLinkElement = doc.querySelector('.sidebar-menu a[href*="/studentEvaluation"]');
                if (!evalLinkElement) {
                    throw new Error("OFFSCREEN: Could not find 'Elektron Jurnal' link in the provided HTML.");
                }
                responsePayload.data = evalLinkElement.getAttribute('href'); // Send back the raw href
                responsePayload.success = true;
                console.log("OFFSCREEN: Evaluation link href extracted:", responsePayload.data);
            } else {
                console.warn("OFFSCREEN: Unknown task:", task);
                throw new Error(`Unknown parsing task received: ${task}`);
            }
        } catch (e) {
            console.error("OFFSCREEN: Error during parsing task:", task, e);
            responsePayload.error = e.message;
            responsePayload.success = false;
        }
        chrome.runtime.sendMessage(responsePayload);
    }
    // Return true if you intend to use sendResponse asynchronously,
    // but here sendMessage is called synchronously within the handler block.
    // However, to be safe with potential async operations inside try/catch, let's return true.
    return true;
});