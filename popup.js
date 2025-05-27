// popup.js
document.addEventListener('DOMContentLoaded', () => {
    const loadDataBtn = document.getElementById('loadDataBtn');
    const loadingDiv = document.getElementById('loading');
    const errorDiv = document.getElementById('error');

    const selectedYearContainer = document.getElementById('selected-year-container');
    const selectedYearText = document.getElementById('selectedYearText');

    const semestersContainer = document.getElementById('semesters-container');
    const selectedSemesterText = document.getElementById('selectedSemesterText'); // Added
    const semestersList = document.getElementById('semestersList');

    const subjectsContainer = document.getElementById('subjects-container'); // Added
    const subjectsList = document.getElementById('subjectsList');       // Added

    loadDataBtn.addEventListener('click', async () => {
        console.log("POPUP: 'Load Data' button clicked.");
        loadingDiv.style.display = 'block';
        errorDiv.style.display = 'none';
        selectedYearContainer.style.display = 'none';
        semestersContainer.style.display = 'none';
        subjectsContainer.style.display = 'none'; // Added
        semestersList.innerHTML = '';
        subjectsList.innerHTML = '';              // Added
        loadDataBtn.disabled = true;

        try {
            const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!currentTab || !currentTab.id) {
                showError("POPUP: Could not get current tab information.");
                resetButton();
                return;
            }
            // Action name remains the same, background will do more steps
            const actionToDispatch = "fetchFullAcademicData"; // Updated action name for clarity
            console.log(`POPUP: Sending '${actionToDispatch}' to background. Tab ID:`, currentTab.id);


            const response = await chrome.runtime.sendMessage({
                action: actionToDispatch,
                tabId: currentTab.id
            });

            console.log(`POPUP: Response from background for '${actionToDispatch}':`, response);

            if (chrome.runtime.lastError) {
                showError(`POPUP: Error from runtime: ${chrome.runtime.lastError.message}`);
            } else if (response && response.error) {
                showError(`POPUP: Background error: ${response.error}`);
            } else if (response && response.data) {
                const { selectedYear, selectedSemester, semesters, subjects } = response.data; // Expect selectedSemester now

                if (selectedYear) {
                    selectedYearText.textContent = `${selectedYear.text} (ID: ${selectedYear.value})`;
                    selectedYearContainer.style.display = 'block';
                } else {
                    showError("POPUP: No academic year was selected/found.");
                }

                if (semesters && Array.isArray(semesters)) { // Display all available semesters
                    if (semesters.length > 0) {
                        displayList(semesters, semestersList, "semester");
                        // semestersContainer.style.display = 'block'; // Keep this hidden, show selected instead
                    } else {
                         // This might be normal if selectedYear has no semesters yet
                         console.warn("POPUP: No available semesters were returned for the selected year.");
                    }
                }
                // Display the selected semester
                if(selectedSemester) {
                    selectedSemesterText.textContent = `${selectedSemester.text} (ID: ${selectedSemester.value})`;
                    semestersContainer.style.display = 'block'; // Show the container if a semester is selected
                } else if (selectedYear) {
                    showError("POPUP: No semester was selected by the background script.");
                }


                if (subjects && Array.isArray(subjects)) {
                    if (subjects.length > 0) {
                        displayList(subjects, subjectsList, "subject");
                        subjectsContainer.style.display = 'block';
                    } else if (selectedSemester) { // Only show this if we expected subjects
                        showError("POPUP: No subjects were found for the selected year/semester.");
                    }
                } else if (selectedSemester) { // Only show this if we expected subjects
                     showError("POPUP: Subjects data is missing or not an array.");
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
        listElement.innerHTML = '';
        items.forEach(item => {
            const listItem = document.createElement('li');
            if (itemTypeLabel === "subject") {
                 listItem.textContent = `${item.name} (ID: ${item.id})`;
            } else { // for years and semesters
                listItem.textContent = `${item.text} (Value: ${item.value})`;
            }
            listElement.appendChild(listItem);
        });
    }
});