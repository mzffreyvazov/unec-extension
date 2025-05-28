// popup.js
document.addEventListener('DOMContentLoaded', () => {
    const loadDataBtn = document.getElementById('loadDataBtn');
    const loadExamResultsBtn = document.getElementById('loadExamResultsBtn');
    const loadingDiv = document.getElementById('loading');
    const errorDiv = document.getElementById('error');

    const selectedYearContainer = document.getElementById('selected-year-container');
    const selectedYearText = document.getElementById('selectedYearText');

    const semestersContainer = document.getElementById('semesters-container');
    const selectedSemesterText = document.getElementById('selectedSemesterText');
    const semestersList = document.getElementById('semestersList');

    const subjectsContainer = document.getElementById('subjects-container');
    const subjectsList = document.getElementById('subjectsList');

    const examResultsContainer = document.getElementById('exam-results-container');
    const examSelectedYearText = document.getElementById('examSelectedYearText');
    const examSelectedSemesterText = document.getElementById('examSelectedSemesterText');
    const examResultsLoading = document.getElementById('examResultsLoading');
    const examResultsList = document.getElementById('examResultsList');
    
    // Store subjects data globally
    let currentSubjects = [];

    // Try to load cached data when popup opens
    async function loadCachedDataOnOpen() {
        try {
            console.log("POPUP: Checking for cached data on popup open");
            
            // Check for cached academic data
            const academicResponse = await chrome.runtime.sendMessage({
                action: "getCachedData",
                dataType: "academic"
            });
            
            if (academicResponse && academicResponse.success && academicResponse.data) {
                console.log("POPUP: Found cached academic data, displaying it");
                displayAcademicData(academicResponse.data, academicResponse.subjectEvaluations || {}, true);
            } else {
                console.log("POPUP: No cached data found, will fetch fresh on user action");
            }
            
            // Check for cached exam results
            const examResponse = await chrome.runtime.sendMessage({
                action: "getCachedData", 
                dataType: "exam"
            });
            
            if (examResponse && examResponse.success && examResponse.data) {
                console.log("POPUP: Found cached exam results, displaying them");
                displayExamData(examResponse.data, true);
            }
            
        } catch (error) {
            console.log("POPUP: No cached data available or error loading cache:", error.message);
        }
    }

    // Function to display academic data with subject evaluations
    function displayAcademicData(data, subjectEvaluations = {}, fromCache = false) {
        const { selectedYear, selectedSemester, semesters, subjects } = data;

        if (fromCache) {
            showCacheIndicator("Keşləmədən yükləndi (30 dəqiqə keçərlı)", 'academic');
        }

        if (selectedYear) {
            selectedYearText.textContent = selectedYear.text;
            selectedYearContainer.style.display = 'block';
        }

        if (semesters && Array.isArray(semesters) && semesters.length > 0) {
            displayList(semesters, semestersList, "semester");
        }

        if (selectedSemester) {
            selectedSemesterText.textContent = selectedSemester.text;
            semestersContainer.style.display = 'block';
        }

        if (subjects && Array.isArray(subjects) && subjects.length > 0) {
            displayList(subjects, subjectsList, "subject");
            subjectsContainer.style.display = 'block';
            
            // Display subject evaluation data
            displaySubjectEvaluations(subjectEvaluations);
        }
    }

    // Function to display subject evaluations
    function displaySubjectEvaluations(subjectEvaluations) {
        currentSubjects.forEach(subject => {
            const subjectElement = document.getElementById(`subject-${subject.id}`);
            if (subjectElement) {
                const detailsContainer = subjectElement.querySelector('.subject-details-container');
                if (detailsContainer) {
                    const result = subjectEvaluations[subject.id];
                    
                    if (result) {
                        detailsContainer.innerHTML = '';

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
                        }
                        
                        detailsContainer.appendChild(currentEvalSpan);
                        detailsContainer.appendChild(attendanceSpan);
                    } else {
                        detailsContainer.innerHTML = `<span class="details-loading">Məlumat yoxdur</span>`;
                    }
                }
            }
        });
    }

    // Function to display exam data
    function displayExamData(data, fromCache = false) {
        const { selectedYear, selectedSemester, examResults } = data;

        if (fromCache) {
            showCacheIndicator("Keşləmədən yükləndi (30 dəqiqə keçərlı)", 'exam');
        }

        examSelectedYearText.textContent = selectedYear.text;
        examSelectedSemesterText.textContent = selectedSemester.text;

        if (examResults && examResults.length > 0) {
            displayExamResults(examResults);
            examResultsContainer.style.display = 'block';
        }
    }

    // Load cached data when popup opens
    loadCachedDataOnOpen();

    loadDataBtn.addEventListener('click', async () => {
        console.log("POPUP: 'Load Data' button clicked.");
        loadingDiv.style.display = 'block';
        errorDiv.style.display = 'none';
        selectedYearContainer.style.display = 'none';
        semestersContainer.style.display = 'none';
        subjectsContainer.style.display = 'none';
        semestersList.innerHTML = '';
        subjectsList.innerHTML = '';
        loadDataBtn.disabled = true;

        try {
            const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!currentTab || !currentTab.id) {
                showError("POPUP: Could not get current tab information.");
                resetButton();
                return;
            }
            
            if (!currentTab.url.includes('kabinet.unec.edu.az')) {
                showError("Please navigate to UNEC cabinet (kabinet.unec.edu.az) first.");
                resetButton();
                return;
            }

            // Always fetch fresh data when button is clicked
            const response = await chrome.runtime.sendMessage({
                action: "fetchFullAcademicData",
                tabId: currentTab.id,
                forceFresh: true
            });

            console.log(`POPUP: Response from background:`, response);

            if (chrome.runtime.lastError) {
                showError(`POPUP: Error from runtime: ${chrome.runtime.lastError.message}`);
            } else if (response && response.error) {
                showError(`POPUP: Background error: ${response.error}`);
            } else if (response && response.data) {
                displayAcademicData(response.data, response.subjectEvaluations || {}, response.fromCache);
            } else {
                showError("POPUP: Unexpected response structure. Check background console.");
            }
        } catch (err) {
            console.error("POPUP: Error in click handler:", err);
            if (err.message.includes("Content script") || err.message.includes("refresh the page")) {
                showError("İçerik skripti problemi. Səhifəni yeniləyib təkrar cəhd edin.");
            } else {
                showError(`POPUP: Client-side error: ${err.message}`);
            }
        } finally {
            loadingDiv.style.display = 'none';
            resetButton();
        }
    });
    
    loadExamResultsBtn.addEventListener('click', async () => {
        console.log("POPUP: 'Load Exam Results' button clicked.");
        examResultsLoading.style.display = 'block';
        errorDiv.style.display = 'none';
        examResultsContainer.style.display = 'none';
        loadExamResultsBtn.disabled = true;

        try {
            // Check current tab
            const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!currentTab?.url.includes('kabinet.unec.edu.az')) {
                showError("Please navigate to UNEC cabinet (kabinet.unec.edu.az) first.");
                return;
            }

            const response = await chrome.runtime.sendMessage({
                action: "fetchExamResults"
            });

            console.log("POPUP: Response from background for fetchExamResults:", response);

            if (response.success && response.data) {
                displayExamData(response.data, response.fromCache);
            } else {
                showError(response.error || "Failed to fetch exam results");
            }
        } catch (error) {
            console.error("POPUP: Error fetching exam results:", error);
            if (error.message.includes("Content script") || error.message.includes("refresh the page")) {
                showError("İçerik skripti problemi. Səhifəni yeniləyib təkrar cəhd edin.");
            } else {
                showError(`Error: ${error.message}`);
            }
        } finally {
            examResultsLoading.style.display = 'none';
            loadExamResultsBtn.disabled = false;
        }
    });

    // Add clear cache functionality
    document.addEventListener('keydown', async (e) => {
        // Clear cache with Ctrl+Shift+R
        if (e.ctrlKey && e.shiftKey && e.key === 'R') {
            e.preventDefault();
            try {
                await chrome.runtime.sendMessage({ action: "clearCache" });
                showError("Keş təmizləndi. Məlumatlar yenidən yüklənəcək.");
                setTimeout(() => {
                    errorDiv.style.display = 'none';
                }, 3000);
            } catch (error) {
                console.error("Failed to clear cache:", error);
            }
        }
    });

    function showCacheIndicator(message, type) {
        const indicator = document.createElement('div');
        indicator.className = 'cache-indicator';
        indicator.textContent = `📋 ${message}`;
        
        if (type === 'academic') {
            selectedYearContainer.insertBefore(indicator, selectedYearContainer.firstChild);
        } else if (type === 'exam') {
            examResultsContainer.insertBefore(indicator, examResultsContainer.firstChild);
        }
        
        // Remove indicator after 5 seconds
        setTimeout(() => {
            if (indicator.parentNode) {
                indicator.parentNode.removeChild(indicator);
            }
        }, 5000);
    }

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
            
            items.forEach(item => {
                const listItem = document.createElement('li');
                listItem.id = `subject-${item.id}`;
                listItem.className = 'subject-item';
                
                const nameSpan = document.createElement('span');
                nameSpan.className = 'subject-name';
                nameSpan.textContent = item.name;
                listItem.appendChild(nameSpan);

                const detailsContainer = document.createElement('div');
                detailsContainer.className = 'subject-details-container';
                detailsContainer.innerHTML = `<span class="details-loading">Yüklənir...</span>`;
                listItem.appendChild(detailsContainer);
                
                listElement.appendChild(listItem);
            });
        } else {
            items.forEach(item => {
                const listItem = document.createElement('li');
                listItem.textContent = item.text;
                listElement.appendChild(listItem);
            });
        }
    }

    function displayExamResults(examResults) {
        examResultsList.innerHTML = '';
        
        examResults.forEach(result => {
            const listItem = document.createElement('li');
            listItem.className = 'exam-result-item';
            
            const subjectSpan = document.createElement('span');
            subjectSpan.className = 'exam-subject-name';
            subjectSpan.textContent = result.subject;
            
            const detailsContainer = document.createElement('div');
            detailsContainer.className = 'exam-details-container';
            
            const scoreSpan = document.createElement('span');
            scoreSpan.className = 'exam-score';
            scoreSpan.textContent = `Score: ${result.score}`;
            
            const typeSpan = document.createElement('span');
            typeSpan.className = 'exam-type';
            typeSpan.textContent = result.type;
            
            detailsContainer.appendChild(scoreSpan);
            detailsContainer.appendChild(typeSpan);
            
            listItem.appendChild(subjectSpan);
            listItem.appendChild(detailsContainer);
            
            examResultsList.appendChild(listItem);
        });
    }
});