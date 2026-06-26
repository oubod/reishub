// js/app.js

// --- APP STATE ---
let currentUser = null;
let allLectures = null;
let currentLecture = null;
const mauritaniaLoginUrl = () => new URL('login.html', window.location.href).href;
let currentTrainingData = [];
let sessionTimerInterval = null;
let reviewData = { incorrectQuizzes: [], submittedQrocs: [] };
let deferredPrompt = null;
let completedQuizzes = new Set(); // Track completed quizzes in current session
let isOnline = navigator.onLine;
let offlineQueue = []; // Queue for actions when offline
let bookmarks = JSON.parse(localStorage.getItem('bookmarks') || '{}'); // Store bookmarked questions by lecture

// PDF.js Configuration for better performance
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Performance optimizations
const PDF_RENDER_OPTIONS = {
    enableWebGL: true,
    disableAutoFetch: false,
    disableStream: false,
    disableRange: false,
    disableFontFace: false,
    useSystemFonts: true,
    maxImageSize: 1024 * 1024, // 1MB max image size
    isEvalSupported: false,
    useWorkerFetch: true,
    stopAtErrors: false,
    maxLengthToCache: 50 * 1024 * 1024, // 50MB cache
    verbosity: 0 // Reduce console output
};

// PDF viewer state
let pdfDoc = null;
let pageNum = 1;
let scale = 1.0; // Start with 1.0 to show entire page
let pdfData = null;
let pageRendering = false;
let pageNumPending = null;
let renderTask = null;
let pageCache = new Map(); // Cache for rendered pages
let currentPdfResource = null;
let isRealExamMode = false;
let realExamMetadata = null;
let realExamSelectedLectures = new Set();
let printQuizzesSelectedLectures = new Set();

const GOOGLE_DRIVE_API_KEY = 'AIzaSyD5NE-Qc7sRN976Hn_nciDyCs2Tbe2VnI0';
const MEDNVAL_DRIVE_FOLDER_ID = '129NqVdNGvBMScdhSyqSVU3LV-_INyI0z';
const MEDNVAL_DRIVE_NAME = 'Drive';
const DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const DRIVE_LIST_FIELDS = 'nextPageToken, files(id, name, mimeType, modifiedTime, size, thumbnailLink, iconLink, webViewLink)';
const DRIVE_PAGE_SIZE = 1000;
const isDriveConfigured = () => GOOGLE_DRIVE_API_KEY && GOOGLE_DRIVE_API_KEY !== 'YOUR_GOOGLE_API_KEY' && MEDNVAL_DRIVE_FOLDER_ID && MEDNVAL_DRIVE_FOLDER_ID !== 'YOUR_MEDNVAL_DRIVE_FOLDER_ID';
let mednvalDriveState = {
    initialized: false,
    currentFolderId: MEDNVAL_DRIVE_FOLDER_ID,
    breadcrumb: [],
    items: []
};

const isGuestMode = () => Boolean(currentUser && currentUser.isGuest);

const getGuestAllowedLectureIds = () => {
    const allowed = new Set();
    if (!allLectures) return allowed;
    Object.keys(allLectures).forEach(category => {
        const first = (allLectures[category] || []).find(lecture => lecture && lecture.id);
        if (first) allowed.add(first.id);
    });
    return allowed;
};

const isLectureAllowedForGuest = (lectureId) => !isGuestMode() || getGuestAllowedLectureIds().has(lectureId);

const showGuestLockedMessage = () => {
    alert('Mode invite: creez un compte approuve pour debloquer tous les cours, quiz, examens et outils.');
};

const resetRealExamState = () => {
    isRealExamMode = false;
    realExamMetadata = null;
    realExamSelectedLectures = new Set();
};

const escapeHTML = (str = '') => str.replace(/[&<>"']/g, (match) => {
    const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return entities[match] || match;
});

const normalizeTrainingItem = (item = {}) => {
    if (item && Array.isArray(item.options)) {
        return {
            ...item,
            type: item.type || 'quiz',
            q: item.q || item.question || ''
        };
    }
    return item;
};

const isQuizItem = (item = {}) => item.type === 'quiz' || Array.isArray(item.options);

const getQuestionText = (item = {}) => item.q || item.question || '';

const getQuizOptions = (item = {}) => {
    if (Array.isArray(item.options)) {
        return item.options.map((option, index) => {
            if (typeof option === 'string') {
                return { id: String.fromCharCode(65 + index), text: option, correct: false };
            }
            return {
                id: option.id || String.fromCharCode(65 + index),
                text: option.text || option.label || '',
                correct: option.correct === true
            };
        }).filter(option => option.text);
    }

    if (Array.isArray(item.opts)) {
        return item.opts.map((option, index) => ({
            id: String.fromCharCode(65 + index),
            text: option,
            correct: option === item.a
        })).filter(option => option.text);
    }

    return [];
};

const getCorrectAnswers = (item = {}) => getQuizOptions(item).filter(option => option.correct).map(option => option.text);

const formatAnswerList = (answers = []) => {
    const values = Array.isArray(answers) ? answers : [answers];
    return values.filter(Boolean).join(' ; ') || 'Non repondu';
};

const sameAnswerSet = (selected, correct) => {
    const left = [...new Set(Array.isArray(selected) ? selected : [selected])].filter(Boolean).sort();
    const right = [...new Set(Array.isArray(correct) ? correct : [correct])].filter(Boolean).sort();
    return left.length === right.length && left.every((value, index) => value === right[index]);
};

const renderQuizInputs = (item, index, name) => {
    const options = getQuizOptions(item);
    const inputType = Array.isArray(item.options) ? 'checkbox' : 'radio';
    return options.map(option => `
        <label>
            <input type="${inputType}" name="${name}" value="${escapeHTML(option.text)}">
            <span>${escapeHTML(option.id)}. ${escapeHTML(option.text)}</span>
        </label>`).join('');
};

const formatDriveDate = (isoString) => {
    if (!isoString) return '';
    try {
        const date = new Date(isoString);
        return Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(date);
    } catch (error) {
        return '';
    }
};

const formatDriveSize = (bytes) => {
    if (!bytes) return '';
    const units = ['octets', 'Ko', 'Mo', 'Go', 'To'];
    let size = Number(bytes);
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
        size /= 1024;
        unit++;
    }
    return `${size.toFixed(size < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
};

// --- LOADER & UI FEEDBACK ---
const loader = document.getElementById('loader-overlay');
const showLoader = () => loader.classList.add('visible');
const hideLoader = () => loader.classList.remove('visible');

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    console.log('App initializing...');
    showLoader();
    
    try {
        if (window.portalAuthReady) await window.portalAuthReady;
        const profile = window.portalAuthProfile;
        const authUser = window.portalAuthUser;
        if (!profile || !authUser) return;
        currentUser = {
            id: authUser.id,
            email: authUser.email,
            username: profile.username || authUser.email?.split('@')[0] || 'Utilisateur',
            avatar_url: profile.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(authUser.email || 'User')}&backgroundColor=007AFF&textColor=FFFFFF&radius=50`,
            progress: profile.progress || {},
            isGuest: Boolean(profile.isGuest)
        };
        localStorage.setItem('hasLoggedInBefore', 'true');
        await setupApp();
        attachEventListeners();
    } catch (error) {
        console.error('Initialization error:', error);
        if (currentUser?.isGuest || localStorage.getItem('portalGuest') === 'mauritania') return;
        window.location.href = mauritaniaLoginUrl();
    } finally {
        hideLoader();
    }
});

// loadUserAndProgress function removed - no longer needed with guest access

const setupApp = async () => {
    setupPWA();
    setupPWAInstall();
    setupOfflineDetection();
    await loadLectures();
    if (allLectures) {
        const savedLectureId = sessionStorage.getItem('currentLectureId');
        if (savedLectureId) currentLecture = findLectureById(savedLectureId);
        if (currentLecture && !isLectureAllowedForGuest(currentLecture.id)) {
            currentLecture = null;
            sessionStorage.removeItem('currentLectureId');
        }
    }
    
    // Load progress from localStorage for guest users
    if (currentUser && currentUser.isGuest) {
        const localProgress = JSON.parse(localStorage.getItem('userProgress') || '{}');
        currentUser.progress = localProgress;
    }
    
    populateSidebar();
    renderSidebarProgress();
    updateProfileUI();
    
    // Initialize mobile enhancements
    enhanceTouchInteractions();
    
    // Automatically enter fullscreen mode
    requestFullscreenMode();
};

