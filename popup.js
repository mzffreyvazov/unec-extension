// popup.js
document.addEventListener('DOMContentLoaded', () => {
    const loadingDiv = document.getElementById('loading');
    const errorDiv = document.getElementById('error');

    const subjectsList = document.getElementById('subjectsList');
    const examResultsList = document.getElementById('examResultsList');
    const yearSelect = document.getElementById('yearSelect');
    const semesterSelect = document.getElementById('semesterSelect');
    
    // Store subjects data globally
    let currentSubjects = [];
    let allYears = [];
    let allSemesters = [];
    let currentYear = null;
    let currentSemester = null;

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
                
                // Populate year dropdown if we have years
                if (academicResponse.allYears && academicResponse.allYears.length > 0) {
                    allYears = academicResponse.allYears;
                    populateYearDropdown(academicResponse.allYears, academicResponse.data.selectedYear);
                }
                
                displayAcademicData(
                    academicResponse.data, 
                    academicResponse.subjectEvaluations || {}, 
                    academicResponse.seminarGrades || {},
                    academicResponse.absenceCounts || {},
                    true
                );
            } else {
                console.log("POPUP: No cached academic data found");
                loadingDiv.style.display = 'block';
                loadingDiv.textContent = 'Məlumat yüklənir...';
                
                // Auto-fetch fresh data
                try {
                    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
                    if (currentTab?.url.includes('kabinet.unec.edu.az')) {
                        const response = await chrome.runtime.sendMessage({
                            action: "fetchFullAcademicData",
                            tabId: currentTab.id,
                            forceFresh: true
                        });
                        
                        if (response && response.data) {
                            // Populate year dropdown if we have years
                            if (response.allYears && response.allYears.length > 0) {
                                allYears = response.allYears;
                                populateYearDropdown(response.allYears, response.data.selectedYear);
                            }
                            
                            displayAcademicData(
                                response.data, 
                                response.subjectEvaluations || {}, 
                                response.seminarGrades || {},
                                response.absenceCounts || {}
                            );
                        }
                    }
                } catch (err) {
                    console.log("POPUP: Could not auto-fetch data:", err);
                } finally {
                    loadingDiv.style.display = 'none';
                }
            }
            
            // Check for cached exam results
            const examResponse = await chrome.runtime.sendMessage({
                action: "getCachedData", 
                dataType: "exam"
            });
            
            if (examResponse && examResponse.success && examResponse.data) {
                console.log("POPUP: Found cached exam results, displaying them");
                displayExamData(examResponse.data, true);
            } else {
                console.log("POPUP: No cached exam results found");
                
                // Auto-fetch exam results if academic data was available
                try {
                    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
                    if (currentTab?.url.includes('kabinet.unec.edu.az')) {
                        const examResult = await chrome.runtime.sendMessage({
                            action: "fetchExamResults"
                        });
                        
                        if (examResult && examResult.success && examResult.data) {
                            displayExamData(examResult.data);
                        }
                    }
                } catch (err) {
                    console.log("POPUP: Could not auto-fetch exam results:", err);
                }
            }
            
        } catch (error) {
            console.log("POPUP: No cached data available or error loading cache:", error.message);
            loadingDiv.style.display = 'none';
        }
    }

    // Function to display academic data with subject evaluations
    function displayAcademicData(data, subjectEvaluations = {}, seminarGrades = {}, absenceCounts = {}, fromCache = false) {
        const { subjects, selectedYear, selectedSemester, semesters } = data;

        // Store year and semester info
        if (selectedYear) {
            currentYear = selectedYear;
        }
        if (selectedSemester) {
            currentSemester = selectedSemester;
        }
        if (semesters) {
            allSemesters = semesters;
            populateSemesterDropdown(semesters, selectedSemester);
        }

        if (subjects && Array.isArray(subjects) && subjects.length > 0) {
            currentSubjects = subjects;
            document.getElementById('subjects-count').textContent = `Fənlər (${subjects.length})`;
            displaySubjectCards(subjects, subjectEvaluations, seminarGrades, absenceCounts);
        }
    }

    // Populate year dropdown
    function populateYearDropdown(years, selectedYear) {
        yearSelect.innerHTML = '<option value="">İl seçin...</option>';
        years.forEach(year => {
            const option = document.createElement('option');
            option.value = year.value;
            option.textContent = year.text;
            if (selectedYear && year.value === selectedYear.value) {
                option.selected = true;
            }
            yearSelect.appendChild(option);
        });
    }

    // Populate semester dropdown
    function populateSemesterDropdown(semesters, selectedSemester) {
        semesterSelect.innerHTML = '<option value="">Semestr seçin...</option>';
        semesters.forEach(semester => {
            const option = document.createElement('option');
            option.value = semester.value;
            option.textContent = semester.text;
            if (selectedSemester && semester.value === selectedSemester.value) {
                option.selected = true;
            }
            semesterSelect.appendChild(option);
        });
    }

    // Handle year selection change
    yearSelect.addEventListener('change', async () => {
        const selectedYearValue = yearSelect.value;
        if (!selectedYearValue) return;

        loadingDiv.style.display = 'block';
        loadingDiv.textContent = 'Semestrlər yüklənir...';
        
        // Clear semester dropdown while loading
        semesterSelect.innerHTML = '<option value="">Yüklənir...</option>';
        semesterSelect.disabled = true;

        try {
            const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!currentTab?.url.includes('kabinet.unec.edu.az')) {
                showError("Zəhmət olmasa kabinet.unec.edu.az səhifəsinə keçin");
                loadingDiv.style.display = 'none';
                semesterSelect.disabled = false;
                return;
            }

            const response = await chrome.runtime.sendMessage({
                action: "fetchSemestersForYear",
                yearValue: selectedYearValue,
                tabId: currentTab.id
            });

            if (response && response.success && response.semesters) {
                allSemesters = response.semesters;
                populateSemesterDropdown(response.semesters, null);
                semesterSelect.disabled = false;
                
                // Auto-select first semester WITHOUT triggering data fetch
                if (response.semesters.length > 0) {
                    const firstSemester = response.semesters.find(s => s.text.includes("II semestr") || s.text.includes("Payız")) || response.semesters[0];
                    semesterSelect.value = firstSemester.value;
                }
                
                loadingDiv.style.display = 'none';
            } else {
                semesterSelect.disabled = false;
                showError("Semestrlər tapılmadı");
                loadingDiv.style.display = 'none';
            }
        } catch (error) {
            console.error("POPUP: Error fetching semesters:", error);
            showError("Semestrlər yüklənərkən xəta baş verdi");
            semesterSelect.disabled = false;
            loadingDiv.style.display = 'none';
        }
    });

    // Handle semester selection change
    semesterSelect.addEventListener('change', async () => {
        const selectedYearValue = yearSelect.value;
        const selectedSemesterValue = semesterSelect.value;
        
        if (!selectedYearValue || !selectedSemesterValue) return;

        // Clear previous data
        subjectsList.innerHTML = '';
        document.getElementById('subjects-count').textContent = 'Fənlər';
        examResultsList.innerHTML = '';
        document.getElementById('exams-count').textContent = 'Nəticələr';
        
        loadingDiv.style.display = 'block';
        loadingDiv.textContent = 'Məlumatlar yüklənir...';

        try {
            const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!currentTab?.url.includes('kabinet.unec.edu.az')) {
                showError("Zəhmət olmasa kabinet.unec.edu.az səhifəsinə keçin");
                return;
            }

            const response = await chrome.runtime.sendMessage({
                action: "fetchDataForYearAndSemester",
                tabId: currentTab.id,
                yearValue: selectedYearValue,
                semesterValue: selectedSemesterValue
            });

            if (response && response.data) {
                displayAcademicData(
                    response.data,
                    response.subjectEvaluations || {},
                    response.seminarGrades || {},
                    response.absenceCounts || {}
                );
            }
            
            // Also fetch exam results for this year/semester
            try {
                const examResponse = await chrome.runtime.sendMessage({
                    action: "fetchExamResultsForYearAndSemester",
                    tabId: currentTab.id,
                    yearValue: selectedYearValue,
                    semesterValue: selectedSemesterValue
                });
                
                if (examResponse && examResponse.success && examResponse.data) {
                    displayExamData(examResponse.data);
                }
            } catch (examError) {
                console.error("POPUP: Error fetching exam results:", examError);
                // Don't show error to user, just log it
            }
        } catch (error) {
            console.error("POPUP: Error fetching data:", error);
            showError("Məlumatlar yüklənərkən xəta baş verdi");
        } finally {
            loadingDiv.style.display = 'none';
        }
    });

    // Function to display subject cards with new design
    function displaySubjectCards(subjects, subjectEvaluations, seminarGrades, absenceCounts) {
        subjectsList.innerHTML = '';
        
        // Sort subjects: high qaib (>20%) first, then others
        const sortedSubjects = [...subjects].sort((a, b) => {
            const aQaib = subjectEvaluations[a.id]?.details?.attendancePercentage;
            const bQaib = subjectEvaluations[b.id]?.details?.attendancePercentage;
            
            const aHigh = aQaib !== null && aQaib !== undefined && parseFloat(aQaib) > 20;
            const bHigh = bQaib !== null && bQaib !== undefined && parseFloat(bQaib) > 20;
            
            if (aHigh && !bHigh) return -1; // a comes first
            if (!aHigh && bHigh) return 1;  // b comes first
            return 0; // keep original order
        });
        
        sortedSubjects.forEach(subject => {
            const card = document.createElement('div');
            card.className = 'subject-card';
            card.id = `subject-${subject.id}`;
            
            const result = subjectEvaluations[subject.id];
            const credit = subject.credit || '-';
            const cariQ = result?.success && result?.details?.currentEvaluation !== null 
                ? result.details.currentEvaluation 
                : '-';
            const qaibPercent = result?.success && result?.details?.attendancePercentage !== null
                ? result.details.attendancePercentage + '%'
                : '-';
            
            // Get absence count (q/b count)
            const absenceResult = absenceCounts[subject.id];
            let qaibSayi = '-';
            
            if (absenceResult?.success && absenceResult?.totalCount !== undefined) {
                const currentAbsences = absenceResult.totalCount;
                
                // Calculate total allowed absences based on 25% threshold
                let totalAllowed = currentAbsences;
                
                if (result?.success && result?.details?.attendancePercentage !== null) {
                    const qaibPercValue = parseFloat(result.details.attendancePercentage);
                    
                    if (!isNaN(qaibPercValue) && qaibPercValue > 0 && currentAbsences > 0) {
                        // Calculate percentage per absence: qaibPercValue / currentAbsences
                        const percentPerAbsence = qaibPercValue / currentAbsences;
                        
                        // Calculate total allowed (25% threshold / percent per absence)
                        totalAllowed = Math.floor(25 / percentPerAbsence);
                    }
                }
                
                qaibSayi = `${currentAbsences}/${totalAllowed}`;
            }
            
            // Check if qaib > 20%
            let qaibClass = '';
            if (result?.success && result?.details?.attendancePercentage !== null) {
                const qaibVal = parseFloat(result.details.attendancePercentage);
                if (!isNaN(qaibVal) && qaibVal > 20) {
                    qaibClass = ' danger';
                }
            }
            
            // Get seminar grades for this subject
            const seminarResult = seminarGrades[subject.id];
            let seminarBadges = '';
            if (seminarResult?.success && seminarResult?.grades && seminarResult.grades.length > 0) {
                // Show all seminar grades
                seminarBadges = seminarResult.grades.map(grade => 
                    `<div class="seminar-badge">${grade.grade} <span class="seminar-date">(${grade.date})</span></div>`
                ).join('');
            } else {
                // Show placeholders if no grades
                seminarBadges = `
                    <div class="seminar-badge">-</div>
                    <div class="seminar-badge">-</div>
                    <div class="seminar-badge">-</div>
                `;
            }
            
            card.innerHTML = `
                <div class="card-header">
                    <div class="subject-name">${subject.name}</div>
                    <span class="credit-badge">${credit} Kredit</span>
                </div>
                <div class="card-body">
                    <div class="stats-grid">
                        <div class="stat-item">
                            <span class="stat-label">Cari Qiymətləndirmə</span>
                            <span class="stat-value">${cariQ}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Qaib %</span>
                            <span class="stat-value${qaibClass}">${qaibPercent}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Qaib Sayı</span>
                            <span class="stat-value">${qaibSayi}</span>
                        </div>
                    </div>
                </div>
                <div class="card-footer">
                    <span class="footer-label">Seminar Qiymətləri</span>
                    <div class="seminar-list">
                        ${seminarBadges}
                    </div>
                </div>
            `;
            
            subjectsList.appendChild(card);
        });
    }

    // Function to display exam data
    function displayExamData(data, fromCache = false) {
        const { examResults } = data;

        if (examResults && examResults.length > 0) {
            document.getElementById('exams-count').textContent = `Nəticələr (${examResults.length})`;
            displayExamResults(examResults);
        }
    }

    // Display exam results as cards
    function displayExamResults(examResults) {
        examResultsList.innerHTML = '';
        
        examResults.forEach(result => {
            const card = document.createElement('div');
            card.className = 'subject-card';
            
            card.innerHTML = `
                <div class="card-body result-body">
                    <div>
                        <div class="subject-name">${result.subject}</div>
                        <div class="exam-type">${result.type}</div>
                    </div>
                    <div class="score-box">${result.score}</div>
                </div>
            `;
            
            examResultsList.appendChild(card);
        });
    }

    // Load cached data when popup opens
    loadCachedDataOnOpen();

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
                    location.reload();
                }, 1500);
            } catch (error) {
                console.error("Failed to clear cache:", error);
            }
        }
    });

    function showError(message) {
        console.log("POPUP: Displaying error - ", message);
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }

    // Tab switching function
    function switchTab(tabName) {
        const buttons = document.querySelectorAll('.tab-btn');
        buttons.forEach(btn => btn.classList.remove('active'));
        
        if (tabName === 'akademik') {
            document.getElementById('tab-akademik').classList.add('active');
        } else {
            document.getElementById('tab-neticeler').classList.add('active');
        }
        
        document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active-view'));
        document.getElementById('view-' + tabName).classList.add('active-view');
    }

    // Add tab click event listeners
    document.getElementById('tab-akademik').addEventListener('click', () => switchTab('akademik'));
    document.getElementById('tab-neticeler').addEventListener('click', () => switchTab('neticeler'));
    
    // Add refresh button listener
    document.getElementById('refreshBtn').addEventListener('click', async () => {
        await chrome.runtime.sendMessage({ action: "clearCache" });
        location.reload();
    });
});