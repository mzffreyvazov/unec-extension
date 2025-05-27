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
    
    fetchAttendanceBtn.addEventListener('click', async () => {
        if (!currentSubjects || currentSubjects.length === 0) {
            showError("No subjects available to fetch attendance data");
            return;
        }
        
        fetchAttendanceBtn.disabled = true;
        attendanceLoadingDiv.style.display = 'block';
        errorDiv.style.display = 'none';
        
        try {
            // Update UI to show loading state for each subject
            currentSubjects.forEach(subject => {
                const subjectElement = document.getElementById(`subject-${subject.id}`);
                if (subjectElement) {
                    const attendanceSpan = subjectElement.querySelector('.attendance-value') || 
                                          document.createElement('span');
                    attendanceSpan.className = 'attendance-loading';
                    attendanceSpan.textContent = 'Loading...';
                    
                    if (!subjectElement.querySelector('.attendance-value')) {
                        subjectElement.appendChild(attendanceSpan);
                    }
                }
            });
            
            const response = await chrome.runtime.sendMessage({
                action: "fetchAllSubjectsEvaluation",
                subjects: currentSubjects
            });
            
            if (response.success && response.data) {
                // Update UI with attendance data
                Object.keys(response.data).forEach(subjectId => {
                    const result = response.data[subjectId];
                    const subjectElement = document.getElementById(`subject-${subjectId}`);
                    
                    if (subjectElement) {
                        const attendanceSpan = subjectElement.querySelector('.attendance-loading') || 
                                              subjectElement.querySelector('.attendance-value') ||
                                              document.createElement('span');
                        
                        if (result.success) {
                            const attendance = result.attendancePercentage;
                            attendanceSpan.textContent = `${attendance}%`;
                            attendanceSpan.className = 'attendance-value';
                            
                            // Highlight high absence rate
                            if (parseInt(attendance) > 15) {
                                attendanceSpan.classList.add('high');
                            }
                        } else {
                            attendanceSpan.textContent = 'Error';
                            attendanceSpan.className = 'attendance-value error';
                        }
                        
                        if (!subjectElement.querySelector('.attendance-value')) {
                            subjectElement.appendChild(attendanceSpan);
                        }
                    }
                });
            } else {
                showError(response.error || "Failed to fetch attendance data");
            }
        } catch (error) {
            console.error("Error fetching attendance data:", error);
            showError(`Error: ${error.message}`);
        } finally {
            attendanceLoadingDiv.style.display = 'none';
            fetchAttendanceBtn.disabled = false;
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
        
        if (itemTypeLabel === "subject") {
            // Store the subjects for attendance fetching
            currentSubjects = items;
            
            // Show fetch attendance button if subjects are available
            fetchAttendanceBtn.style.display = items.length > 0 ? 'block' : 'none';
            
            items.forEach(item => {
                const listItem = document.createElement('li');
                listItem.id = `subject-${item.id}`;
                listItem.className = 'subject-item';
                
                const nameSpan = document.createElement('span');
                nameSpan.className = 'subject-name';
                nameSpan.textContent = `${item.name} (ID: ${item.id})`;
                
                listItem.appendChild(nameSpan);
                listElement.appendChild(listItem);
            });
        } else { // for years and semesters
            items.forEach(item => {
                const listItem = document.createElement('li');
                listItem.textContent = `${item.text} (Value: ${item.value})`;
                listElement.appendChild(listItem);
            });
        }
    }
});