const loadLectures = async () => { 
    try { 
        const res = await fetch('data/lectures.json'); 
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`); 
        allLectures = await res.json(); 
        console.log('Successfully loaded lectures.json');
    } catch (e) { 
        console.error("Failed to load lectures:", e); 
    } 
};

const fetchTrainingData = async (url) => {
    if (!url) {
        console.error('No URL provided for training data');
        return [];
    }
    try {
        console.log(`Fetching training data from: ${url}`);
        const res = await fetch(url);
        if (!res.ok) {
            console.error(`Failed to fetch training data: ${res.status} ${res.statusText}`);
            return [];
        }
        const data = await res.json();
        console.log('Successfully loaded training data:', data);
        if (Array.isArray(data)) return data.map(normalizeTrainingItem);
        if (data && Array.isArray(data.questions)) return data.questions.map(normalizeTrainingItem);
        return [normalizeTrainingItem(data)]; // Ensure we always return an array
    } catch (e) {
        console.error(`Error loading training data from ${url}:`, e);
        return [];
    }
};

// --- EVENT HANDLERS ---
const attachEventListeners = () => {
    document.getElementById('menu-toggle').addEventListener('click', toggleSidebar);
    document.getElementById('fullscreen-toggle').addEventListener('click', toggleFullScreen);
    document.getElementById('nav-list').addEventListener('click', handleNavClick);
    document.getElementById('dashboard-grid-container').addEventListener('click', handleDashboardClick);
    document.getElementById('user-profile').addEventListener('click', openProfileModal);
    document.getElementById('install-btn').addEventListener('click', installPWA);
    document.getElementById('sidebar-overlay').addEventListener('click', closeSidebar);
    // Logout functionality removed - no authentication required
    document.body.addEventListener('click', handleModalEvents);
    document.getElementById('session-view').addEventListener('click', handleSessionViewEvents);
    document.getElementById('session-view').addEventListener('change', handleSessionViewChange);
    document.addEventListener('keydown', handlePdfKeyboard);
    document.addEventListener('keydown', handleGlobalKeyboard);
    
    const driveGrid = document.getElementById('mednval-drive-grid');
    if (driveGrid) driveGrid.addEventListener('click', handleDriveGridClick);

    const driveBreadcrumb = document.getElementById('mednval-drive-breadcrumb');
    if (driveBreadcrumb) driveBreadcrumb.addEventListener('click', handleDriveBreadcrumbClick);
    
    // Confirmation dialog event listeners
    document.getElementById('confirmation-cancel').addEventListener('click', hideConfirmationDialog);
    document.getElementById('confirmation-confirm').addEventListener('click', confirmAction);
    
    // Analytics back button - use event delegation
    document.body.addEventListener('click', (e) => {
        if (e.target.id === 'back-to-dash-from-analytics' || e.target.closest('#back-to-dash-from-analytics')) {
            e.preventDefault();
            showView('dashboard-view');
        }
    });
    
    // Bookmark actions in analytics
    document.body.addEventListener('click', (e) => {
        if (e.target.classList.contains('bookmark-view-btn')) {
            const lectureId = e.target.dataset.lectureId;
            const quizIndex = parseInt(e.target.dataset.quizIndex);
            // Navigate to the specific lecture and question
            const lecture = allLectures.find(l => l.id === lectureId);
            if (lecture) {
                currentLecture = lecture;
                showView('session-view');
                // TODO: Jump to specific question
            }
        } else if (e.target.classList.contains('bookmark-remove-btn-analytics')) {
            const lectureId = e.target.dataset.lectureId;
            const quizIndex = parseInt(e.target.dataset.quizIndex);
            removeBookmarkFromAnalytics(lectureId, quizIndex);
        }
    });
    
    // Scroll to top button
    const scrollToTopBtn = document.getElementById('scroll-to-top');
    if (scrollToTopBtn) {
        scrollToTopBtn.addEventListener('click', () => {
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
            triggerHapticFeedback('light');
        });
    }
    
    // Show/hide scroll to top button based on scroll position
    window.addEventListener('scroll', () => {
        const scrollToTopBtn = document.getElementById('scroll-to-top');
        if (scrollToTopBtn) {
            if (window.pageYOffset > 300) {
                scrollToTopBtn.style.display = 'flex';
            } else {
                scrollToTopBtn.style.display = 'none';
            }
        }
    });
};

function handleNavClick(e) {
    const link = e.target.closest('a');
    if (!link) return;
    e.preventDefault();
    const targetView = link.dataset.view;
    const lectureId = link.dataset.lectureId;

    document.querySelectorAll('#nav-list a.active').forEach(l => l.classList.remove('active'));

    if (isGuestMode() && targetView) {
        showGuestLockedMessage();
        return;
    }

    if (targetView === 'mednval-drive') {
        resetRealExamState();
        currentLecture = null;
        sessionStorage.removeItem('currentLectureId');
        link.classList.add('active');
        showMednvalDriveView();
        if (window.innerWidth <= 992) closeSidebar();
        return;
    }

    if (targetView === 'real-exam') {
        currentLecture = null;
        sessionStorage.removeItem('currentLectureId');
        link.classList.add('active');
        showRealExamView();
        if (window.innerWidth <= 992) closeSidebar();
        return;
    }

    if (!lectureId) return;
    if (!isLectureAllowedForGuest(lectureId)) {
        showGuestLockedMessage();
        return;
    }

    resetRealExamState();

    currentLecture = findLectureById(lectureId);
    if (!currentLecture) return;

    sessionStorage.setItem('currentLectureId', lectureId);
    link.classList.add('active');
    document.getElementById('lecture-title').textContent = currentLecture.title;
    document.getElementById('welcome-title').textContent = `Objectif: ${currentLecture.title}`;
    document.getElementById('welcome-subtitle').textContent = "Prêt à commencer votre révision ?";
    document.getElementById('dashboard-grid-container').style.display = 'grid';
    showView('dashboard-view');
    if (window.innerWidth <= 992) closeSidebar();
}

async function handleDashboardClick(e) {
    const card = e.target.closest('.action-card');
    if (!card || !currentLecture) return;
    if (isGuestMode() && !isLectureAllowedForGuest(currentLecture.id)) {
        showGuestLockedMessage();
        return;
    }
    
    const action = card.dataset.action;
    if (isGuestMode() && !['read-lecture', 'start-training'].includes(action)) {
        showGuestLockedMessage();
        return;
    }
    if (action === 'read-lecture') {
        if (currentLecture.pdf) {
            // Show PDF choice modal instead of directly downloading
            openPdfChoiceModal();
        } else alert('Document non disponible pour ce cours.');
    } else if (action === 'read-summary') {
        if (currentLecture.summary) window.open(currentLecture.summary, '_blank');
        else alert('Résumé non disponible pour ce cours.');
    } else if (action === 'start-training') {
        openExamChoiceModal();
    } else if (action === 'print-quizzes') {
        if (currentLecture) {
            generatePrintQuizzesPdfForCurrentLecture();
        } else {
            alert('Veuillez sélectionner un objectif d\'abord.');
        }
    } else if (action === 'view-analytics') {
        showAnalyticsView();
    }
}

function handleSessionViewEvents(e) {
    const target = e.target.closest('button, label');
    if (!target) return;

    if (target.id === 'real-exam-select-all') {
        e.preventDefault();
        selectAllRealExamLectures();
    } else if (target.id === 'real-exam-clear-all') {
        e.preventDefault();
        clearAllRealExamLectures();
    } else if (target.id === 'real-exam-start-btn') {
        e.preventDefault();
        const selectedLectureIds = Array.from(realExamSelectedLectures);
        if (!selectedLectureIds.length) {
            alert('Veuillez sélectionner au moins un objectif avant de démarrer l\'examen.');
            return;
        }
        startRealExam(selectedLectureIds);
    } else if (target.id === 'abort-exam-btn') {
        e.preventDefault();
        showConfirmationDialog(
            'Abandonner l\'examen',
            'Êtes-vous sûr de vouloir abandonner cet examen ? Votre progression ne sera pas enregistrée.',
            () => {
                // Clear the timer
                if (sessionTimerInterval) {
                    clearInterval(sessionTimerInterval);
                    sessionTimerInterval = null;
                }
                // Return to dashboard
                showView('dashboard-view');
                // Show a message to the user
                showToast('Examen annulé', 'Votre progression n\'a pas été enregistrée', 'warning');
            }
        );
    } else if (target.matches('.practice-validate-btn')) {
        e.preventDefault();
        const form = target.closest('form');
        const selected = Array.from(form.querySelectorAll('input[name^="answer"]:checked')).map(input => input.value);
        const feedback = form.querySelector('.feedback');
        const quizIndex = Array.from(document.querySelectorAll('.question-card')).indexOf(form);
        const quizItem = currentTrainingData[quizIndex];
        const correctAnswers = getCorrectAnswers(quizItem);

        
        if (selected.length > 0) {
            const isCorrect = sameAnswerSet(selected, correctAnswers);
            feedback.textContent = isCorrect ? 'Correct !' : `Incorrect. La réponse correcte était : ${formatAnswerList(correctAnswers)}`;
            feedback.className = `feedback ${isCorrect ? 'correct' : 'incorrect'}`;
            
            // Add haptic feedback
            triggerHapticFeedback(isCorrect ? 'success' : 'error');
            
            // Mark quiz as completed (regardless of correctness)
            completedQuizzes.add(quizIndex);
            
            // Check if all quizzes are completed
            checkAllQuizzesCompleted();
        } else {
            feedback.textContent = "Veuillez choisir une réponse.";
            feedback.className = 'feedback incorrect';
            triggerHapticFeedback('warning');
        }
        feedback.style.display = 'block';
    } else if (target.matches('.practice-show-answer-btn')) {
        e.preventDefault();
        const answerDiv = document.getElementById(target.dataset.target);
        if (answerDiv) {
            answerDiv.style.display = 'block';
            target.style.display = 'none';
        }
    } else if (target.matches('label')) {
        // Style selected quiz choices
        const parentOptions = target.closest('.quiz-options');
        if (parentOptions) {
            parentOptions.querySelectorAll('label').forEach(label => {
                const input = label.querySelector('input');
                label.classList.toggle('selected', Boolean(input && input.checked));
            });
        }
    } else if (target.id === 'finish-exam-btn') endExamSession();
    else if (target.id === 'review-answers-btn') renderReviewView();
    else if (target.id === 'print-real-exam-btn') {
        e.preventDefault();
        printRealExamAsPdf();
    }
    else if (target.id === 'back-to-dash-btn') {
        if (isRealExamMode) resetRealExamState();
        showView('dashboard-view');
    }
    else if (target.id === 'back-to-dash-from-analytics') showView('dashboard-view');
    else if (target.matches('.bookmark-btn')) toggleBookmark(target);
    else if (target.matches('.bookmark-remove-btn')) {
        const lectureId = target.dataset.lectureId;
        const quizIndex = parseInt(target.dataset.quizIndex);
        removeBookmark(lectureId, quizIndex);
    }
}

function handleSessionViewChange(e) {
    const input = e.target;
    if (!input) return;
    
    if (input.name === 'real-exam-lecture') {
        if (input.checked) realExamSelectedLectures.add(input.value);
        else realExamSelectedLectures.delete(input.value);
        updateRealExamSelectionSummary();
    } else if (input.name === 'print-quizzes-lecture') {
        updatePrintQuizzesSelection();
    }
}

function handleModalEvents(e) {
    // Exam choice modal
    if (e.target.matches('#close-choice-modal, #close-choice-modal *')) closeExamChoiceModal();
    const choiceBtn = e.target.closest('.modal-choice-btn');
    if (choiceBtn) {
        const mode = choiceBtn.dataset.mode;
        const duration = choiceBtn.dataset.duration || null;
        closeExamChoiceModal();
        startSession(mode, duration);
    }
    
    // PDF choice modal
    if (e.target.matches('#close-pdf-choice-modal, #close-pdf-choice-modal *')) closePdfChoiceModal();
    if (e.target.id === 'download-pdf-btn') downloadPdf();
    if (e.target.id === 'open-pdf-viewer-btn') openPdfViewer();
    
    // Print quizzes modal
    if (e.target.matches('#close-print-quizzes-modal, #close-print-quizzes-modal *')) closePrintQuizzesModal();
    if (e.target.id === 'print-quizzes-select-all') {
        e.preventDefault();
        selectAllPrintQuizzesLectures();
    }
    if (e.target.id === 'print-quizzes-clear-all') {
        e.preventDefault();
        clearAllPrintQuizzesLectures();
    }
    if (e.target.id === 'print-quizzes-generate-btn') {
        e.preventDefault();
        generatePrintQuizzesPdf();
    }
    
    // PDF viewer modal
    if (e.target.id === 'pdf-back-btn' || e.target.closest('#pdf-back-btn')) closePdfViewer();
    if (e.target.id === 'pdf-prev-page') goToPrevPage();
    if (e.target.id === 'pdf-next-page') goToNextPage();
    if (e.target.id === 'pdf-zoom-in') zoomIn();
    if (e.target.id === 'pdf-zoom-out') zoomOut();
    if (e.target.id === 'pdf-reset-zoom') resetZoom();
    if (e.target.id === 'pdf-download') downloadPdfFromViewer();
    if (e.target.id === 'pdf-fullscreen') togglePdfFullscreen();
    
    // Close modals when clicking overlay
    const profileModal = e.target.closest('.modal-box');
    const pdfViewerModal = e.target.closest('.pdf-viewer-container');
    if (e.target.matches('.modal-overlay') && !profileModal && !pdfViewerModal) {
        document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('visible'));
    }
    if (e.target.matches('.close-modal-btn, .close-modal-btn *')) {
        closeProfileModal();
    }
    if (e.target.matches('#logout-btn, #logout-btn *')) {
        handleLogout();
    }
}

// Mobile touch events for PDF viewer
let touchStartX = 0;
let touchStartY = 0;

const initMobileTouchEvents = () => {
    const pdfCanvas = document.getElementById('pdf-canvas');
    if (!pdfCanvas) return;

    pdfCanvas.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    });

    pdfCanvas.addEventListener('touchend', (e) => {
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        const deltaX = touchStartX - touchEndX;
        const deltaY = touchStartY - touchEndY;

        // Horizontal swipe for page navigation
        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
            if (deltaX > 0 && pageNum < pdfDoc.numPages) {
                // Swipe left - next page
                pageNum++;
                renderPdfPage(pageNum);
                updatePageButtons();
            } else if (deltaX < 0 && pageNum > 1) {
                // Swipe right - previous page
                pageNum--;
                renderPdfPage(pageNum);
                updatePageButtons();
            }
        }
    });

    // Prevent default zoom behavior on double tap
    pdfCanvas.addEventListener('touchend', (e) => {
        e.preventDefault();
    }, { passive: false });
};

// --- SESSION (PRACTICE/EXAM) LOGIC ---

async function startSession(mode, durationInMinutes = null) {
    resetRealExamState();
    showLoader();
    
    // Reset completed quizzes tracking for new session
    completedQuizzes.clear();
    
    // Show skeleton loading while fetching data
    showView('session-view');
    renderSkeletonLoader();
    
    console.log(`Starting session for lecture: ${currentLecture.id} (${currentLecture.title})`);
    console.log(`Training data URL: ${currentLecture.training}`);
    
    try {
        currentTrainingData = await fetchTrainingData(currentLecture.training);
        
        if (!currentTrainingData || currentTrainingData.length === 0) {
            const errorMsg = `Aucun contenu d'entraînement n'est disponible pour ${currentLecture.title}.`;
            console.error(errorMsg);
            renderEmptyState(errorMsg);
            hideLoader();
            return;
        }
        
        console.log(`Successfully loaded ${currentTrainingData.length} training items`);
        
        if (mode === 'practice') {
            renderPracticeView(currentTrainingData);
        } else if (mode === 'exam') {
            renderExamView(currentTrainingData, durationInMinutes);
            startTimer(durationInMinutes * 60);
        }
    } catch (error) {
        console.error('Error in startSession:', error);
        renderEmptyState(`Une erreur est survenue lors du chargement des questions. Veuillez réessayer.`);
    } finally {
        hideLoader();
    }
}

// Render skeleton loader while loading training data
function renderSkeletonLoader() {
    const skeletonHTML = `
        <div class="progress-indicator">
            <div class="progress-spinner"></div>
            <span>Chargement des questions...</span>
        </div>
        <div class="skeleton-loader skeleton-card"></div>
        <div class="skeleton-loader skeleton-text"></div>
        <div class="skeleton-loader skeleton-text short"></div>
        <div class="skeleton-loader skeleton-card"></div>
        <div class="skeleton-loader skeleton-text medium"></div>
        <div class="skeleton-loader skeleton-text"></div>
    `;
    document.getElementById('session-view').innerHTML = skeletonHTML;
}

function startTimer(duration) {
    const timerDisplay = document.getElementById('session-timer');
    let timer = duration;
    clearInterval(sessionTimerInterval);
    sessionTimerInterval = setInterval(() => {
        let minutes = parseInt(timer / 60, 10);
        let seconds = parseInt(timer % 60, 10);
        minutes = minutes < 10 ? "0" + minutes : minutes;
        seconds = seconds < 10 ? "0" + seconds : seconds;
        timerDisplay.textContent = minutes + ":" + seconds;

        // Update warning state for fixed timer
        if (timer <= 60) {
            timerDisplay.classList.add('timer-warning');
        } else {
            timerDisplay.classList.remove('timer-warning');
        }

        if (--timer < 0) {
            clearInterval(sessionTimerInterval);
            timerDisplay.textContent = "00:00";
            alert("Temps écoulé !");
            endExamSession();
        }
    }, 1000);
}

function endExamSession() {
    clearInterval(sessionTimerInterval);
    const form = document.getElementById('exam-form');
    if (!form) return;
    const formData = new FormData(form);
    const userAnswers = {};
    for (let [key, value] of formData.entries()) {
        const index = key.split('-')[1];
        if (!userAnswers[index]) userAnswers[index] = [];
        userAnswers[index].push(value.trim());
    }
    calculateAndShowScore(userAnswers);
}

function calculateAndShowScore(userAnswers) {
    let score = 0;
    reviewData.incorrectQuizzes = [];
    reviewData.submittedQrocs = [];

    const quizzes = currentTrainingData.filter(isQuizItem);
    const totalQuizzes = quizzes.length;

    currentTrainingData.forEach((item, index) => {
        const userAnswer = userAnswers[index] || [];
        if (isQuizItem(item)) {
            if (sameAnswerSet(userAnswer, getCorrectAnswers(item))) {
                score++;
            } else {
                reviewData.incorrectQuizzes.push({ question: item, userAnswer });
            }
        } else {
            reviewData.submittedQrocs.push({ question: item, userAnswer });
        }
    });

    // Check if all quizzes are completed (regardless of score)
    if (checkExamCompletion(userAnswers)) {
        saveProgress();
    } else {
        // Also save progress if passing threshold is met (existing logic)
        const passThreshold = 0.8;
        if (totalQuizzes > 0 && (score / totalQuizzes >= passThreshold)) {
            saveProgress();
        }
    }

    if (isRealExamMode && realExamMetadata) {
        realExamMetadata.result = {
            score,
            totalQuizzes,
            totalQrocs: currentTrainingData.filter(item => !isQuizItem(item)).length,
            totalQuestions: currentTrainingData.length,
            generatedAt: realExamMetadata.generatedAt,
            completedAt: new Date().toISOString()
        };
    }

    renderScoreView(score, totalQuizzes);
}

// Function to check if all quizzes are completed
const checkAllQuizzesCompleted = () => {
    if (!currentTrainingData || !currentLecture) return;
    
    const totalQuizzes = currentTrainingData.filter(isQuizItem).length;
    
    console.log(`Quiz completion check: ${completedQuizzes.size}/${totalQuizzes} quizzes completed`);
    
    if (completedQuizzes.size >= totalQuizzes && totalQuizzes > 0) {
        // All quizzes completed, save progress
        console.log('All quizzes completed! Saving progress...');
        saveProgress();
    }
};

// Function to check if all quizzes are completed in exam mode
const checkExamCompletion = (userAnswers) => {
    if (!currentTrainingData) return false;
    
    const totalQuizzes = currentTrainingData.filter(isQuizItem).length;
    let answeredQuizzes = 0;
    
    currentTrainingData.forEach((item, index) => {
        if (isQuizItem(item) && userAnswers[index] && userAnswers[index].length > 0) {
            answeredQuizzes++;
        }
    });
    
    console.log(`Exam completion check: ${answeredQuizzes}/${totalQuizzes} quizzes answered`);
    
    return answeredQuizzes >= totalQuizzes;
};

const saveProgress = async () => {
    if (!currentUser || !currentLecture) return;
    
    // Show saving indicator
    showSavingIndicator();
    
    // Save to localStorage first (always available)
    const localProgress = JSON.parse(localStorage.getItem('userProgress') || '{}');
    localProgress[currentLecture.id] = true;
    localStorage.setItem('userProgress', JSON.stringify(localProgress));
    
    currentUser.progress[currentLecture.id] = true;
    
    // For guest users, only save locally
    if (currentUser.isGuest) {
        console.log('Progress saved locally for guest user');
        renderSidebarProgress();
        return;
    }
    
    if (isOnline) {
        try {
            const { error } = await supabaseClient
                .from('mauritania_profiles')
                .update({ progress: currentUser.progress })
                .eq('id', currentUser.id);
                
            if (error) {
                console.error('Error saving progress:', error);
                showErrorIndicator('Erreur lors de la sauvegarde');
            } else {
                console.log('Progress saved successfully');
                renderSidebarProgress();
            }
        } catch (error) {
            console.error('Network error saving progress:', error);
            queueOfflineAction(() => saveProgress());
        }
    } else {
        // Queue for when online
        queueOfflineAction(() => saveProgress());
        console.log('Progress saved locally, will sync when online');
        renderSidebarProgress();
    }
};

// Show saving progress indicator
const showSavingIndicator = () => {
    const indicator = document.getElementById('saving-indicator');
    if (indicator) {
        indicator.classList.add('show');
        setTimeout(() => {
            indicator.classList.remove('show');
        }, 2000);
    }
};

// Show error indicator
const showErrorIndicator = (message) => {
    const indicator = document.getElementById('saving-indicator');
    if (indicator) {
        indicator.innerHTML = `<i class="fas fa-exclamation-triangle"></i><span>${message}</span>`;
        indicator.style.background = '#FF3B30';
        indicator.classList.add('show');
        setTimeout(() => {
            indicator.classList.remove('show');
            // Reset to original content
            indicator.innerHTML = '<div class="progress-spinner"></div><span>Progression sauvegardée</span>';
            indicator.style.background = '#34C759';
        }, 3000);
    }
};

// --- RENDERING FUNCTIONS ---
function renderEmptyState(message) {
    document.getElementById('session-view').innerHTML = `
        <div class="empty-state">
            <i class="fas fa-box-open"></i>
            <h3>Contenu non disponible</h3>
            <p>${message}</p>
            <button id="back-to-dash-btn" class="btn btn-secondary">
                <i class="fas fa-arrow-left"></i> Retour
            </button>
        </div>`;
}

function renderPracticeView(trainingData) {
    let html = `<div class="session-header"><h2 id="session-title">${currentLecture.title} (Entraînement)</h2></div>`;
    trainingData.forEach((item, index) => {
        const bookmarkId = `${currentLecture.id}_${index}`;
        const isBookmarked = bookmarks[currentLecture.id]?.some(b => b.quizIndex === index) || false;
        const questionText = getQuestionText(item);
        const answerText = isQuizItem(item) ? formatAnswerList(getCorrectAnswers(item)) : item.a;
        html += `<form class="question-card" data-question-index="${index}">`;
        html += `<button type="button" class="bookmark-btn ${isBookmarked ? 'bookmarked' : ''}" data-bookmark-id="${bookmarkId}" data-question="${escapeHTML(questionText)}" data-answer="${escapeHTML(answerText)}">
                     <i class="fas fa-bookmark"></i>
                 </button>`;
        if (isQuizItem(item)) {
            html += `<h3><i class="fas fa-question-circle"></i> Question ${index + 1} (QCM)</h3>
                     <p class="question">${escapeHTML(questionText)}</p>
                     <div class="quiz-options">${renderQuizInputs(item, index, `answer-${index}`)}</div>
                     <button type="submit" class="btn btn-primary practice-validate-btn" style="margin-top: 15px;"><i class="fas fa-check"></i> Valider</button>
                     <div class="feedback"></div>`;
        } else {
            html += `<h3><i class="fas fa-edit"></i> Question ${index + 1} (QROC/QRL)</h3>
                     <p class="question">${escapeHTML(questionText)}</p>
                     <button class="btn btn-primary practice-show-answer-btn" data-target="answer-${index}" style="margin-top: 10px;"><i class="fas fa-eye"></i> Afficher la réponse</button>
                     <div class="answer-reveal" id="answer-${index}">${escapeHTML(item.a)}</div>`;
        }
        html += `</form>`;
    });
    
    // Add bookmarks panel
    html += renderBookmarksPanel();
    
    html += `<button id="back-to-dash-btn" class="btn btn-secondary" style="width:100%;"><i class="fas fa-arrow-left"></i> Retour</button>`;
    document.getElementById('session-view').innerHTML = html;
}

function renderExamView(trainingData, duration) {
    let html = `
        <div class="fixed-exam-timer">
            <div class="exam-title">${currentLecture.title} (Examen)</div>
            <div class="exam-timer-controls">
                <div id="session-timer" class="timer-display">${duration}:00</div>
                <button id="abort-exam-btn" class="btn btn-danger btn-sm" title="Abandonner l'examen">
                    <i class="fas fa-times-circle"></i> Abandonner
                </button>
            </div>
        </div>
        <div class="exam-content-with-fixed-timer">
            <form id="exam-form">`;
    
    trainingData.forEach((item, index) => {
        const questionText = getQuestionText(item);
        html += `<div class="question-card">`;
        if (isQuizItem(item)) {
            html += `<h3><i class="fas fa-question-circle"></i> Question ${index + 1} (QCM)</h3>
                     <p class="question">${escapeHTML(questionText)}</p>
                     <div class="quiz-options">${renderQuizInputs(item, index, `answer-${index}`)}</div>`;
        } else {
            html += `<h3><i class="fas fa-edit"></i> Question ${index + 1} (QROC/QRL)</h3>
                     <p class="question">${escapeHTML(questionText)}</p>
                     <textarea name="answer-${index}" placeholder="Votre réponse..."></textarea>`;
        }
        html += `</div>`;
    });
    
    html += `<button type="button" id="finish-exam-btn" class="btn btn-primary" style="width:100%; padding: 15px; font-size: 1.2em; margin-top: 20px;"><i class="fas fa-check-circle"></i> Terminer l'examen</button></form>
        </div>`;
    
    document.getElementById('session-view').innerHTML = html;
}

function renderScoreView(score, totalQuizzes) {
    const hasMistakes = reviewData.incorrectQuizzes.length > 0;
    const hasQrocs = reviewData.submittedQrocs.length > 0;
    const examTitle = currentLecture ? currentLecture.title : 'Examen Réel';
    const qrocCount = currentTrainingData.filter(item => item.type !== 'quiz').length;
    const isRealExam = isRealExamMode && realExamMetadata;
    const resultMessage = isRealExam
        ? `QCMs corrects : ${score} / ${totalQuizzes} • QROCs : ${qrocCount}`
        : 'Votre score pour les QCMs';
    const completionMessage = (hasMistakes || hasQrocs)
        ? 'Vous pouvez revoir vos réponses.'
        : 'Félicitations, score parfait !';
    const printButton = isRealExam
        ? `<button id="print-real-exam-btn" class="btn btn-outline"><i class="fas fa-print"></i> Imprimer l'examen</button>`
        : '';
    
    document.getElementById('session-view').innerHTML = `
        <div class="score-card">
            <h2>${examTitle}</h2>
            <p>${resultMessage}</p>
            <div class="score-display">${score} / ${totalQuizzes}</div>
            <p>${completionMessage}</p>
            <div class="btn-group">
                ${(hasMistakes || hasQrocs) ? `<button id="review-answers-btn" class="btn btn-primary"><i class="fas fa-search"></i> Revoir les réponses</button>` : ''}
                ${printButton}
                <button id="back-to-dash-btn" class="btn btn-secondary"><i class="fas fa-arrow-left"></i> Retour</button>
            </div>
        </div>`;
}

function renderReviewView() {
    const examTitle = currentLecture ? currentLecture.title : 'Examen Réel';
    let html = `<div class="view-header"><h2>Correction de l'Examen</h2><p>${examTitle}</p></div>`;
    if (reviewData.incorrectQuizzes.length > 0) {
        html += `<div class="review-section"><h3 class="review-section-title">QCM Incorrects</h3>`;
        reviewData.incorrectQuizzes.forEach(item => { html += `<div class="review-card"><p class="question">${escapeHTML(getQuestionText(item.question))}</p><p class="answer-label">Votre réponse</p><div class="user-answer">${escapeHTML(formatAnswerList(item.userAnswer))}</div><p class="answer-label">Réponse correcte</p><div class="correct-answer">${escapeHTML(formatAnswerList(getCorrectAnswers(item.question)))}</div></div>`; });
        html += `</div>`;
    }
    if (reviewData.submittedQrocs.length > 0) {
        html += `<div class="review-section"><h3 class="review-section-title">Vos réponses aux QROC/QRL</h3>`;
        reviewData.submittedQrocs.forEach(item => { html += `<div class="review-card" style="border-left-color: var(--primary-color);"><p class="question">${escapeHTML(getQuestionText(item.question))}</p><p class="answer-label">Votre réponse</p><div class="submitted-answer">${escapeHTML(formatAnswerList(item.userAnswer)) || "<i>Non répondu</i>"}</div><p class="answer-label">Réponse attendue</p><div class="correct-answer">${escapeHTML(item.question.a)}</div></div>`; });
        html += `</div>`;
    }
    html += `<button id="back-to-dash-btn" class="btn btn-secondary" style="width:100%;"><i class="fas fa-arrow-left"></i> Retour</button>`;
    document.getElementById('session-view').innerHTML = html;
}

// --- REAL EXAM MODE ---
const showRealExamView = () => {
    isRealExamMode = true;
    realExamMetadata = {
        quizzes: [],
        qrocs: [],
        generatedAt: new Date().toISOString(),
        result: null,
        totalQuizzes: 0,
        totalQrocs: 0,
        selectedLectures: []
    };
    realExamSelectedLectures = new Set();
    document.getElementById('lecture-title').textContent = 'Examen Réel';
    const dashboardGrid = document.getElementById('dashboard-grid-container');
    if (dashboardGrid) dashboardGrid.style.display = 'none';
    showView('session-view');
    renderRealExamSetup();
};

const renderRealExamSetup = () => {
    const container = document.getElementById('session-view');
    if (!container) return;
    
    if (!allLectures) {
        container.innerHTML = `<div class="real-exam-setup"><p>Chargement des objectifs en cours...</p></div>`;
        return;
    }
    
    const totalLectures = Object.values(allLectures).reduce((sum, list) => sum + list.length, 0);
    
    let html = `
        <div class="real-exam-setup">
            <div class="real-exam-setup-header">
                <h2><i class="fas fa-graduation-cap"></i> Préparer l'examen réel</h2>
                <p>Sélectionnez les objectifs dont vous souhaitez inclure les questions. Chaque objectif ajoute jusqu'à <strong>2 QCMs</strong> et <strong>1 QROC</strong>.</p>
            </div>
            <div class="real-exam-setup-controls">
                <div class="control-buttons">
                    <button type="button" id="real-exam-select-all" class="btn btn-secondary"><i class="fas fa-check-double"></i> Tout sélectionner</button>
                    <button type="button" id="real-exam-clear-all" class="btn btn-secondary"><i class="fas fa-eraser"></i> Tout effacer</button>
                </div>
                <div id="real-exam-selection-summary" class="real-exam-selection-summary"></div>
            </div>
            <div class="real-exam-selection-list">`;
    
    const excludedCategories = ['Sources Supplémentaires', 'Quiz Assemblés'];
    Object.keys(allLectures).filter(c => !excludedCategories.includes(c)).forEach(category => {
        const lectures = allLectures[category] || [];
        const selectedCount = lectures.filter(lecture => realExamSelectedLectures.has(lecture.id)).length;

        html += `
            <details class="real-exam-category" data-category="${category}">
                <summary>
                    <span>${category}</span>
                    <span class="real-exam-category-count" data-category="${category}">${selectedCount}/${lectures.length}</span>
                </summary>
                <div class="real-exam-lecture-list">`;
        
        lectures.forEach(lecture => {
            const checked = realExamSelectedLectures.has(lecture.id) ? 'checked' : '';
            html += `
                    <label class="real-exam-lecture-item">
                        <input type="checkbox" name="real-exam-lecture" value="${lecture.id}" ${checked}>
                        <span class="lecture-title">${lecture.title}</span>
                    </label>`;
        });
        
        html += `
                </div>
            </details>`;
    });
    
    html += `
            </div>
            <div class="real-exam-setup-footer">
                <button type="button" id="real-exam-start-btn" class="btn btn-primary" disabled>
                    <i class="fas fa-play-circle"></i> Démarrer l'examen (120 min)
                </button>
                <p class="real-exam-note"><i class="fas fa-info-circle"></i> L'examen généré proposera un PDF professionnel prêt à être imprimé, avec vos informations.</p>
            </div>
        </div>`;
    
    container.innerHTML = html;
    updateRealExamSelectionSummary(totalLectures);
};

const updateRealExamSelectionSummary = (totalLectures = null) => {
    const summaryEl = document.getElementById('real-exam-selection-summary');
    const startBtn = document.getElementById('real-exam-start-btn');
    const selectedCount = realExamSelectedLectures.size;
    const approximateQuizzes = selectedCount * 2;
    const approximateQrocs = selectedCount * 1;
    
    if (summaryEl) {
        const total = totalLectures ?? Object.values(allLectures || {}).reduce((sum, list) => sum + list.length, 0);
        summaryEl.innerHTML = `
            <div class="selection-badge ${selectedCount > 0 ? 'active' : ''}">
                <strong>${selectedCount}</strong> objectif${selectedCount > 1 ? 's' : ''} sélectionné${selectedCount > 1 ? 's' : ''} / ${total}
            </div>
            <div class="selection-info">
                <span>â‰ˆ ${approximateQuizzes} QCMs</span>
                <span>â‰ˆ ${approximateQrocs} QROCs</span>
                <span>Durée : 120 min</span>
            </div>`;
    }
    
    if (startBtn) {
        startBtn.disabled = selectedCount === 0;
    }
    
    const badges = document.querySelectorAll('.real-exam-category-count');
    badges.forEach(badge => {
        const category = badge.dataset.category;
        const lectures = (allLectures && allLectures[category]) ? allLectures[category] : [];
        const count = lectures.filter(lecture => realExamSelectedLectures.has(lecture.id)).length;
        badge.textContent = `${count}/${lectures.length}`;
    });
};

const syncRealExamCheckboxes = () => {
    document.querySelectorAll('input[name="real-exam-lecture"]').forEach(cb => {
        cb.checked = realExamSelectedLectures.has(cb.value);
    });
};

const selectAllRealExamLectures = () => {
    realExamSelectedLectures = new Set(getAllLectureIds());
    syncRealExamCheckboxes();
    updateRealExamSelectionSummary();
};

const clearAllRealExamLectures = () => {
    realExamSelectedLectures.clear();
    syncRealExamCheckboxes();
    updateRealExamSelectionSummary();
};

const getAllLectureIds = () => {
    if (!allLectures) return [];
    const ids = [];
    Object.keys(allLectures).forEach(category => {
        allLectures[category].forEach(lecture => ids.push(lecture.id));
    });
    return ids;
};

const startRealExam = async (selectedLectureIds) => {
    if (!selectedLectureIds || selectedLectureIds.length === 0) {
        alert('Veuillez sélectionner au moins un objectif avant de démarrer l\'examen.');
        return;
    }
    realExamSelectedLectures = new Set(selectedLectureIds);
    showLoader();
    showView('session-view');
    renderSkeletonLoader();
    
    try {
        // Load all training data from all lectures
        const trainingDatasets = await loadAllTrainingData(selectedLectureIds);
        
        if (!trainingDatasets || trainingDatasets.length === 0) {
            renderEmptyState('Aucune donnée d\'entraînement disponible.');
            hideLoader();
            return;
        }
        
        const aggregatedQuizzes = [];
        const aggregatedQrocs = [];
        const lectureSummaries = [];
        
        trainingDatasets.forEach(dataset => {
            const selectedQuizzes = shuffleArray(dataset.quizzes).slice(0, Math.min(2, dataset.quizzes.length));
            const selectedQrocs = shuffleArray(dataset.qrocs).slice(0, Math.min(1, dataset.qrocs.length));
            
            aggregatedQuizzes.push(...selectedQuizzes);
            aggregatedQrocs.push(...selectedQrocs);
            
            lectureSummaries.push({
                lectureId: dataset.lectureId,
                lectureTitle: dataset.lectureTitle,
                selectedQuizzes: selectedQuizzes.length,
                selectedQrocs: selectedQrocs.length,
                availableQuizzes: dataset.quizzes.length,
                availableQrocs: dataset.qrocs.length
            });
        });
        
        if (aggregatedQuizzes.length === 0 && aggregatedQrocs.length === 0) {
            renderEmptyState('Impossible de générer l\'examen réel : aucune question disponible.');
            hideLoader();
            return;
        }
        
        // Combine and shuffle the final selection
        currentTrainingData = shuffleArray([...aggregatedQuizzes, ...aggregatedQrocs]);
        
        if (realExamMetadata) {
            realExamMetadata.quizzes = aggregatedQuizzes;
            realExamMetadata.qrocs = aggregatedQrocs;
            realExamMetadata.totalQuizzes = aggregatedQuizzes.length;
            realExamMetadata.totalQrocs = aggregatedQrocs.length;
            realExamMetadata.summary = lectureSummaries;
            realExamMetadata.selectedLectures = selectedLectureIds;
            realExamMetadata.totalSelectedLectures = selectedLectureIds.length;
        }
        
        console.log(`Real Exam: Selected ${aggregatedQuizzes.length} QCMs and ${aggregatedQrocs.length} QROCs across ${trainingDatasets.length} lectures`);
        
        // Render exam view with 120 minutes
        renderRealExamView(currentTrainingData, 120);
        startTimer(120 * 60);
        
    } catch (error) {
        console.error('Error in startRealExam:', error);
        renderEmptyState('Une erreur est survenue lors du chargement de l\'examen. Veuillez réessayer.');
    } finally {
        hideLoader();
    }
};

const loadAllTrainingData = async (selectedLectureIds = null) => {
    if (!allLectures) return [];
    
    const lecturesWithTraining = [];
    const collectedLectures = [];
    const selectionSet = selectedLectureIds ? new Set(selectedLectureIds) : null;
    
    // Collect all lectures that have training data
    Object.keys(allLectures).forEach(cat => {
        allLectures[cat].forEach(lecture => {
            if (lecture.training && (!selectionSet || selectionSet.has(lecture.id))) {
                collectedLectures.push(lecture);
            }
        });
    });
    
    console.log(`Loading training data from ${collectedLectures.length} lectures...`);
    
    // Batch loading to avoid flooding the network
    const batchSize = 10;
    for (let i = 0; i < collectedLectures.length; i += batchSize) {
        const batch = collectedLectures.slice(i, i + batchSize);
        const batchPromises = batch.map(lecture => fetchTrainingData(lecture.training));
        const batchResults = await Promise.all(batchPromises);
        
        batchResults.forEach((data, index) => {
            const lecture = batch[index];
            const quizzes = [];
            const qrocs = [];
            
            if (data && Array.isArray(data)) {
                data.forEach(item => {
                    const enriched = {
                        ...item,
                        lectureId: lecture.id,
                        lectureTitle: lecture.title,
                        opts: Array.isArray(item.opts) ? [...item.opts] : item.opts
                    };
                    
                    if (item.type === 'quiz') {
                        quizzes.push(enriched);
                    } else {
                        qrocs.push(enriched);
                    }
                });
            }
            
            lecturesWithTraining.push({
                lectureId: lecture.id,
                lectureTitle: lecture.title,
                quizzes,
                qrocs
            });
        });
    }
    
    console.log(`Prepared training datasets for ${lecturesWithTraining.length} lectures`);
    return lecturesWithTraining;
};

const shuffleArray = (array) => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
};

