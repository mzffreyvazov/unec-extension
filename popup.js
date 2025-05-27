// popup.js
document.addEventListener('DOMContentLoaded', () => {
    const loadDataBtn = document.getElementById('loadDataBtn');
    const fetchAttendanceBtn = document.getElementById('fetchAttendanceBtn');
    const loadingDiv = document.getElementById('loading');
    const attendanceLoadingDiv = document.getElementById('attendanceLoading');
    const errorDiv = document.getElementById('error');

    const selectedYearContainer = document.getElementById('selected-year-container');
    const selectedYearText = document.getElementById('selectedYearText');

    const semestersContainer = document.getElementById('semesters-container');
    const selectedSemesterText = document.getElementById('selectedSemesterText'); // Added
    const semestersList = document.getElementById('semestersList');

    const subjectsContainer = document.getElementById('subjects-container'); // Added
    const subjectsList = document.getElementById('subjectsList');       // Added
    
    // Store subjects data globally for attendance fetching
    let currentSubjects = [];

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
                    selectedYearText.textContent = selectedYear.text; // Removed ID display
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
                    selectedSemesterText.textContent = selectedSemester.text; // Removed ID display
                    semestersContainer.style.display = 'block'; // Show the container if a semester is selected
                } else if (selectedYear) {
                    showError("POPUP: No semester was selected by the background script.");
                }


                if (subjects && Array.isArray(subjects)) {
                    if (subjects.length > 0) {
                        displayList(subjects, subjectsList, "subject");
                        subjectsContainer.style.display = 'block';
                        
                        // Automatically fetch attendance data after displaying subjects
                        await fetchAttendanceData();
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
    
    // Extract the attendance fetching logic into a separate function
    async function fetchAttendanceData() {
        if (!currentSubjects || currentSubjects.length === 0) {
            showError("No subjects available to fetch attendance data");
            return;
        }
        
        fetchAttendanceBtn.disabled = true;
        attendanceLoadingDiv.style.display = 'block';
        
        try {
            currentSubjects.forEach(subject => {
                const subjectElement = document.getElementById(`subject-${subject.id}`);
                if (subjectElement) {
                    const detailsContainer = subjectElement.querySelector('.subject-details-container');
                    if (detailsContainer) {
                        detailsContainer.innerHTML = `<span class="details-loading">Loading...</span>`; // Simplified loading text
                    }
                }
            });
            
            const response = await chrome.runtime.sendMessage({
                action: "fetchAllSubjectsEvaluation",
                subjects: currentSubjects
            });
            
            if (response.success && response.data) {
                Object.keys(response.data).forEach(subjectId => {
                    const result = response.data[subjectId];
                    const subjectElement = document.getElementById(`subject-${subjectId}`);
                    
                    if (subjectElement) {
                        const detailsContainer = subjectElement.querySelector('.subject-details-container');
                        if (!detailsContainer) { 
                            console.error("Details container not found for subject", subjectId);
                            return;
                        }
                        detailsContainer.innerHTML = ''; // Clear loading or previous content

                        const currentEvalSpan = document.createElement('span');
                        currentEvalSpan.className = 'current-evaluation-value';
                        
                        const attendanceSpan = document.createElement('span');
                        attendanceSpan.className = 'attendance-value';
                        
                        if (result.success && result.details) {
                            const { attendancePercentage, currentEvaluation } = result.details;
                            
                            currentEvalSpan.textContent = `Cari Q: ${currentEvaluation !== null ? currentEvaluation : 'N/A'}`;
                            if (currentEvaluation === null) {
                                currentEvalSpan.classList.add('error');
                            }
                            
                            attendanceSpan.textContent = `Qaib: ${attendancePercentage !== null ? attendancePercentage + '%' : 'N/A'}`;
                            if (attendancePercentage !== null && parseInt(attendancePercentage) > 15) {
                                attendanceSpan.classList.add('high');
                            } else if (attendancePercentage === null) {
                                attendanceSpan.classList.add('error');
                            }
                        } else {
                            currentEvalSpan.textContent = 'Cari Q: Error';
                            currentEvalSpan.classList.add('error');
                            attendanceSpan.textContent = 'Qaib: Error';
                            attendanceSpan.classList.add('error');
                            if (result.error) console.warn(`POPUP: Error for subject ${subjectId}: ${result.error}`);
                        }
                        detailsContainer.appendChild(currentEvalSpan); 
                        detailsContainer.appendChild(attendanceSpan);
                    }
                });
            } else {
                showError(response.error || "Failed to fetch all subjects' evaluation data");
                // Clear loading indicators from all if main fetch failed
                currentSubjects.forEach(subject => {
                    const subjectElement = document.getElementById(`subject-${subject.id}`);
                    if (subjectElement) {
                        const detailsContainer = subjectElement.querySelector('.subject-details-container');
                        if (detailsContainer) detailsContainer.innerHTML = '<span class="error">Failed to load</span>';
                    }
                });
            }
        } catch (error) {
            console.error("Error fetching attendance data:", error);
            showError(`Error: ${error.message}`);
        } finally {
            attendanceLoadingDiv.style.display = 'none';
            fetchAttendanceBtn.disabled = false;
        }
    }
    
    // Keep the manual fetch button for re-fetching if needed
    fetchAttendanceBtn.addEventListener('click', fetchAttendanceData);

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
        
        if (itemTypeLabel === "subject") {
            currentSubjects = items;
            fetchAttendanceBtn.style.display = items.length > 0 ? 'block' : 'none';
            
            items.forEach(item => {
                const listItem = document.createElement('li');
                listItem.id = `subject-${item.id}`;
                listItem.className = 'subject-item';
                
                const nameSpan = document.createElement('span');
                nameSpan.className = 'subject-name';
                nameSpan.textContent = item.name; // Removed ID display
                listItem.appendChild(nameSpan);

                const detailsContainer = document.createElement('div');
                detailsContainer.className = 'subject-details-container';
                // Details will be populated automatically after subjects are loaded
                listItem.appendChild(detailsContainer);
                
                listElement.appendChild(listItem);
            });
        } else { // for years and semesters
            items.forEach(item => {
                const listItem = document.createElement('li');
                listItem.textContent = item.text; // Removed value display
                listElement.appendChild(listItem);
            });
        }
    }
});