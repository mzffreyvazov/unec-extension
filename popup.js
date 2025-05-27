// popup.js
document.addEventListener('DOMContentLoaded', () => {
    const loadDataBtn = document.getElementById('loadDataBtn');
    const loadingDiv = document.getElementById('loading');
    const errorDiv = document.getElementById('error');

    const selectedYearContainer = document.getElementById('selected-year-container');
    const selectedYearText = document.getElementById('selectedYearText');

    const semestersContainer = document.getElementById('semesters-container');
    const semestersList = document.getElementById('semestersList');

    // Optional: for displaying all years for reference
    // const allYearsContainer = document.getElementById('all-years-container');
    // const allYearsList = document.getElementById('allYearsList');

    loadDataBtn.addEventListener('click', async () => {
        console.log("POPUP: 'Load Year & Semesters' button clicked.");
        loadingDiv.style.display = 'block';
        errorDiv.style.display = 'none';
        selectedYearContainer.style.display = 'none';
        semestersContainer.style.display = 'none';
        // if (allYearsContainer) allYearsContainer.style.display = 'none';
        semestersList.innerHTML = '';
        // if (allYearsList) allYearsList.innerHTML = '';
        loadDataBtn.disabled = true;

        try {
            const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!currentTab || !currentTab.id) {
                showError("POPUP: Could not get current tab information.");
                resetButton();
                return;
            }
            console.log("POPUP: Sending 'fetchYearsAndSemesters' to background. Tab ID:", currentTab.id);

            const response = await chrome.runtime.sendMessage({
                action: "fetchYearsAndSemesters", // New action
                tabId: currentTab.id
            });

            console.log("POPUP: Response from background for 'fetchYearsAndSemesters':", response);

            if (chrome.runtime.lastError) {
                showError(`POPUP: Error from runtime: ${chrome.runtime.lastError.message}`);
            } else if (response && response.error) {
                showError(`POPUP: Background error: ${response.error}`);
            } else if (response && response.data) {
                const { selectedYear, semesters } = response.data;

                if (selectedYear) {
                    selectedYearText.textContent = `${selectedYear.text} (ID: ${selectedYear.value})`;
                    selectedYearContainer.style.display = 'block';
                } else {
                    showError("POPUP: No academic year was selected or found by background.");
                }

                // Optional: Display all years if needed for reference
                // if (response.data.allYears && allYearsList) {
                //     displayList(response.data.allYears, allYearsList, "academic year reference");
                //     if (allYearsContainer) allYearsContainer.style.display = 'block';
                // }

                if (semesters && Array.isArray(semesters)) {
                    if (semesters.length > 0) {
                        displayList(semesters, semestersList, "semester");
                        semestersContainer.style.display = 'block';
                    } else {
                        showError("POPUP: No semesters were found for the selected academic year.");
                    }
                } else if (selectedYear) { // Only show "no semesters" if a year was processed
                     showError("POPUP: Semesters data is missing or not an array.");
                }

            } else {
                showError("POPUP: Unexpected response structure. Check background console.");
            }
        } catch (err) {
            console.error("POPUP: Error in click handler:", err);
            showError(`POPUP: Client-side error: ${err.message}`);
        } finally {
            loadingDiv.style.display = 'none';
            resetButton();
        }
    });

    function showError(message) {
        console.log("POPUP: Displaying error - ", message);
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }

    function resetButton() {
        loadDataBtn.disabled = false;
    }

    function displayList(items, listElement, itemTypeLabel) {
        listElement.innerHTML = ''; // Clear previous
        items.forEach(item => {
            const listItem = document.createElement('li');
            listItem.textContent = `${item.text} (Value: ${item.value})`;
            listElement.appendChild(listItem);
        });
    }
});