const renderRealExamView = (trainingData, duration) => {
    const quizCount = realExamMetadata ? realExamMetadata.totalQuizzes : trainingData.filter(isQuizItem).length;
    const qrocCount = realExamMetadata ? realExamMetadata.totalQrocs : trainingData.filter(item => !isQuizItem(item)).length;
    const selectedCount = realExamMetadata ? (realExamMetadata.totalSelectedLectures ?? realExamMetadata.selectedLectures?.length ?? null) : null;
    let html = `
        <div class="fixed-exam-timer">
            <div class="exam-title">Examen Réel - 120 minutes</div>
            <div class="exam-timer-controls">
                <div id="session-timer" class="timer-display">${duration}:00</div>
                <button id="abort-exam-btn" class="btn btn-danger btn-sm" title="Abandonner l'examen">
                    <i class="fas fa-times-circle"></i> Abandonner
                </button>
            </div>
        </div>
        <div class="exam-content-with-fixed-timer">
            <div class="real-exam-info">
                <div class="info-item">
                    <span class="info-label">Contenu de l'examen:</span>
                    <span class="info-value"><strong>${quizCount}</strong> QCMs</span>
                    <span class="info-value"><strong>${qrocCount}</strong> QROCs</span>
                </div>
                ${selectedCount ? `
                <div class="info-item">
                    <span class="info-label">Objectifs sélectionnés:</span>
                    <span class="info-value"><strong>${selectedCount}</strong></span>
                </div>` : ''}
                <div class="info-item">
                    <span class="info-label">Génération:</span>
                    <span class="info-value">Jusqu'à 2 QCMs et 1 QROC par objectif</span>
                </div>
            </div>
            <form id="exam-form">`;
    
    trainingData.forEach((item, index) => {
        const questionText = getQuestionText(item);
        html += `<div class="question-card">`;
        if (isQuizItem(item)) {
            html += `<h3><i class="fas fa-question-circle"></i> Question ${index + 1} (QCM)${item.lectureTitle ? ` <span class="question-source">- ${item.lectureTitle}</span>` : ''}</h3>
                     <p class="question">${escapeHTML(questionText)}</p>
                     <div class="quiz-options">${renderQuizInputs(item, index, `answer-${index}`)}</div>`;
        } else {
            html += `<h3><i class="fas fa-question-circle"></i> Question ${index + 1} (QROC)${item.lectureTitle ? ` <span class="question-source">- ${item.lectureTitle}</span>` : ''}</h3>
                     <p class="question">${escapeHTML(questionText)}</p>`;
        }
        html += `</div>`;
    });
    
    html += `<button type="button" id="finish-exam-btn" class="btn btn-primary" style="width:100%; padding: 15px; font-size: 1.2em; margin-top: 20px;"><i class="fas fa-check-circle"></i> Terminer l'examen</button></form>
        </div>`;
    
    document.getElementById('session-view').innerHTML = html;
};

