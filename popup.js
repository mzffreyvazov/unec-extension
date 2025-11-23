// popup.js
document.addEventListener('DOMContentLoaded', () => {
    const loadingDiv = document.getElementById('loading');
    const errorDiv = document.getElementById('error');

    const subjectsList = document.getElementById('subjectsList');
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
                displayAcademicData(academicResponse.data, academicResponse.subjectEvaluations || {}, academicResponse.seminarGrades || {}, true);
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
                            displayAcademicData(response.data, response.subjectEvaluations || {}, response.seminarGrades || {});
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
    function displayAcademicData(data, subjectEvaluations = {}, seminarGrades = {}, fromCache = false) {
        const { subjects } = data;

        if (subjects && Array.isArray(subjects) && subjects.length > 0) {
            currentSubjects = subjects;
            document.getElementById('subjects-count').textContent = `Fənlər (${subjects.length})`;
            displaySubjectCards(subjects, subjectEvaluations, seminarGrades);
        }
    }

    // Function to display subject cards with new design
    function displaySubjectCards(subjects, subjectEvaluations, seminarGrades) {
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
                // Show latest 3 seminar grades
                const latestGrades = seminarResult.grades.slice(0, 3);
                seminarBadges = latestGrades.map(grade => 
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
                            <span class="stat-label">Cari Q.</span>
                            <span class="stat-value">${cariQ}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Qaib %</span>
                            <span class="stat-value${qaibClass}">${qaibPercent}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Qaib Sayı</span>
                            <span class="stat-value">-</span>
                        </div>
                    </div>
                </div>
                <div class="card-footer">
                    <span class="footer-label">Seminarlar</span>
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