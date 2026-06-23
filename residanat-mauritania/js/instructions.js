// Minimal Instructions Page JavaScript

// Step navigation functionality
let currentStep = 1;
const totalSteps = 4;

// Initialize the page
document.addEventListener('DOMContentLoaded', function() {
    initializeNavigation();
    initializeEventListeners();
    updateProgress();
    
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
    };
    
    // Add multiple event listeners for better mobile support
    document.addEventListener('click', requestFullscreenOnce, true);
    document.addEventListener('touchend', requestFullscreenOnce, true);
    document.addEventListener('mousedown', requestFullscreenOnce, true);
});

// Navigation functions
function initializeNavigation() {
    // Set up step navigation
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const navDots = document.querySelectorAll('.nav-dot');
    const stepIndicators = document.querySelectorAll('.step-indicator');
    
    // Previous button
    prevBtn.addEventListener('click', () => {
        if (currentStep > 1) {
            currentStep--;
            updateStep();
        }
    });
    
    // Next button
    nextBtn.addEventListener('click', () => {
        if (currentStep < totalSteps) {
            currentStep++;
            updateStep();
        } else if (currentStep === totalSteps) {
            // On last step, proceed to login
            goToLogin();
        }
    });
    
    // Navigation dots
    navDots.forEach((dot, index) => {
        dot.addEventListener('click', () => {
            currentStep = index + 1;
            updateStep();
        });
    });
    
    // Step indicators
    stepIndicators.forEach((indicator, index) => {
        indicator.addEventListener('click', () => {
            currentStep = index + 1;
            updateStep();
        });
    });
    
    // Touch/swipe support for mobile
    let touchStartX = 0;
    let touchEndX = 0;
    
    document.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
    });
    
    document.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    });
    
    function handleSwipe() {
        const swipeThreshold = 50;
        const diff = touchStartX - touchEndX;
        
        if (Math.abs(diff) > swipeThreshold) {
            if (diff > 0 && currentStep < totalSteps) {
                // Swipe left - next step
                currentStep++;
                updateStep();
            } else if (diff < 0 && currentStep > 1) {
                // Swipe right - previous step
                currentStep--;
                updateStep();
            }
        }
    }
}

function updateStep() {
    // Update step pages
    document.querySelectorAll('.step-page').forEach((page, index) => {
        if (index + 1 === currentStep) {
            page.classList.add('active');
        } else {
            page.classList.remove('active');
        }
    });
    
    // Update step indicators
    document.querySelectorAll('.step-indicator').forEach((indicator, index) => {
        if (index + 1 === currentStep) {
            indicator.classList.add('active');
        } else {
            indicator.classList.remove('active');
        }
    });
    
    // Update navigation dots
    document.querySelectorAll('.nav-dot').forEach((dot, index) => {
        if (index + 1 === currentStep) {
            dot.classList.add('active');
        } else {
            dot.classList.remove('active');
        }
    });
    
    // Update navigation buttons
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    
    prevBtn.disabled = currentStep === 1;
    
    // Change next button text and behavior on last step
    if (currentStep === totalSteps) {
        nextBtn.querySelector('span').textContent = 'Proceed to Login';
        nextBtn.disabled = false;
        nextBtn.onclick = function() {
            goToLogin();
        };
    } else {
        nextBtn.querySelector('span').textContent = 'Suivant';
        nextBtn.disabled = false;
        nextBtn.onclick = null;
    }
    
    // Update progress bar
    updateProgress();
    
    // Add smooth transition
    const stepsWrapper = document.querySelector('.steps-wrapper');
    stepsWrapper.style.transform = `translateX(-${(currentStep - 1) * 100}%)`;
}

function updateProgress() {
    const progressFill = document.getElementById('progress-fill');
    const progressPercentage = (currentStep / totalSteps) * 100;
    progressFill.style.width = `${progressPercentage}%`;
}

// Proceed button function
function nextStep() {
    if (currentStep < totalSteps) {
        currentStep++;
        updateStep();
    }
}

// Event listeners
function initializeEventListeners() {
    // Add keyboard navigation
    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft' && currentStep > 1) {
            currentStep--;
            updateStep();
        } else if (e.key === 'ArrowRight' && currentStep < totalSteps) {
            currentStep++;
            updateStep();
        }
    });
    
    // Add smooth scroll behavior
    document.documentElement.style.scrollBehavior = 'smooth';
}

// Copy bank number function
function copyBankNumber() {
    const bankNumber = '27265400';
    
    // Create temporary input element
    const tempInput = document.createElement('input');
    tempInput.value = bankNumber;
    document.body.appendChild(tempInput);
    tempInput.select();
    tempInput.setSelectionRange(0, 99999); // For mobile devices
    
    try {
        // Copy to clipboard
        document.execCommand('copy');
        
        // Show success feedback
        showNotification('Numéro copié!', 'success');
    } catch (err) {
        // Fallback for older browsers
        showNotification('Erreur lors de la copie', 'error');
    }
    
    document.body.removeChild(tempInput);
}

// Notification system
function showNotification(message, type = 'info') {
    // Remove existing notifications
    const existingNotification = document.querySelector('.notification');
    if (existingNotification) {
        existingNotification.remove();
    }
    
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    // Style the notification
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'success' ? '#34c759' : type === 'error' ? '#ff3b30' : '#007AFF'};
        color: white;
        padding: 12px 16px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        z-index: 1000;
        font-weight: 500;
        font-size: 14px;
        transform: translateX(100%);
        transition: transform 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 100);
    
    // Auto remove after 3 seconds
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 300);
    }, 3000);
}

// Navigation functions
function goToGuestLogin() {
    // Add loading effect
    const button = (arguments[0] && arguments[0].currentTarget) || event?.currentTarget || null;
    if (button) button.style.transform = 'scale(0.95)';
    
    setTimeout(() => {
        // Set guest flag and mark instructions as seen
        sessionStorage.setItem('isGuest', 'true');
        localStorage.setItem('hasSeenInstructions', 'true');
        window.location.href = 'index.html';
    }, 150);
}

function goToLogin() {
    // Add loading effect
    const button = (arguments[0] && arguments[0].currentTarget) || event?.currentTarget || null;
    if (button) button.style.transform = 'scale(0.95)';
    
    setTimeout(() => {
        // Mark instructions as seen
        localStorage.setItem('hasSeenInstructions', 'true');
        window.location.href = 'login.html';
    }, 150);
}

// Finish instructions (called from final step)
function finishInstructions() {
    // Mark instructions as seen and go to landing page
    localStorage.setItem('hasSeenInstructions', 'true');
    showNotification('Instructions terminées', 'success');
    setTimeout(() => {
        window.location.href = 'index.html';
    }, 400);
}

// Smooth page transitions
window.addEventListener('beforeunload', function() {
    document.body.style.opacity = '0';
    document.body.style.transform = 'scale(0.98)';
});

// Add loading states for better UX
function addLoadingState(element) {
    element.style.position = 'relative';
    element.style.pointerEvents = 'none';
    
    const loader = document.createElement('div');
    loader.className = 'button-loader';
    loader.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 16px;
        height: 16px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-top: 2px solid white;
        border-radius: 50%;
        animation: spin 1s linear infinite;
    `;
    
    element.appendChild(loader);
}

// Add spin animation for loader
const spinCSS = `
    @keyframes spin {
        0% { transform: translate(-50%, -50%) rotate(0deg); }
        100% { transform: translate(-50%, -50%) rotate(360deg); }
    }
`;

const spinStyle = document.createElement('style');
spinStyle.textContent = spinCSS;
document.head.appendChild(spinStyle);