const printRealExamAsPdf = () => {
    if (!isRealExamMode || !realExamMetadata) {
        alert('L\'impression est disponible uniquement pour l\'examen réel après la correction.');
        return;
    }
    
    // Check if jsPDF is available
    if (!window.jspdf) {
        alert('Bibliothèque PDF indisponible. Vérifiez votre connexion Internet.');
        return;
    }
    const { jsPDF } = window.jspdf;
    
    let studentName = currentUser?.username || 'Invité';
    const promptName = prompt("Nom de l'étudiant pour le PDF :", studentName);
    if (promptName !== null) {
        const trimmed = promptName.trim();
        if (trimmed.length > 0) {
            studentName = trimmed;
        }
    }
    
    const doc = new window.jspdf.jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4',
        compress: true,
        putOnlyUsedFonts: true,
        floatPrecision: 16
    });
    
    // Ensure proper UTF-8 handling
    doc.setFont('helvetica', 'normal');
    doc.setCharSpace(0);
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const topMargin = 30;
    const bottomMargin = 25;
    const contentWidth = pageWidth - margin * 2;
    const lineHeight = 6;
    let y = topMargin;
    
    const generatedDate = realExamMetadata?.result?.completedAt || realExamMetadata?.generatedAt || new Date().toISOString();
    const formattedDate = new Date(generatedDate).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });
    const totalQuizzes = realExamMetadata?.totalQuizzes || 0;
    const totalQrocs = realExamMetadata?.totalQrocs || 0;
    const selectedLectures = realExamMetadata?.totalSelectedLectures ?? realExamMetadata?.selectedLectures?.length ?? 0;
    const score = realExamMetadata?.result?.score ?? null;
    const totalQuizForScore = realExamMetadata?.result?.totalQuizzes ?? totalQuizzes;
    
    const addPageNumber = () => {
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(120, 120, 120);
            doc.text(`Page ${i} / ${pageCount}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
        }
    };
    
    const drawPageHeader = () => {
        // Header background
        doc.setFillColor(0, 122, 255);
        doc.rect(0, 0, pageWidth, 22, 'F');
        
        // Title
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.text(sanitizeTextForPdf('Examen Réel - Objectif Résidanat'), margin, 12);
        
        // Subtitle
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text(sanitizeTextForPdf(`Étudiant : ${studentName} • Durée : 120 minutes`), margin, 18);
        
        // Reset text color
        doc.setTextColor(40, 40, 40);
        y = topMargin;
    };
    
    const ensureSpace = (height = lineHeight) => {
        const pageBottom = pageHeight - bottomMargin;
        if (y + height > pageBottom) {
            doc.addPage();
            drawPageHeader();
            y = topMargin;
        }
    };
    
    const addBodyText = (text, { fontSize = 10, fontStyle = 'normal', after = 0 } = {}) => {
        doc.setFont('helvetica', fontStyle);
        doc.setFontSize(fontSize);
        const sanitizedText = sanitizeTextForPdf(text);
        const lines = doc.splitTextToSize(sanitizedText, contentWidth);
        lines.forEach(line => {
            ensureSpace();
            doc.text(line, margin, y);
            y += lineHeight;
        });
        y += after;
    };
    
    const addSectionTitle = (text) => {
        ensureSpace(lineHeight * 2);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.setTextColor(0, 92, 205);
        doc.text(sanitizeTextForPdf(text), margin, y);
        y += lineHeight + 2;
        doc.setDrawColor(0, 122, 255);
        doc.setLineWidth(0.5);
        doc.line(margin, y, pageWidth - margin, y);
        y += 4;
        doc.setTextColor(40, 40, 40);
    };
    
    const addQuestionHeader = (index, item, typeLabel, color) => {
        ensureSpace(lineHeight * 2);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(color[0], color[1], color[2]);
        const header = `${index}. ${typeLabel}${item.lectureTitle ? ' - ' + item.lectureTitle : ''}`;
        const sanitizedHeader = sanitizeTextForPdf(header);
        const lines = doc.splitTextToSize(sanitizedHeader, contentWidth);
        lines.forEach(line => {
            ensureSpace();
            doc.text(line, margin, y);
            y += lineHeight;
        });
        y += 2;
        doc.setTextColor(40, 40, 40);
    };
    
    const addSummaryCard = () => {
        const summaryLines = [
            `Nom : ${studentName}`,
            `Généré le : ${formattedDate}`,
            `Objectifs sélectionnés : ${selectedLectures}`,
            `QCMs : ${totalQuizzes} • QROCs : ${totalQrocs}`,
            score !== null ? `Résultat : ${score} / ${totalQuizForScore} QCMs corrects` : `Résultat : en attente de saisie`
        ];
        const boxHeight = summaryLines.length * 6 + 16;
        
        // Draw box
        doc.setFillColor(245, 250, 255);
        doc.setDrawColor(0, 122, 255);
        doc.setLineWidth(0.5);
        doc.roundedRect(margin, y, contentWidth, boxHeight, 3, 3, 'FD');
        
        // Title
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(0, 92, 205);
        doc.text(sanitizeTextForPdf('Résumé de l\'examen'), margin + 5, y + 8);
        
        // Content
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(40, 40, 40);
        let textY = y + 16;
        summaryLines.forEach(line => {
            doc.text(sanitizeTextForPdf(line), margin + 5, textY);
            textY += 6;
        });
        
        y += boxHeight + 8;
    };
    
    drawPageHeader();
    addSummaryCard();
    
    const quizColor = [0, 122, 255];
    const qrocColor = [234, 67, 53];
    
    addSectionTitle('Section QCMs');
    if (totalQuizzes === 0) {
        addBodyText('Aucun QCM disponible pour cet examen.', { fontStyle: 'italic', after: lineHeight });
    } else {
        realExamMetadata.quizzes.forEach((item, index) => {
            addQuestionHeader(index + 1, item, 'QCM', quizColor);
            addBodyText(item.q, { after: 1 });
            if (Array.isArray(item.opts)) {
                item.opts.forEach(opt => addBodyText(`• ${opt}`));
            }
            if (item.a) {
                addBodyText(`Réponse correcte : ${item.a}`, { fontStyle: 'italic', after: lineHeight });
            } else {
                y += lineHeight;
            }
        });
    }
    
    ensureSpace(lineHeight * 4);
    addSectionTitle('Section QROCs / QRLs');
    if (totalQrocs === 0) {
        addBodyText('Aucun QROC/QRL disponible pour cet examen.', { fontStyle: 'italic' });
    } else {
        realExamMetadata.qrocs.forEach((item, index) => {
            addQuestionHeader(index + 1, item, 'QROC', qrocColor);
            addBodyText(item.q, { after: 1 });
            if (item.a) {
                addBodyText(`Réponse correcte : ${item.a}`, { fontStyle: 'italic', after: lineHeight });
            } else {
                y += lineHeight * 4; // Space for answer
            }
        });
    }
    
    // Add page numbers to all pages
    addPageNumber();
    
    const fileName = `Examen_Reel_${studentName.replace(/ /g, '_')}_${new Date().toISOString().slice(0,10)}.pdf`;
    doc.save(fileName);
};

const updatePrintQuizzesSelectionSummary = (totalLectures = null) => {
    const summaryEl = document.getElementById('print-quizzes-selection-summary');
    const generateBtn = document.getElementById('print-quizzes-generate-btn');
    const selectedCount = printQuizzesSelectedLectures.size;
    
    if (summaryEl) {
        const total = totalLectures ?? Object.values(allLectures || {}).reduce((sum, list) => sum + list.length, 0);
        summaryEl.innerHTML = `
            <div class="selection-badge ${selectedCount > 0 ? 'active' : ''}">
                <strong>${selectedCount}</strong> objectif${selectedCount > 1 ? 's' : ''} sélectionné${selectedCount > 1 ? 's' : ''} / ${total}
            </div>`;
    }
    
    if (generateBtn) {
        generateBtn.disabled = selectedCount === 0;
    }
    
    const badges = document.querySelectorAll('.print-quizzes-category-count');
    badges.forEach(badge => {
        const category = badge.dataset.category;
        const lectures = (allLectures && allLectures[category]) ? allLectures[category] : [];
        const count = lectures.filter(lecture => printQuizzesSelectedLectures.has(lecture.id)).length;
        badge.textContent = `${count}/${lectures.length}`;
    });
};

const updatePrintQuizzesSelection = () => {
    printQuizzesSelectedLectures.clear();
    document.querySelectorAll('input[name="print-quizzes-lecture"]:checked').forEach(cb => {
        printQuizzesSelectedLectures.add(cb.value);
    });
    updatePrintQuizzesSelectionSummary();
};

const selectAllPrintQuizzesLectures = () => {
    printQuizzesSelectedLectures = new Set(getAllLectureIds());
    document.querySelectorAll('input[name="print-quizzes-lecture"]').forEach(cb => {
        cb.checked = printQuizzesSelectedLectures.has(cb.value);
    });
    updatePrintQuizzesSelectionSummary();
};

const clearAllPrintQuizzesLectures = () => {
    printQuizzesSelectedLectures.clear();
    document.querySelectorAll('input[name="print-quizzes-lecture"]').forEach(cb => {
        cb.checked = false;
    });
    updatePrintQuizzesSelectionSummary();
};

const generatePrintQuizzesPdfForCurrentLecture = async () => {
    if (!currentLecture) {
        alert('Aucun objectif sélectionné.');
        return;
    }
    
    // Check if jsPDF is available
    if (!window.jspdf) {
        alert('Bibliothèque PDF indisponible. Vérifiez votre connexion Internet.');
        return;
    }
    const { jsPDF } = window.jspdf;
    
    showLoader();
    
    try {
        // Get current user's name
        let userName = 'Utilisateur';
        if (currentUser) {
            if (currentUser.username) {
                userName = currentUser.username;
            } else if (currentUser.email) {
                userName = currentUser.email.split('@')[0];
                // Capitalize first letter
                userName = userName.charAt(0).toUpperCase() + userName.slice(1);
            }
        }
        console.log('Generating PDF for user:', userName);
        
        // Load training data for current lecture
        if (!currentLecture.training) {
            alert('Aucune donnée d\'entraînement disponible pour cet objectif.');
            hideLoader();
            return;
        }
        
        const data = await fetchTrainingData(currentLecture.training);
        console.log('Training data loaded:', data);
        console.log('Data types:', data.map(item => item.type));
        
        const quizzes = data.filter(item => item.type === 'quiz');
        const qrocs = data.filter(item => item.type === 'qroc' || item.type === 'qrl');
        
        console.log(`Found ${quizzes.length} quizzes and ${qrocs.length} QROCs/QRLs`);
        
        if (quizzes.length === 0 && qrocs.length === 0) {
            alert('Aucune question trouvée pour cet objectif.');
            hideLoader();
            return;
        }
        
        // Generate PDF with improved design
        const doc = new window.jspdf.jsPDF({
            orientation: 'p',
            unit: 'mm',
            format: 'a4',
            compress: true,
            putOnlyUsedFonts: true,
            floatPrecision: 16
        });
        
        // Ensure proper UTF-8 handling
        doc.setFont('helvetica', 'normal');
        doc.setCharSpace(0);
        const margin = 12;
        const pageWidth = 210;
        const pageHeight = 297;
        const maxWidth = pageWidth - (margin * 2);
        const columnWidth = (maxWidth - 8) / 2;
        const xPositions = [margin, margin + columnWidth + 8];
        let columnIndex = 0;
        let y = 15;
        const lineHeight = 7;
        
        const quizColor = [0, 92, 205];
        const qrocColor = [150, 0, 150];
        const headerColor = [15, 36, 56];
        const answerColor = [0, 128, 0];
        
        const ensureSpace = (height = lineHeight) => {
            if (y + height > pageHeight - margin) {
                columnIndex++;
                if (columnIndex >= 2) {
                    doc.addPage();
                    columnIndex = 0;
                }
                y = 15;
            }
        };
        
        const addHeader = (text, fontSize = 14, color = headerColor) => {
            ensureSpace(lineHeight * 2);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(fontSize);
            doc.setTextColor(color[0], color[1], color[2]);
            const sanitizedText = sanitizeTextForPdf(text);
            const lines = doc.splitTextToSize(sanitizedText, columnWidth);
            lines.forEach(line => {
                ensureSpace();
                doc.text(line, xPositions[columnIndex], y);
                y += lineHeight;
            });
            y += 2;
            doc.setTextColor(38, 38, 38);
        };
        
        const addBodyText = (text, { fontSize = 10, fontStyle = 'normal', after = 0, color = [38, 38, 38] } = {}) => {
            doc.setFont('helvetica', fontStyle);
            doc.setFontSize(fontSize);
            doc.setTextColor(color[0], color[1], color[2]);
            const sanitizedText = sanitizeTextForPdf(text);
            const lines = doc.splitTextToSize(sanitizedText, columnWidth);
            lines.forEach(line => {
                ensureSpace();
                doc.text(line, xPositions[columnIndex], y);
                y += lineHeight;
            });
            y += after;
            doc.setTextColor(38, 38, 38);
        };
        
        // Header
        addHeader('Questions QCM et QROC', 14, headerColor);
        addBodyText(currentLecture.title, { fontSize: 11, fontStyle: 'bold', after: 1 });
        addBodyText(`Généré le : ${new Date().toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })} par ${userName}`, { fontSize: 9, after: 4 });
        
        // Add quizzes section if any
        if (quizzes.length > 0) {
            addHeader('Questions à Choix Multiples (QCM)', 11, quizColor);
            
            quizzes.forEach((quiz, index) => {
                ensureSpace(lineHeight * 5);
                
                // Question number and text
                addBodyText(`${index + 1}. ${quiz.q}`, { fontSize: 10.5, fontStyle: 'bold', after: 2 });
                
                // Options with A/B/C/D labels
                if (Array.isArray(quiz.opts)) {
                    const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
                    quiz.opts.forEach((opt, optIndex) => {
                        const label = labels[optIndex] || String.fromCharCode(65 + optIndex);
                        addBodyText(`${label}. ${opt}`, { fontSize: 10, after: 1 });
                    });
                }
                
                // Correct answer
                if (quiz.a) {
                    y += 1;
                    addBodyText(`Réponse : ${quiz.a}`, { fontSize: 9.5, fontStyle: 'bold', color: answerColor, after: 3 });
                } else {
                    y += 3;
                }
                
                // Separator line
                doc.setDrawColor(220, 220, 220);
                doc.setLineWidth(0.3);
                doc.line(xPositions[columnIndex], y, xPositions[columnIndex] + columnWidth, y);
                y += 2;
            });
        }
        
        // Add QROCs section if any
        if (qrocs.length > 0) {
            ensureSpace(lineHeight * 3);
            addHeader('Questions à Réponse Ouverte Courte (QROC)', 11, qrocColor);
            
            qrocs.forEach((qroc, index) => {
                ensureSpace(lineHeight * 4);
                
                // Question number and text
                addBodyText(`${index + 1}. ${qroc.q}`, { fontSize: 10.5, fontStyle: 'bold', after: 2 });
                
                // Answer
                if (qroc.a) {
                    addBodyText(`Réponse : ${qroc.a}`, { fontSize: 9.5, fontStyle: 'bold', color: answerColor, after: 3 });
                } else {
                    y += 3;
                }
                
                // Separator line
                doc.setDrawColor(220, 220, 220);
                doc.setLineWidth(0.3);
                doc.line(xPositions[columnIndex], y, xPositions[columnIndex] + columnWidth, y);
                y += 2;
            });
        }
        
        const fileDate = new Date().toISOString().slice(0, 10);
        const safeTitle = currentLecture.title.replace(/[^a-z0-9]/gi, '-').toLowerCase();
        const filename = `qcm-${safeTitle}-${fileDate}.pdf`;
        doc.save(filename);
        
    } catch (error) {
        console.error('Error generating print quizzes PDF:', error);
        alert('Une erreur est survenue lors de la génération du PDF.');
    } finally {
        hideLoader();
    }
};


// Sanitize text for PDF to handle special characters properly
const sanitizeTextForPdf = (text) => {
    if (!text) return '';
    
    // Replace specific characters not supported by the default PDF font
    return String(text)
        .replace(/â†’/g, '->'); // Replace arrow character
};

const generatePrintQuizzesPdf = async () => {
    const selectedIds = Array.from(printQuizzesSelectedLectures);
    if (selectedIds.length === 0) {
        alert('Veuillez sélectionner au moins un objectif.');
        return;
    }
    
    // Check if jsPDF is available
    if (!window.jspdf) {
        alert('Bibliothèque PDF indisponible. Vérifiez votre connexion Internet.');
        return;
    }
    const { jsPDF } = window.jspdf;
    
    showLoader();
    
    try {
        // Get current user's name
        let userName = 'Utilisateur';
        try {
            // Try to get user from localStorage
            const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
            
            // Check different possible locations for user name
            if (currentUser?.user_metadata?.full_name) {
                userName = currentUser.user_metadata.full_name;
            } else if (currentUser?.user_metadata?.name) {
                userName = currentUser.user_metadata.name;
            } else if (currentUser?.email) {
                userName = currentUser.email.split('@')[0];
                // Capitalize first letter
                userName = userName.charAt(0).toUpperCase() + userName.slice(1);
            } else if (currentUser?.user?.email) {
                userName = currentUser.user.email.split('@')[0];
                // Capitalize first letter
                userName = userName.charAt(0).toUpperCase() + userName.slice(1);
            }
            
            console.log('Current user data:', currentUser);
        } catch (e) {
            console.error('Error getting user data:', e);
        }
        
        // Load training data for selected lectures
        const selectedLectures = selectedIds.map(id => findLectureById(id)).filter(Boolean);
        const allItems = [];
        
        for (const lecture of selectedLectures) {
            if (lecture.training) {
                const data = await fetchTrainingData(lecture.training);
                console.log(`Fetched training data for ${lecture.title}:`, data);
                
                // Include both quizzes and QROCs
                const items = data.filter(item => {
                    const isQuizOrQroc = item.type === 'quiz' || item.type === 'qroc';
                    if (!isQuizOrQroc) return false;
                    
                    // For QROCs, make sure they have the required properties
                    if (item.type === 'qroc') {
                        const isValidQroc = item.q && (item.a || item.answer);
                        if (!isValidQroc) {
                            console.warn('Skipping invalid QROC:', item);
                            return false;
                        }
                        // Normalize QROC format
                        if (item.answer && !item.a) {
                            item.a = item.answer;
                        }
                    }
                    return true;
                });
                
                console.log(`Found ${items.length} items (${items.filter(i => i.type === 'quiz').length} QCM, ${items.filter(i => i.type === 'qroc').length} QROC) for ${lecture.title}`);
                
                items.forEach(item => {
                    item.lectureId = lecture.id;
                    item.lectureTitle = lecture.title;
                });
                allItems.push(...items);
            }
        }
        
        if (allItems.length === 0) {
            alert('Aucune question trouvée dans les objectifs sélectionnés.');
            hideLoader();
            return;
        }
        
        // Generate PDF - use the correct constructor for UMD version
        const doc = new window.jspdf.jsPDF({
            orientation: 'p',
            unit: 'mm',
            format: 'a4',
            compress: true,
            putOnlyUsedFonts: true,
            floatPrecision: 16
        });
        
        // Ensure proper UTF-8 handling
        doc.setFont('helvetica', 'normal');
        doc.setCharSpace(0);
        const margin = 12;
        const pageWidth = 210;
        const pageHeight = 297;
        const maxWidth = pageWidth - (margin * 2);
        const columnWidth = (maxWidth - 8) / 2;
        const xPositions = [margin, margin + columnWidth + 8];
        let columnIndex = 0;
        let y = 15;
        const lineHeight = 7;
        
        const quizColor = [0, 92, 205];
        const qrocColor = [150, 0, 150];
        const headerColor = [15, 36, 56];
        const answerColor = [0, 128, 0];
        const userColor = [30, 100, 200];
        
        const ensureSpace = (height = lineHeight) => {
            if (y + height > pageHeight - margin) {
                columnIndex++;
                if (columnIndex >= 2) {
                    doc.addPage();
                    columnIndex = 0;
                }
                y = 15;
            }
        };
        
        const addHeader = (text, fontSize = 14, color = headerColor, align = 'left') => {
            ensureSpace(lineHeight * 2);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(fontSize);
            doc.setTextColor(color[0], color[1], color[2]);
            const sanitizedText = sanitizeTextForPdf(text);
            const lines = doc.splitTextToSize(sanitizedText, columnWidth);
            lines.forEach(line => {
                ensureSpace();
                const x = align === 'center' ? pageWidth / 2 - (doc.getStringUnitWidth(line) * doc.getFontSize() / 2) : xPositions[columnIndex];
                doc.text(line, x, y);
                y += lineHeight;
            });
            y += 2;
            doc.setTextColor(38, 38, 38);
        };
        
        const addBodyText = (text, { fontSize = 10, fontStyle = 'normal', after = 0, color = [38, 38, 38], align = 'left' } = {}) => {
            doc.setFont('helvetica', fontStyle);
            doc.setFontSize(fontSize);
            doc.setTextColor(color[0], color[1], color[2]);
            const sanitizedText = sanitizeTextForPdf(text);
            const lines = doc.splitTextToSize(sanitizedText, columnWidth);
            lines.forEach(line => {
                ensureSpace();
                const x = align === 'center' ? pageWidth / 2 - (doc.getStringUnitWidth(line) * doc.getFontSize() / 2) : xPositions[columnIndex];
                doc.text(line, x, y);
                y += lineHeight;
            });
            y += after;
            doc.setTextColor(38, 38, 38);
        };
        
        // Add title page
        doc.setFillColor(245, 245, 245);
        doc.rect(0, 0, pageWidth, pageHeight, 'F');
        
        // Add logo or title at the top
        doc.setFontSize(24);
        doc.setTextColor(headerColor[0], headerColor[1], headerColor[2]);
        doc.text(sanitizeTextForPdf('Objectif Résidanat'), pageWidth / 2, 50, { align: 'center' });
        
        // Add user name
        doc.setFontSize(18);
        doc.setTextColor(userColor[0], userColor[1], userColor[2]);
        doc.text(sanitizeTextForPdf(`Étudiant(e) : ${userName}`), pageWidth / 2, 80, { align: 'center' });
        
        // Add document type
        doc.setFontSize(16);
        doc.setTextColor(quizColor[0], quizColor[1], quizColor[2]);
        doc.text(sanitizeTextForPdf('Fiches de révision'), pageWidth / 2, 100, { align: 'center' });
        
        // Add date
        doc.setFontSize(12);
        doc.setTextColor(100, 100, 100);
        doc.text(sanitizeTextForPdf(`Généré le : ${new Date().toLocaleString('fr-FR', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })}`), pageWidth / 2, 120, { align: 'center' });
        
        // Add page number
        doc.setFontSize(10);
        doc.text('Page 1', pageWidth / 2, pageHeight - 20, { align: 'center' });
        
        // Add a new page for content
        doc.addPage();
        
        // Content header
        addHeader('Fiches de révision - Objectif Résidanat', 14, headerColor, 'center');
        addBodyText(`Généré le : ${new Date().toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })} par ${userName}`, { fontSize: 10, after: 2, align: 'center' });
        addBodyText(`Objectifs sélectionnés : ${selectedLectures.length}`, { fontSize: 9, after: 1, align: 'center' });
        
        // Count items by type
        const quizCount = allItems.filter(item => item.type === 'quiz').length;
        const qrocCount = allItems.filter(item => item.type === 'qroc').length;
        addBodyText(`Total : ${allItems.length} questions (${quizCount} QCM, ${qrocCount} QROC)`, { 
            fontSize: 9, 
            after: 4, 
            fontStyle: 'bold',
            align: 'center' 
        });
        
        // Questions organized by lecture and type
        const itemsByLecture = {};
        allItems.forEach(item => {
            if (!itemsByLecture[item.lectureTitle]) {
                itemsByLecture[item.lectureTitle] = { quizzes: [], qrocs: [] };
            }
            if (item.type === 'quiz') {
                itemsByLecture[item.lectureTitle].quizzes.push(item);
            } else if (item.type === 'qroc') {
                itemsByLecture[item.lectureTitle].qrocs.push(item);
            }
        });
        
        // Sort lectures alphabetically
        const sortedLectureTitles = Object.keys(itemsByLecture).sort();
        
        // Add content for each lecture
        for (const lectureTitle of sortedLectureTitles) {
            const lectureItems = itemsByLecture[lectureTitle];
            
            // Add lecture header
            ensureSpace(lineHeight * 3);
            addHeader(lectureTitle, 12, headerColor);
            doc.setDrawColor(headerColor[0], headerColor[1], headerColor[2]);
            doc.setLineWidth(0.5);
            doc.line(xPositions[columnIndex], y, xPositions[columnIndex] + columnWidth, y);
            y += 5;
            
            // Add quizzes section if any
            if (lectureItems.quizzes.length > 0) {
                ensureSpace(lineHeight * 2);
                addHeader('Questions à Choix Multiples (QCM)', 10, quizColor);
                
                lectureItems.quizzes.forEach((quiz, index) => {
                    ensureSpace(lineHeight * 5);
                    addBodyText(`${index + 1}. ${quiz.q}`, { fontSize: 10, fontStyle: 'bold', after: 2 });
                    
                    if (Array.isArray(quiz.opts)) {
                        const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
                        quiz.opts.forEach((opt, optIndex) => {
                            const label = labels[optIndex] || String.fromCharCode(65 + optIndex);
                            addBodyText(`   ${label}. ${opt}`, { fontSize: 9, after: 1 });
                        });
                    }
                    
                    if (quiz.a) {
                        y += 1;
                        addBodyText(`Réponse : ${quiz.a}`, { 
                            fontSize: 9, 
                            fontStyle: 'bold', 
                            color: answerColor, 
                            after: 3 
                        });
                    } else {
                        y += 3;
                    }
                    
                    // Add separator
                    doc.setDrawColor(220, 220, 220);
                    doc.setLineWidth(0.2);
                    doc.line(xPositions[columnIndex], y, xPositions[columnIndex] + columnWidth, y);
                    y += 2;
                });
            }
            
            // Add QROCs section if any
            if (lectureItems.qrocs.length > 0) {
                ensureSpace(lineHeight * 2);
                addHeader('Questions à Réponse Ouverte Courte (QROC)', 10, qrocColor);
                
                lectureItems.qrocs.forEach((qroc, index) => {
                    // Skip if no question text
                    if (!qroc.q) {
                        console.warn('Skipping QROC with no question text:', qroc);
                        return;
                    }
                    
                    // Ensure we have enough space for the QROC block
                    ensureSpace(lineHeight * 10);
                    
                    // Add question number and text
                    addBodyText(`${index + 1}. ${qroc.q}`, { 
                        fontSize: 10, 
                        fontStyle: 'bold', 
                        after: 2 
                    });
                    
                    // Add space for student's answer
                    addBodyText('Votre réponse :', { 
                        fontSize: 9, 
                        fontStyle: 'italic',
                        after: 1
                    });
                    
                    // Add 4 lines for writing
                    const startY = y;
                    doc.setDrawColor(200, 200, 200);
                    doc.setLineWidth(0.1);
                    for (let i = 0; i < 4; i++) {
                        doc.line(xPositions[columnIndex], y, xPositions[columnIndex] + columnWidth, y);
                        y += lineHeight;
                    }
                    y += 2;
                    
                    // Add model answer section
                    const modelAnswer = qroc.a || qroc.answer || 'Aucune réponse modèle disponible';
                    
                    addBodyText('Réponse modèle :', { 
                        fontSize: 9, 
                        fontStyle: 'italic',
                        after: 1
                    });
                    
                    // Add model answer with proper formatting
                    addBodyText(modelAnswer, { 
                        fontSize: 9, 
                        color: answerColor,
                        after: 3
                    });
                    
                    // Add a light background to the QROC section for better visibility
                    doc.setFillColor(250, 245, 255);
                    doc.rect(
                        xPositions[columnIndex] - 2, 
                        startY - 5, 
                        columnWidth + 4, 
                        y - startY + 8, 
                        'F'
                    );
                    
                    // Move the content to the front
                    doc.setDrawColor(200, 180, 220);
                    doc.setLineWidth(0.3);
                    doc.rect(
                        xPositions[columnIndex] - 2, 
                        startY - 5, 
                        columnWidth + 4, 
                        y - startY + 8
                    );
                    
                    // Add separator with more space
                    y += 5;
                    doc.setDrawColor(220, 220, 220);
                    doc.setLineWidth(0.2);
                    doc.line(xPositions[columnIndex], y, xPositions[columnIndex] + columnWidth, y);
                    y += 8;
                });
            }
            
            // Add page break between lectures if there's not enough space
            if (y > pageHeight - 50) {
                doc.addPage();
                columnIndex = 0;
                y = 15;
            } else {
                // Add some space after each lecture
                y += 10;
            }
        }
        
        // Add page numbers
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setTextColor(100, 100, 100);
            doc.text(sanitizeTextForPdf(`Page ${i} sur ${pageCount}`), pageWidth - margin, pageHeight - 10);
            
            // Add header with user name on each page after the first
            if (i > 1) {
                doc.setFontSize(9);
                doc.setTextColor(150, 150, 150);
                doc.text(sanitizeTextForPdf(`Étudiant : ${userName}`), margin, 10);
                doc.text(sanitizeTextForPdf(`Objectif Résidanat - Fiches de révision`), pageWidth / 2, 10, { align: 'center' });
                doc.text(sanitizeTextForPdf(`Page ${i-1}`), pageWidth - margin, 10, { align: 'right' });
                
                // Add separator line
                doc.setDrawColor(220, 220, 220);
                doc.setLineWidth(0.2);
                doc.line(margin, 15, pageWidth - margin, 15);
            }
        }
        
        const fileDate = new Date().toISOString().slice(0, 10);
        const filename = `revision-${selectedLectures.length > 1 ? 'multi' : selectedLectures[0]?.title.replace(/[^a-z0-9]/gi, '-').toLowerCase() || 'objectifs'}-${fileDate}.pdf`;
        doc.save(filename);
        
        closePrintQuizzesModal();
    } catch (error) {
        console.error('Error generating print quizzes PDF:', error);
        alert('Une erreur est survenue lors de la génération du PDF.');
    } finally {
        hideLoader();
    }
};

// --- MODAL & UTILITY FUNCTIONS ---
const openExamChoiceModal = () => document.getElementById('exam-choice-modal-overlay').classList.add('visible');
const closeExamChoiceModal = () => document.getElementById('exam-choice-modal-overlay').classList.remove('visible');
const openProfileModal = () => { renderProfileModal(); document.getElementById('profile-modal-overlay').classList.add('visible'); };
const closeProfileModal = () => document.getElementById('profile-modal-overlay').classList.remove('visible');
const findLectureById = (id) => { if (!allLectures) return null; for (const cat in allLectures) { const found = allLectures[cat].find(l => l.id === id); if (found) return found; } return null; };
const populateSidebar = () => { 
    if (!allLectures) return; 
    const isGuest = currentUser && currentUser.isGuest;
    const nav = document.getElementById('nav-list'); 
    let html = isGuest
        ? `<li class="empty-lecture"><i class="fa-solid fa-lock" style="width: 20px; color: #8E8E93;"></i>Drive verrouillé</li><li class="empty-lecture"><i class="fa-solid fa-lock" style="width: 20px; color: #8E8E93;"></i>Examen réel verrouillé</li>`
        : `<li class="nav-drive-entry"><a href="#" data-view="mednval-drive"><i class="fa-solid fa-cloud-arrow-down" style="width: 20px;"></i>${MEDNVAL_DRIVE_NAME}</a></li><li class="nav-drive-entry"><a href="#" data-view="real-exam"><i class="fa-solid fa-graduation-cap" style="width: 20px;"></i>Examen Réel</a></li>`;
    let i = 1; 
    
    Object.keys(allLectures).forEach(cat => { 
        const lectures = allLectures[cat] || [];
        html += `<details ${i === 1 ? 'open' : ''}><summary>${cat}</summary><ul>`; 
        
        if (lectures.length === 0) {
            html += `<li class="empty-lecture"><i class="fa-regular fa-folder-open" style="width: 20px; color: #8E8E93;"></i>Aucun document pour le moment</li>`;
            i++;
        } else {
            const guestAllowed = getGuestAllowedLectureIds();
            lectures.forEach(lec => { 
                const locked = isGuest && !guestAllowed.has(lec.id);
                html += locked
                    ? `<li class="empty-lecture"><i class="fa-solid fa-lock" style="width: 20px; color: #8E8E93;"></i>${lec.title}</li>`
                    : `<li><a href="#" data-lecture-id="${lec.id}"><i class="fa-regular fa-file-lines" style="width: 20px;"></i>${lec.title}<span class="progress-icon-container"></span></a></li>`; 
                i++; 
            }); 
        }
        
        html += `</ul></details>`; 
    }); 
    nav.innerHTML = html; 
};
const renderSidebarProgress = () => { 
    document.querySelectorAll('#nav-list a').forEach(link => { 
        const icon = link.querySelector('.progress-icon-container'); 
        if (!icon) return;
        if (!currentUser || !link.dataset.lectureId) { 
            icon.innerHTML = ''; 
            return; 
        } 
        
        // For guest users, check localStorage for progress
        let isCompleted = false;
        if (currentUser.isGuest) {
            const localProgress = JSON.parse(localStorage.getItem('userProgress') || '{}');
            isCompleted = localProgress[link.dataset.lectureId] || false;
        } else {
            isCompleted = currentUser.progress[link.dataset.lectureId] || false;
        }
        
        icon.innerHTML = isCompleted ? '<i class="fas fa-check-circle completed-icon"></i>' : ''; 
    }); 
};

// --- MEDNVAL DRIVE ---
const showMednvalDriveView = () => {
    document.getElementById('lecture-title').textContent = MEDNVAL_DRIVE_NAME;
    const dashboardGrid = document.getElementById('dashboard-grid-container');
    if (dashboardGrid) dashboardGrid.style.display = 'none';
    showView('mednval-drive-view');
    initializeMednvalDrive();
};

const initializeMednvalDrive = async () => {
    const warning = document.getElementById('mednval-drive-config-warning');
    const loading = document.getElementById('mednval-drive-loading');
    const grid = document.getElementById('mednval-drive-grid');
    const emptyState = document.getElementById('mednval-drive-empty');

    if (!isDriveConfigured()) {
        if (warning) warning.classList.remove('hidden');
        if (grid) grid.innerHTML = '';
        if (emptyState) emptyState.classList.add('hidden');
        if (loading) loading.classList.add('hidden');
        return;
    }

    if (warning) warning.classList.add('hidden');

    if (!mednvalDriveState.initialized) {
        mednvalDriveState.breadcrumb = [{ id: MEDNVAL_DRIVE_FOLDER_ID, name: MEDNVAL_DRIVE_NAME }];
        await loadMednvalDrive(MEDNVAL_DRIVE_FOLDER_ID, mednvalDriveState.breadcrumb);
        mednvalDriveState.initialized = true;
    } else {
        renderDriveBreadcrumb(mednvalDriveState.breadcrumb);
        renderDriveGrid(mednvalDriveState.items);
    }
};

const loadMednvalDrive = async (folderId, breadcrumb = []) => {
    if (!isDriveConfigured()) return;

    const loading = document.getElementById('mednval-drive-loading');
    const grid = document.getElementById('mednval-drive-grid');
    const emptyState = document.getElementById('mednval-drive-empty');

    if (loading) loading.classList.remove('hidden');
    if (grid) grid.innerHTML = '';
    if (emptyState) emptyState.classList.add('hidden');

    try {
        const items = await fetchDriveItems(folderId);
        mednvalDriveState = {
            initialized: true,
            currentFolderId: folderId,
            breadcrumb: [...breadcrumb],
            items
        };
        renderDriveBreadcrumb(mednvalDriveState.breadcrumb);
        renderDriveGrid(items);
    } catch (error) {
        console.error('Mednval Drive load error:', error);
        if (grid) {
            grid.innerHTML = `<div class="drive-warning"><i class="fa-solid fa-triangle-exclamation"></i><div><strong>Erreur lors du chargement</strong><p>Vérifiez vos autorisations Google Drive et votre connexion Internet, puis réessayez.</p></div></div>`;
        }
    } finally {
        if (loading) loading.classList.add('hidden');
    }
};

const fetchDriveItems = async (folderId) => {
    const items = [];
    let pageToken = '';
    const endpoint = 'https://www.googleapis.com/drive/v3/files';

    do {
        const params = new URLSearchParams({
            q: `'${folderId}' in parents and trashed = false`,
            key: GOOGLE_DRIVE_API_KEY,
            fields: DRIVE_LIST_FIELDS,
            orderBy: 'folder,name,modifiedTime desc',
            pageSize: DRIVE_PAGE_SIZE.toString(),
            supportsAllDrives: 'true',
            includeItemsFromAllDrives: 'true'
        });

        if (pageToken) params.set('pageToken', pageToken);

        const response = await fetch(`${endpoint}?${params.toString()}`);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Drive API error ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        if (Array.isArray(data.files)) {
            items.push(...data.files);
        }

        pageToken = data.nextPageToken || '';
    } while (pageToken);

    return items.sort((a, b) => {
        const aIsFolder = a.mimeType === DRIVE_FOLDER_MIME_TYPE;
        const bIsFolder = b.mimeType === DRIVE_FOLDER_MIME_TYPE;
        if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
        return (a.name || '').localeCompare(b.name || '', 'fr', { sensitivity: 'base' });
    });
};

const buildDriveFileUrl = (fileId) => `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${GOOGLE_DRIVE_API_KEY}`;
const buildDriveThumbnailUrl = (fileId) => `https://drive.google.com/thumbnail?id=${fileId}&sz=w400-h400`;

