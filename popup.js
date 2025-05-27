document.addEventListener('DOMContentLoaded', () => {
    const loadYearsBtn = document.getElementById('loadYearsBtn');
    const loadingDiv = document.getElementById('loading');
    const errorDiv = document.getElementById('error');
    const yearsContainer = document.getElementById('years-container');
    const yearsList = document.getElementById('yearsList');

    loadYearsBtn.addEventListener('click', async () => {
        console.log("POPUP: Load Academic Years button clicked.");
        loadingDiv.style.display = 'block';
        errorDiv.style.display = 'none';
        yearsContainer.style.display = 'none';
        yearsList.innerHTML = '';
        loadYearsBtn.disabled = true;

        try {
            const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!currentTab || !currentTab.id) {
                showError("POPUP: Could not get current tab information.");
                resetButton();
                return;
            }
            console.log("POPUP: Current tab ID:", currentTab.id, "URL:", currentTab.url);

            const response = await chrome.runtime.sendMessage({
                action: "fetchAcademicYearsViaOffscreen",
                tabId: currentTab.id
            });

            console.log("POPUP: Response from background:", response);

            if (chrome.runtime.lastError) {
                showError(`POPUP: Error from runtime: ${chrome.runtime.lastError.message}`);
                return;
            }

            if (response.error) {
                showError(`POPUP: ${response.error}`);
            } else if (response.years && Array.isArray(response.years)) {
                if (response.years.length > 0) {
                    displayYears(response.years);
                } else {
                    showError("POPUP: No academic years were extracted by the background script.");
                }
            } else {
                showError("POPUP: Unexpected response or no academic years found. Check background console.");
            }
        } catch (err) {
            console.error("POPUP: Error in click handler:", err);
            showError(`POPUP: An error occurred: ${err.message}`);
        } finally {
            loadingDiv.style.display = 'none';
            resetButton();
        }
    });

    function showError(message) {
        console.log("POPUP: Displaying error - ", message)
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }

    function resetButton() {
        loadYearsBtn.disabled = false;
    }

    function displayYears(years) {
        console.log("POPUP: Displaying years:", years);
        years.forEach(year => {
            const listItem = document.createElement('li');
            listItem.textContent = `${year.text} (Value: ${year.value})`;
            yearsList.appendChild(listItem);
        });
        yearsContainer.style.display = 'block';
    }
});