const renderDriveBreadcrumb = (crumbs = []) => {
    const container = document.getElementById('mednval-drive-breadcrumb');
    if (!container) return;

    if (!crumbs.length) {
        container.innerHTML = '';
        return;
    }

    const breadcrumbHtml = crumbs.map((crumb, index) => {
        const isCurrent = index === crumbs.length - 1;
        const crumbHtml = `<span class="drive-crumb ${isCurrent ? 'is-current' : ''}" data-index="${index}" data-folder-id="${crumb.id}">${escapeHTML(crumb.name || MEDNVAL_DRIVE_NAME)}</span>`;
        return isCurrent ? crumbHtml : `${crumbHtml}<span class="drive-crumb-separator">&rsaquo;</span>`;
    }).join('');

    container.innerHTML = breadcrumbHtml;
};

const renderDriveGrid = (items = []) => {
    const grid = document.getElementById('mednval-drive-grid');
    const emptyState = document.getElementById('mednval-drive-empty');
    if (!grid) return;

    if (!items.length) {
        if (emptyState) emptyState.classList.remove('hidden');
        grid.innerHTML = '';
        return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    const cards = items.map(item => {
        const isFolder = item.mimeType === DRIVE_FOLDER_MIME_TYPE;
        const isPdf = item.mimeType === 'application/pdf';
        const name = item.name || (isFolder ? 'Dossier' : 'Document');

        if (isFolder) {
            const folderDisplay = escapeHTML(name);
            return `
                <div class="drive-card drive-folder-card" data-type="folder" data-folder-id="${item.id}" data-folder-name="${encodeURIComponent(name)}">
                    <div class="drive-card-icon"><i class="fa-solid fa-folder"></i></div>
                    <div>
                        <h3>${folderDisplay}</h3>
                        <p>Ouvrir le dossier</p>
                    </div>
                </div>
            `;
        }

        const displayName = name.replace(/\.pdf$/i, '');
        const fileName = name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`;
        const downloadUrl = buildDriveFileUrl(item.id);
        const pdfUrl = downloadUrl;
        const thumbUrl = item.thumbnailLink ? `${item.thumbnailLink}&sz=w400` : buildDriveThumbnailUrl(item.id);
        const formattedDate = formatDriveDate(item.modifiedTime);
        const formattedSize = formatDriveSize(item.size);

        if (!isPdf) {
            return `
                <div class="drive-card" data-type="unsupported" data-disabled="true">
                    <div class="drive-card-icon"><i class="fa-regular fa-file"></i></div>
                    <div>
                        <h3>${escapeHTML(name)}</h3>
                        <p>Format non pris en charge</p>
                    </div>
                </div>
            `;
        }

        return `
            <div class="drive-card drive-file-card" data-type="file" data-drive-id="${item.id}" data-file-name="${encodeURIComponent(fileName)}" data-display-name="${encodeURIComponent(displayName)}" data-file-url="${encodeURIComponent(pdfUrl)}" data-download-url="${encodeURIComponent(downloadUrl)}">
                <div class="drive-file-preview">
                    ${item.thumbnailLink ? `<img src="${thumbUrl}" alt="${escapeHTML(displayName)}">` : '<i class="fa-regular fa-file-pdf"></i>'}
                </div>
                <div>
                    <h3>${escapeHTML(displayName)}</h3>
                    <p>${formattedDate ? `Mis à jour ${formattedDate}` : 'PDF Google Drive'}${formattedSize ? ` &middot; ${formattedSize}` : ''}</p>
                </div>
                <div class="drive-card-actions">
                    <button class="drive-open-btn" data-action="open"><i class="fa-solid fa-book-open"></i>Lire</button>
                    <button class="drive-download-btn" data-action="download"><i class="fa-solid fa-download"></i>Télécharger</button>
                </div>
            </div>
        `;
    }).join('');

    grid.innerHTML = cards;
};

const handleDriveGridClick = (e) => {
    const card = e.target.closest('.drive-card');
    if (!card) return;

    if (card.dataset.disabled === 'true') {
        e.preventDefault();
        e.stopPropagation();
        return;
    }

    if (card.dataset.type === 'folder') {
        const folderId = card.dataset.folderId;
        if (!folderId) return;
        const folderName = decodeURIComponent(card.dataset.folderName || 'Dossier');
        const newBreadcrumb = [...mednvalDriveState.breadcrumb, { id: folderId, name: folderName }];
        loadMednvalDrive(folderId, newBreadcrumb);
        return;
    }

    if (card.dataset.type === 'file') {
        const downloadBtn = e.target.closest('.drive-download-btn');
        const resource = {
            id: card.dataset.driveId ? `drive-${card.dataset.driveId}` : undefined,
            title: decodeURIComponent(card.dataset.displayName || card.dataset.fileName || 'Document'),
            pdf: decodeURIComponent(card.dataset.fileUrl || ''),
            downloadUrl: decodeURIComponent(card.dataset.downloadUrl || ''),
            fileName: decodeURIComponent(card.dataset.fileName || '')
        };

        if (!resource.pdf) return;

        if (downloadBtn) {
            downloadDriveResource(resource);
            e.stopPropagation();
            return;
        }

        const openBtn = e.target.closest('.drive-open-btn');
        if (openBtn) {
            openPdfChoiceModal(resource);
            e.stopPropagation();
            return;
        }

        openPdfChoiceModal(resource);
    }
};

const handleDriveBreadcrumbClick = (e) => {
    const crumb = e.target.closest('.drive-crumb');
    if (!crumb || crumb.classList.contains('is-current')) return;

    const index = parseInt(crumb.dataset.index, 10);
    if (Number.isNaN(index) || !mednvalDriveState.breadcrumb[index]) return;

    const targetCrumb = mednvalDriveState.breadcrumb[index];
    const newBreadcrumb = mednvalDriveState.breadcrumb.slice(0, index + 1);
    loadMednvalDrive(targetCrumb.id, newBreadcrumb);
};

const downloadDriveResource = (resource) => {
    if (!resource || !resource.downloadUrl) return;
    const a = document.createElement('a');
    a.href = resource.downloadUrl;
    a.download = resource.fileName || `${resource.title}.pdf`;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
};
const showView = (viewId) => { document.querySelectorAll('.view').forEach(v => v.classList.remove('active')); const view = document.getElementById(viewId); if (view) view.classList.add('active'); };
const updateProfileUI = () => { if (currentUser) { document.getElementById('user-name').textContent = currentUser.username; document.getElementById('user-avatar').src = currentUser.avatar_url; } };
const toggleFullScreen = () => { const i = document.querySelector("#fullscreen-toggle i"); if (!document.fullscreenElement) { document.documentElement.requestFullscreen(); i.classList.replace("fa-expand", "fa-compress"); } else { document.exitFullscreen(); i.classList.replace("fa-compress", "fa-expand"); } };
const requestFullscreenMode = () => { 
    // Request fullscreen on first user interaction - improved for mobile
    let fullscreenRequested = false;
    const requestFullscreenOnce = (e) => {
        if (fullscreenRequested) return;
        fullscreenRequested = true;
        
        // Try different fullscreen methods for cross-browser compatibility
        const elem = document.documentElement;
        if (elem.requestFullscreen) {
            elem.requestFullscreen().catch(err => console.log('Fullscreen failed:', err));
        } else if (elem.webkitRequestFullscreen) {
            elem.webkitRequestFullscreen();
        } else if (elem.mozRequestFullScreen) {
            elem.mozRequestFullScreen();
        } else if (elem.msRequestFullscreen) {
            elem.msRequestFullscreen();
        }
        
        const i = document.querySelector("#fullscreen-toggle i");
        if (i) i.classList.replace("fa-expand", "fa-compress");
    };
    
    // Add multiple event listeners for better mobile support
    document.addEventListener('click', requestFullscreenOnce, true);
    document.addEventListener('touchend', requestFullscreenOnce, true);
    document.addEventListener('mousedown', requestFullscreenOnce, true);
};
const setupPWA = () => { if ('serviceWorker' in navigator) { caches.keys().then(cacheNames => { cacheNames.forEach(cacheName => { if (cacheName.startsWith('residanat-nktt') || cacheName.startsWith('resihub-mauritania') || cacheName.startsWith(`R${'\u00e9'}siHub-mauritania`)) { caches.delete(cacheName); console.log('Cleared old cache:', cacheName); } }); }); navigator.serviceWorker.register('./sw.js?v=resihub-20260626').then(registration => { console.log('Service Worker registered:', registration); registration.update(); }).catch(error => console.error('Service Worker registration failed:', error)); } };

// --- PWA INSTALL FUNCTIONALITY ---
const setupPWAInstall = () => { const installBtn = document.getElementById('install-btn'); if (installBtn) installBtn.style.display = 'none'; window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; if (installBtn && !window.matchMedia('(display-mode: standalone)').matches) { installBtn.style.display = 'flex'; } }); window.addEventListener('appinstalled', () => { if (installBtn) installBtn.style.display = 'none'; deferredPrompt = null; }); if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) { if (installBtn) installBtn.style.display = 'none'; } };
const installPWA = async () => { if (!deferredPrompt) { alert('L\'installation n\'est pas disponible pour le moment.'); return; } try { deferredPrompt.prompt(); const { outcome } = await deferredPrompt.userChoice; if (outcome === 'accepted') console.log('User accepted the install prompt'); else console.log('User dismissed the install prompt'); } catch (error) { console.error('Error showing install prompt:', error); } deferredPrompt = null; const installBtn = document.getElementById('install-btn'); if (installBtn) installBtn.style.display = 'none'; };

// --- SIDEBAR MANAGEMENT ---
const toggleSidebar = () => { const sidebar = document.getElementById('sidebar'); const overlay = document.getElementById('sidebar-overlay'); if (window.innerWidth <= 992) { sidebar.classList.toggle('active'); overlay.classList.toggle('active'); } };
const closeSidebar = () => { const sidebar = document.getElementById('sidebar'); const overlay = document.getElementById('sidebar-overlay'); if (window.innerWidth <= 992) { sidebar.classList.remove('active'); overlay.classList.remove('active'); } };
const renderProfileModal = () => { 
    if (!currentUser) return; 
    document.getElementById('modal-user-avatar').src = currentUser.avatar_url || 'https://via.placeholder.com/80x80/007AFF/FFFFFF?text=' + (currentUser.username ? currentUser.username.charAt(0).toUpperCase() : 'U'); 
    document.getElementById('modal-user-name').textContent = currentUser.username || 'Utilisateur'; 
    
    if (currentUser.isGuest) {
        // For guests, show actual progress from localStorage
        const progress = currentUser.progress || {}; 
        const completedCount = Object.values(progress).filter(Boolean).length; 
        const totalLectures = allLectures ? Object.values(allLectures).flat().length : 0; 
        const progressPercentage = totalLectures > 0 ? Math.round((completedCount / totalLectures) * 100) : 0; 
        document.getElementById('completed-count').textContent = completedCount; 
        document.getElementById('progress-percentage').textContent = `${progressPercentage}% (Invité)`;
    } else {
        const progress = currentUser.progress || {}; 
        const completedCount = Object.values(progress).filter(Boolean).length; 
        const totalLectures = allLectures ? Object.values(allLectures).flat().length : 0; 
        const progressPercentage = totalLectures > 0 ? Math.round((completedCount / totalLectures) * 100) : 0; 
        document.getElementById('completed-count').textContent = completedCount; 
        document.getElementById('progress-percentage').textContent = `${progressPercentage}%`; 
    }
};
const handleLogout = async () => {
    if (window.supabaseClient) await supabaseClient.auth.signOut();
    localStorage.removeItem('currentUser');
    localStorage.removeItem('portalGuest');
    window.location.href = mauritaniaLoginUrl();
};

// --- PDF VIEWER FUNCTIONS ---
const openPdfChoiceModal = (resource = null) => {
    const targetResource = resource || currentLecture;
    
    if (!targetResource || !targetResource.pdf) {
        alert('Document non disponible pour ce cours.');
        return;
    }
    
    currentPdfResource = {
        ...targetResource,
        title: targetResource.title || 'Cours PDF',
        pdf: targetResource.pdf,
        downloadUrl: targetResource.downloadUrl || targetResource.pdf,
        fileName: targetResource.fileName || `${(targetResource.title || 'document').replace(/[\\/:*?"<>|]/g, '-')}.pdf`
    };
    
    document.getElementById('pdf-choice-modal-overlay').classList.add('visible');
};

const closePdfChoiceModal = () => {
    document.getElementById('pdf-choice-modal-overlay').classList.remove('visible');
};

const openPdfViewer = () => {
    if (!currentPdfResource || !currentPdfResource.pdf) {
        alert('Document non disponible pour ce cours.');
        return;
    }
    closePdfChoiceModal();
    const pdfViewer = document.getElementById('pdf-viewer-modal-overlay');
    if (!pdfViewer) return;
    
    // Initialize or reset PDF state
    pageNum = 1;
    scale = 1.0;
    pageRendering = false;
    pageNumPending = null;
    
    // Show the viewer
    pdfViewer.classList.add('visible');
    
    // Initialize the PDF viewer
    loadPdf();
    initMobileTouchEvents();
    
    // Set focus to the viewer container for keyboard navigation
    setTimeout(() => {
        pdfViewer.focus();
        
        // Initialize buttons with proper ARIA labels
        const buttons = {
            'pdf-prev-page': 'Page précédente',
            'pdf-next-page': 'Page suivante',
            'pdf-zoom-in': 'Zoom avant',
            'pdf-zoom-out': 'Zoom arrière',
            'pdf-reset-zoom': 'Réinitialiser le zoom',
            'pdf-download': 'Télécharger le PDF',
            'pdf-fullscreen': 'Plein écran',
            'pdf-close': 'Fermer la visionneuse'
        };
        
        Object.entries(buttons).forEach(([id, label]) => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.setAttribute('aria-label', label);
                btn.setAttribute('role', 'button');
                btn.setAttribute('tabindex', '0');
            }
        });
    }, 100);
};

const closePdfViewer = () => {
    const pdfViewer = document.getElementById('pdf-viewer-modal-overlay');
    pdfViewer.classList.remove('visible');
    
    // Clean up event listeners
    
    // Clean up PDF resources
    if (pageRendering && renderTask) {
        renderTask.cancel();
    }
    
    // Clear the canvas
    const canvas = document.getElementById('pdf-canvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    
    // Reset state
    pdfDoc = null;
    pdfData = null;
    pageNum = 1;
    scale = 1.0;
    pageRendering = false;
    pageNumPending = null;
    renderTask = null;
    pageCache.clear();
    currentPdfResource = null;
};

const downloadPdf = () => {
    if (!currentPdfResource || !currentPdfResource.pdf) return;
    
    // Create download link
    const a = document.createElement('a');
    a.href = currentPdfResource.downloadUrl || currentPdfResource.pdf;
    a.download = currentPdfResource.fileName || `${currentPdfResource.title}.pdf`;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    closePdfChoiceModal();
};

const loadPdf = async () => {
    if (!currentPdfResource || !currentPdfResource.pdf) return;
    
    const loadingScreen = document.getElementById('pdf-loading');
    const canvas = document.getElementById('pdf-canvas');
    const title = document.getElementById('pdf-title');
    
    loadingScreen.classList.remove('hidden');
    title.textContent = currentPdfResource.title;
    
    try {
        // Fetch PDF data with better error handling
        // Add cache-busting query parameter to ensure we get the latest version
        const pdfUrl = `${currentPdfResource.pdf}${currentPdfResource.pdf.includes('?') ? '&' : '?'}v=${Date.now()}`;
        const response = await fetch(pdfUrl, {
            cache: 'no-cache', // Don't use cache to ensure latest PDF version
            headers: {
                'Accept': 'application/pdf'
            }
        });
        if (!response.ok) throw new Error(`Failed to load PDF: ${response.status}`);
        
        const arrayBuffer = await response.arrayBuffer();
        pdfData = new Uint8Array(arrayBuffer);
        
        // Load PDF with optimized options
        const loadingTask = pdfjsLib.getDocument({
            data: pdfData,
            ...PDF_RENDER_OPTIONS
        });
        
        pdfDoc = await loadingTask.promise;
        
        // Clear cache when loading new PDF
        pageCache.clear();
        
        // Update UI
        document.getElementById('pdf-page-info').textContent = `1 / ${pdfDoc.numPages}`;
        
        // Enable buttons
        document.getElementById('pdf-prev-page').disabled = false;
        document.getElementById('pdf-next-page').disabled = false;
        document.getElementById('pdf-zoom-in').disabled = false;
        document.getElementById('pdf-zoom-out').disabled = false;
        document.getElementById('pdf-reset-zoom').disabled = false;
        document.getElementById('pdf-download').disabled = false;
        document.getElementById('pdf-fullscreen').disabled = false;
        
        // Render first page with smooth transition
        await renderPdfPage(1);
        
        loadingScreen.classList.add('hidden');
    } catch (error) {
        console.error('Error loading PDF:', error);
        alert('Erreur lors du chargement du PDF');
        loadingScreen.classList.add('hidden');
        closePdfViewer();
    }
};

// Keyboard navigation for PDF viewer has been removed

// Add smooth canvas transitions
const addCanvasTransition = () => {
    const canvas = document.getElementById('pdf-canvas');
    if (canvas) {
        canvas.classList.add('loading');
        canvas.classList.remove('rendered');
    }
};

const removeCanvasTransition = () => {
    const canvas = document.getElementById('pdf-canvas');
    if (canvas) {
        canvas.classList.remove('loading');
        canvas.classList.add('rendered');
    }
};

const renderPdfPage = async (pageNumber) => {
    if (!pdfDoc) return;
    
    // Cancel any ongoing rendering
    if (pageRendering) {
        pageRendering = false;
        if (renderTask) {
            renderTask.cancel();
        }
    }
    
    pageRendering = true;
    addCanvasTransition(); // Add smooth transition
    
    const canvas = document.getElementById('pdf-canvas');
    const ctx = canvas.getContext('2d');
    const container = document.getElementById('pdf-viewer-container');
    
    try {
        // Check cache first
        const cacheKey = `${pageNumber}_${scale}`;
        if (pageCache.has(cacheKey)) {
            const cachedData = pageCache.get(cacheKey);
            canvas.width = cachedData.width;
            canvas.height = cachedData.height;
            canvas.style.width = cachedData.styleWidth;
            canvas.style.height = cachedData.styleHeight;
            ctx.putImageData(cachedData.imageData, 0, 0);
            pageNum = pageNumber;
            document.getElementById('pdf-page-info').textContent = `${pageNum} / ${pdfDoc.numPages}`;
            updatePageButtons();
            pageRendering = false;
            return;
        }
        
        const page = await pdfDoc.getPage(pageNumber);
        
        // Calculate scale with better performance
        const containerWidth = container.clientWidth - 40;
        const containerHeight = container.clientHeight - 100;
        
        const viewport = page.getViewport({ scale: 1.0 });
        const scaleX = containerWidth / viewport.width;
        const scaleY = containerHeight / viewport.height;
        const autoScale = Math.min(scaleX, scaleY, 2.0);
        
        const finalScale = scale === 1.0 ? autoScale : scale;
        const finalViewport = page.getViewport({ scale: finalScale });
        
        // Optimize canvas for high DPI displays
        const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2); // Cap at 2x for performance
        canvas.width = finalViewport.width * devicePixelRatio;
        canvas.height = finalViewport.height * devicePixelRatio;
        canvas.style.width = finalViewport.width + 'px';
        canvas.style.height = finalViewport.height + 'px';
        
        // Enable hardware acceleration
        ctx.scale(devicePixelRatio, devicePixelRatio);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        
        // Enable WebGL if available
        if (ctx.getContextAttributes) {
            const attributes = ctx.getContextAttributes();
            if (attributes && attributes.alpha === false) {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, finalViewport.width, finalViewport.height);
            }
        }
        
        const renderContext = {
            canvasContext: ctx,
            viewport: finalViewport,
            intent: 'display', // Optimize for display
            enableWebGL: true
        };
        
        // Render with progress tracking
        renderTask = page.render(renderContext);
        await renderTask.promise;
        
        // Cache the rendered page
        if (pageCache.size < 10) { // Limit cache size
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            pageCache.set(cacheKey, {
                imageData: imageData,
                width: canvas.width,
                height: canvas.height,
                styleWidth: canvas.style.width,
                styleHeight: canvas.style.height
            });
        }
        
        pageNum = pageNumber;
        document.getElementById('pdf-page-info').textContent = `${pageNum} / ${pdfDoc.numPages}`;
        updatePageButtons();
        
        // Preload adjacent pages for smoother navigation
        preloadAdjacentPages(pageNumber);
        
    } catch (error) {
        if (error.name !== 'RenderingCancelledException') {
            console.error('Error rendering PDF page:', error);
        }
    } finally {
        pageRendering = false;
        renderTask = null;
        removeCanvasTransition(); // Remove loading state
    }
};

// Preload adjacent pages for smoother navigation
const preloadAdjacentPages = async (currentPage) => {
    if (!pdfDoc) return;
    
    const pagesToPreload = [];
    if (currentPage > 1) pagesToPreload.push(currentPage - 1);
    if (currentPage < pdfDoc.numPages) pagesToPreload.push(currentPage + 1);
    
    // Preload pages in background
    pagesToPreload.forEach(async (pageNum) => {
        const cacheKey = `${pageNum}_${scale}`;
        if (!pageCache.has(cacheKey)) {
            try {
                const page = await pdfDoc.getPage(pageNum);
                const viewport = page.getViewport({ scale: scale === 1.0 ? 1.0 : scale });
                
                // Create offscreen canvas for preloading
                const offscreenCanvas = document.createElement('canvas');
                const offscreenCtx = offscreenCanvas.getContext('2d');
                
                const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
                offscreenCanvas.width = viewport.width * devicePixelRatio;
                offscreenCanvas.height = viewport.height * devicePixelRatio;
                
                offscreenCtx.scale(devicePixelRatio, devicePixelRatio);
                offscreenCtx.imageSmoothingEnabled = true;
                offscreenCtx.imageSmoothingQuality = 'high';
                
                const renderContext = {
                    canvasContext: offscreenCtx,
                    viewport: viewport,
                    intent: 'display'
                };
                
                await page.render(renderContext).promise;
                
                // Cache the preloaded page
                if (pageCache.size < 10) {
                    const imageData = offscreenCtx.getImageData(0, 0, offscreenCanvas.width, offscreenCanvas.height);
                    pageCache.set(cacheKey, {
                        imageData: imageData,
                        width: offscreenCanvas.width,
                        height: offscreenCanvas.height,
                        styleWidth: viewport.width + 'px',
                        styleHeight: viewport.height + 'px'
                    });
                }
            } catch (error) {
                console.warn(`Failed to preload page ${pageNum}:`, error);
            }
        }
    });
};

const zoomIn = () => {
    if (scale < 3) {
        scale += 0.25;
        // Clear cache when zoom changes
        pageCache.clear();
        renderPdfPage(pageNum);
    }
};

const zoomOut = () => {
    if (scale > 0.25) {
        scale -= 0.25;
        // Clear cache when zoom changes
        pageCache.clear();
        renderPdfPage(pageNum);
    }
};

const resetZoom = () => {
    scale = 1.0; // Reset to auto-fit
    // Clear cache when zoom changes
    pageCache.clear();
    renderPdfPage(pageNum);
};

const goToPrevPage = () => {
    if (pageNum > 1 && !pageRendering) {
        renderPdfPage(pageNum - 1);
    }
};

const goToNextPage = () => {
    if (pageNum < pdfDoc.numPages && !pageRendering) {
        renderPdfPage(pageNum + 1);
    }
};

const updatePageButtons = () => {
    const prevBtn = document.getElementById('pdf-prev-page');
    const nextBtn = document.getElementById('pdf-next-page');
    
    if (prevBtn) prevBtn.disabled = pageNum <= 1;
    if (nextBtn) nextBtn.disabled = pageNum >= pdfDoc.numPages;
};

const downloadPdfFromViewer = () => {
    if (!currentPdfResource || !currentPdfResource.pdf) return;
    
    const a = document.createElement('a');
    a.href = currentPdfResource.downloadUrl || currentPdfResource.pdf;
    a.download = currentPdfResource.fileName || `${currentPdfResource.title}.pdf`;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
};

const togglePdfFullscreen = () => {
    const modal = document.getElementById('pdf-viewer-modal');
    const btn = document.getElementById('pdf-fullscreen');
    
    if (!document.fullscreenElement) {
        modal.requestFullscreen().then(() => {
            btn.innerHTML = '<i class="fas fa-compress"></i>';
        });
    } else {
        document.exitFullscreen().then(() => {
            btn.innerHTML = '<i class="fas fa-expand"></i>';
        });
    }
};

// Handle keyboard navigation for PDF viewer
const handlePdfKeyboard = (e) => {
    // Only handle keyboard events when the PDF viewer is open
    if (!document.getElementById('pdf-viewer-modal-overlay').classList.contains('visible')) {
        return;
    }
    
    switch(e.key) {
        case 'ArrowLeft':
            e.preventDefault();
            goToPrevPage();
            break;
        case 'ArrowRight':
            e.preventDefault();
            goToNextPage();
            break;
        case 'Escape':
            e.preventDefault();
            closePdfViewer();
            break;
        case '+':
        case '=':
            e.preventDefault();
            zoomIn();
            break;
        case '-':
            e.preventDefault();
            zoomOut();
            break;
        case '0':
            e.preventDefault();
            resetZoom();
            break;
    }
};

// Global keyboard shortcuts
const handleGlobalKeyboard = (e) => {
    // Don't interfere with input fields
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    switch(e.key) {
        case 'Enter':
            // Submit quiz answer if in practice mode
            const validateBtn = document.querySelector('.practice-validate-btn');
            if (validateBtn && !validateBtn.disabled) {
                e.preventDefault();
                validateBtn.click();
            }
            break;
        case 'Escape':
            // Close any open modals
            e.preventDefault();
            closeAllModals();
            break;
        case '?':
            // Toggle keyboard shortcuts help
            e.preventDefault();
            toggleKeyboardShortcuts();
            break;
    }
};

// Confirmation dialog functions
let pendingConfirmation = null;

const showConfirmationDialog = (title, message, onConfirm) => {
    const dialog = document.getElementById('confirmation-dialog');
    if (dialog) {
        // Ensure the dialog is visible before adding the show class
        dialog.style.display = 'block';
        
        // Set the content
        const titleEl = dialog.querySelector('#confirmation-title');
        const messageEl = dialog.querySelector('#confirmation-message');
        
        if (titleEl) titleEl.textContent = title;
        if (messageEl) messageEl.textContent = message;
        
        // Force a reflow to ensure the transition works
        void dialog.offsetWidth;
        
        // Add the show class to trigger the animation
        dialog.classList.add('show');
        
        // Store the confirmation callback
        pendingConfirmation = onConfirm;
    }
};

const hideConfirmationDialog = () => {
    const dialog = document.getElementById('confirmation-dialog');
    if (dialog) {
        // Add a small delay to allow for the hide animation to complete
        dialog.classList.remove('show');
        // Reset the dialog state
        dialog.style.display = 'none';
        // Clear any pending confirmation
        pendingConfirmation = null;
        
        // Force a reflow to ensure the animation plays
        void dialog.offsetWidth;
    }
};

const confirmAction = async () => {
    if (pendingConfirmation) {
        try {
            // Store the confirmation function and clear it immediately
            const confirmation = pendingConfirmation;
            pendingConfirmation = null;
            
            // Hide the dialog first
            hideConfirmationDialog();
            
            // Then execute the confirmation action
            await Promise.resolve(confirmation());
        } catch (error) {
            console.error('Error in confirmation action:', error);
        }
    } else {
        hideConfirmationDialog();
    }
};

// Keyboard shortcuts toggle
const toggleKeyboardShortcuts = () => {
    const shortcuts = document.getElementById('keyboard-shortcuts');
    shortcuts.classList.toggle('show');
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
        shortcuts.classList.remove('show');
    }, 5000);
};

// Close all modals
const closeAllModals = () => {
    document.querySelectorAll('.modal-overlay.visible').forEach(modal => {
        modal.classList.remove('visible');
    });
    hideConfirmationDialog();
};

// Haptic feedback for mobile devices
const triggerHapticFeedback = (type = 'light') => {
    if ('vibrate' in navigator) {
        switch(type) {
            case 'success':
                navigator.vibrate([50, 50, 50]); // Success pattern
                break;
            case 'error':
                navigator.vibrate([100, 50, 100]); // Error pattern
                break;
            case 'warning':
                navigator.vibrate([200]); // Warning pattern
                break;
            case 'light':
            default:
                navigator.vibrate(50); // Light feedback
                break;
        }
    }
};

// Enhanced touch interactions
const enhanceTouchInteractions = () => {
    // Add touch feedback to buttons
    document.addEventListener('touchstart', (e) => {
        if (e.target.matches('button, .btn, .action-card')) {
            e.target.style.transform = 'scale(0.98)';
            triggerHapticFeedback('light');
        }
    }, { passive: true });
    
    document.addEventListener('touchend', (e) => {
        if (e.target.matches('button, .btn, .action-card')) {
            e.target.style.transform = 'scale(1)';
        }
    }, { passive: true });
    
    // Add touch feedback to quiz options
    document.addEventListener('touchstart', (e) => {
        if (e.target.matches('.quiz-options label')) {
            e.target.style.transform = 'scale(0.98)';
            triggerHapticFeedback('light');
        }
    }, { passive: true });
    
    document.addEventListener('touchend', (e) => {
        if (e.target.matches('.quiz-options label')) {
            e.target.style.transform = 'scale(1)';
        }
    }, { passive: true });
};

// Offline functionality
const setupOfflineDetection = () => {
    window.addEventListener('online', () => {
        isOnline = true;
        showOfflineIndicator(false);
        processOfflineQueue();
    });
    
    window.addEventListener('offline', () => {
        isOnline = false;
        showOfflineIndicator(true);
    });
    
    // Initial state
    showOfflineIndicator(!isOnline);
};

const showOfflineIndicator = (offline) => {
    const indicator = document.getElementById('offline-indicator');
    if (indicator) {
        if (offline) {
            indicator.className = 'offline-indicator show offline';
            indicator.innerHTML = '<i class="fas fa-wifi-slash"></i><span>Mode hors ligne</span>';
        } else {
            indicator.className = 'offline-indicator show online';
            indicator.innerHTML = '<i class="fas fa-wifi"></i><span>Connexion rétablie</span>';
            // Hide after 3 seconds
            setTimeout(() => {
                indicator.classList.remove('show');
            }, 3000);
        }
    }
};

const processOfflineQueue = async () => {
    if (offlineQueue.length > 0) {
        console.log(`Processing ${offlineQueue.length} queued actions...`);
        for (const action of offlineQueue) {
            try {
                await action();
            } catch (error) {
                console.error('Error processing queued action:', error);
            }
        }
        offlineQueue = [];
    }
};

const queueOfflineAction = (action) => {
    offlineQueue.push(action);
    console.log('Action queued for when online');
};

// Enhanced fetch with offline support
const fetchWithOfflineSupport = async (url, options = {}) => {
    try {
        const response = await fetch(url, options);
        return response;
    } catch (error) {
        if (!isOnline) {
            // Try to get from cache
            const cachedResponse = await caches.match(url);
            if (cachedResponse) {
                return cachedResponse;
            }
        }
        throw error;
    }
};

// Analytics functions
const showAnalyticsView = () => {
    showView('analytics-view');
    updateAnalytics();
    renderAnalyticsBookmarks();
};

const updateAnalytics = () => {
    if (!currentUser || !allLectures) return;
    
    const progress = currentUser.progress || {};
    const completedCount = Object.values(progress).filter(Boolean).length;
    const totalLectures = Object.values(allLectures).flat().length;
    const progressPercentage = totalLectures > 0 ? Math.round((completedCount / totalLectures) * 100) : 0;
    
    // Update progress ring
    updateProgressRing(progressPercentage);
    
    // Update analytics cards
    document.getElementById('completed-lectures-count').textContent = completedCount;
    document.getElementById('progress-percentage-text').textContent = `${progressPercentage}%`;
    
    // Calculate total questions answered (estimate based on completed lectures)
    const totalQuestionsAnswered = calculateTotalQuestionsAnswered();
    document.getElementById('total-questions-answered').textContent = totalQuestionsAnswered;
    
    // Calculate study time (estimate)
    const studyTime = calculateStudyTime();
    document.getElementById('study-time').textContent = studyTime;
    
    // Calculate study streak
    const studyStreak = calculateStudyStreak();
    document.getElementById('study-streak-days').textContent = `${studyStreak} jours consécutifs`;
};

const updateProgressRing = (percentage) => {
    const progressRing = document.getElementById('progress-ring');
    if (progressRing) {
        const circumference = 2 * Math.PI * 52; // radius = 52
        const offset = circumference - (percentage / 100) * circumference;
        progressRing.style.strokeDasharray = `${circumference} ${circumference}`;
        progressRing.style.strokeDashoffset = offset;
    }
};

const calculateTotalQuestionsAnswered = () => {
    if (!currentUser || !allLectures) return 0;
    
    const progress = currentUser.progress || {};
    let totalQuestions = 0;
    
    // Estimate based on completed lectures
    Object.keys(progress).forEach(lectureId => {
        if (progress[lectureId]) {
            const lecture = findLectureById(lectureId);
            if (lecture && lecture.training) {
                // Estimate average questions per lecture (this is a rough estimate)
                totalQuestions += 30; // Average questions per lecture
            }
        }
    });
    
    return totalQuestions;
};

const calculateStudyTime = () => {
    if (!currentUser) return '0h';
    
    const progress = currentUser.progress || {};
    const completedCount = Object.values(progress).filter(Boolean).length;
    
    // Estimate 2 hours per completed lecture
    const totalHours = completedCount * 2;
    
    if (totalHours < 1) return '0h';
    if (totalHours < 24) return `${totalHours}h`;
    
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    
    if (hours === 0) return `${days}j`;
    return `${days}j ${hours}h`;
};

const calculateStudyStreak = () => {
    // This is a simplified calculation
    // In a real app, you'd track actual study sessions
    const progress = currentUser?.progress || {};
    const completedCount = Object.values(progress).filter(Boolean).length;
    
    // Simple streak calculation based on completed lectures
    return Math.min(completedCount, 30); // Max 30 days for demo
};

// Bookmark functionality
const toggleBookmark = (button) => {
    const bookmarkId = button.dataset.bookmarkId;
    const question = button.dataset.question;
    const answer = button.dataset.answer;
    const quizIndex = parseInt(button.closest('.question-card').dataset.questionIndex);
    
    if (!bookmarks[currentLecture.id]) {
        bookmarks[currentLecture.id] = [];
    }
    
    const existingIndex = bookmarks[currentLecture.id].findIndex(b => b.quizIndex === quizIndex);
    
    if (existingIndex > -1) {
        // Remove bookmark
        bookmarks[currentLecture.id].splice(existingIndex, 1);
        if (bookmarks[currentLecture.id].length === 0) {
            delete bookmarks[currentLecture.id];
        }
        button.classList.remove('bookmarked');
        triggerHapticFeedback('light');
        console.log('Bookmark removed');
    } else {
        // Add bookmark
        bookmarks[currentLecture.id].push({
            quizIndex: quizIndex,
            question: question,
            answer: answer,
            date: new Date().toISOString()
        });
        button.classList.add('bookmarked');
        triggerHapticFeedback('success');
        console.log('Bookmark added');
    }
    
    // Save to localStorage
    localStorage.setItem('bookmarks', JSON.stringify(bookmarks));
};

const getBookmarksForLecture = (lectureId) => {
    return bookmarks[lectureId] || [];
};

const renderBookmarksPanel = () => {
    if (!currentLecture) return '';
    
    const lectureBookmarks = getBookmarksForLecture(currentLecture.id);
    
    if (lectureBookmarks.length === 0) {
        return '';
    }
    
    let html = `
        <div class="bookmarks-panel">
            <div class="bookmarks-header">
                <h3 class="bookmarks-title">Questions Favorites</h3>
                <span class="bookmarks-count">${lectureBookmarks.length}</span>
            </div>
    `;
    
    lectureBookmarks.forEach(bookmark => {
        html += `
            <div class="bookmark-item">
                <div class="bookmark-question">Q${bookmark.quizIndex + 1}: ${bookmark.question.substring(0, 80)}${bookmark.question.length > 80 ? '...' : ''}</div>
                <div class="bookmark-actions">
                    <button class="bookmark-remove-btn" data-lecture-id="${currentLecture.id}" data-quiz-index="${bookmark.quizIndex}">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    return html;
};

// Render bookmarks in analytics view
const renderAnalyticsBookmarks = () => {
    const bookmarksList = document.getElementById('bookmarks-list');
    const bookmarksCount = document.getElementById('total-bookmarks-count');
    
    if (!bookmarksList || !bookmarksCount) return;

    // Get all bookmarks from all lectures
    const allBookmarks = [];
    Object.keys(bookmarks).forEach(lectureId => {
        const lectureBookmarks = bookmarks[lectureId] || [];
        const lectureName = allLectures.find(l => l.id === lectureId)?.name || 'Cours inconnu';
        
        lectureBookmarks.forEach(bookmark => {
            allBookmarks.push({
                ...bookmark,
                lectureId,
                lectureName
            });
        });
    });

    // Sort by date (newest first)
    allBookmarks.sort((a, b) => new Date(b.date) - new Date(a.date));

    bookmarksCount.textContent = allBookmarks.length;

    if (allBookmarks.length === 0) {
        bookmarksList.innerHTML = `
            <div style="text-align: center; padding: 40px; color: var(--text-secondary);">
                <div style="font-size: 2rem; margin-bottom: 16px;">ðŸ“–</div>
                <p>Aucune question favorite pour le moment</p>
                <p style="font-size: 0.9rem; margin-top: 8px;">Marquez des questions pendant vos révisions pour les retrouver ici</p>
            </div>
        `;
        return;
    }

    bookmarksList.innerHTML = allBookmarks.map(bookmark => `
        <div class="bookmark-analytics-item" data-lecture-id="${bookmark.lectureId}" data-quiz-index="${bookmark.quizIndex}">
            <div class="bookmark-question-text">${bookmark.question}</div>
            <div class="bookmark-answer-text">Réponse: ${bookmark.answer}</div>
            <div class="bookmark-meta">
                <span class="bookmark-lecture-name">${bookmark.lectureName}</span>
                <span class="bookmark-date">${new Date(bookmark.date).toLocaleDateString('fr-FR')}</span>
            </div>
            <div class="bookmark-actions-analytics">
                <button class="bookmark-view-btn" data-lecture-id="${bookmark.lectureId}" data-quiz-index="${bookmark.quizIndex}">
                    Voir la Question
                </button>
                <button class="bookmark-remove-btn-analytics" data-lecture-id="${bookmark.lectureId}" data-quiz-index="${bookmark.quizIndex}">
                    Supprimer
                </button>
            </div>
        </div>
    `).join('');
};

const removeBookmark = (lectureId, quizIndex) => {
    if (!bookmarks[lectureId]) return;
    
    const lectureBookmarks = bookmarks[lectureId];
    const index = lectureBookmarks.findIndex(b => b.quizIndex === quizIndex);
    
    if (index > -1) {
        lectureBookmarks.splice(index, 1);
        if (lectureBookmarks.length === 0) {
            delete bookmarks[lectureId];
        }
        localStorage.setItem('bookmarks', JSON.stringify(bookmarks));
        
        // Update the bookmark button if it exists
        const button = document.querySelector(`[data-bookmark-id="${lectureId}_${quizIndex}"]`);
        if (button) {
            button.classList.remove('bookmarked');
        }
        
        // Re-render the practice view to update bookmarks panel
        if (currentTrainingData) {
            renderPracticeView(currentTrainingData);
        }
        
        triggerHapticFeedback('light');
    }
};

const removeBookmarkFromAnalytics = (lectureId, quizIndex) => {
    if (!bookmarks[lectureId]) return;
    
    const lectureBookmarks = bookmarks[lectureId];
    const index = lectureBookmarks.findIndex(b => b.quizIndex === quizIndex);
    
    if (index > -1) {
        lectureBookmarks.splice(index, 1);
        if (lectureBookmarks.length === 0) {
            delete bookmarks[lectureId];
        }
        localStorage.setItem('bookmarks', JSON.stringify(bookmarks));
        renderAnalyticsBookmarks();
    }
}
