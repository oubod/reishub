// Performance Optimization Module
// Add this at the beginning of app.js or load it separately

// ===== DEBOUNCE & THROTTLE UTILITIES =====
const debounce = (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};

const throttle = (func, limit) => {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
};

// ===== REQUEST ANIMATION FRAME UTILITIES =====
const rafThrottle = (callback) => {
    let requestId = null;
    let lastArgs;
    
    const later = (context) => () => {
        requestId = null;
        callback.apply(context, lastArgs);
    };
    
    const throttled = function(...args) {
        lastArgs = args;
        if (requestId === null) {
            requestId = requestAnimationFrame(later(this));
        }
    };
    
    throttled.cancel = () => {
        cancelAnimationFrame(requestId);
        requestId = null;
    };
    
    return throttled;
};

// ===== LAZY LOADING FOR IMAGES =====
const lazyLoadImages = () => {
    const images = document.querySelectorAll('img[data-src]');
    const imageObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                img.src = img.dataset.src;
                img.removeAttribute('data-src');
                imageObserver.unobserve(img);
            }
        });
    }, {
        rootMargin: '50px'
    });
    
    images.forEach(img => imageObserver.observe(img));
};

// ===== VIRTUAL SCROLLING FOR LONG LISTS =====
class VirtualScroller {
    constructor(container, items, renderItem, itemHeight = 60) {
        this.container = container;
        this.items = items;
        this.renderItem = renderItem;
        this.itemHeight = itemHeight;
        this.visibleItems = Math.ceil(container.clientHeight / itemHeight) + 2;
        this.startIndex = 0;
        this.init();
    }
    
    init() {
        this.container.style.position = 'relative';
        this.container.style.overflow = 'auto';
        
        const totalHeight = this.items.length * this.itemHeight;
        const spacer = document.createElement('div');
        spacer.style.height = `${totalHeight}px`;
        spacer.style.pointerEvents = 'none';
        this.container.appendChild(spacer);
        
        this.viewport = document.createElement('div');
        this.viewport.style.position = 'absolute';
        this.viewport.style.top = '0';
        this.viewport.style.left = '0';
        this.viewport.style.right = '0';
        this.container.appendChild(this.viewport);
        
        this.container.addEventListener('scroll', throttle(() => this.render(), 16));
        this.render();
    }
    
    render() {
        const scrollTop = this.container.scrollTop;
        this.startIndex = Math.floor(scrollTop / this.itemHeight);
        const endIndex = Math.min(this.startIndex + this.visibleItems, this.items.length);
        
        this.viewport.innerHTML = '';
        this.viewport.style.transform = `translateY(${this.startIndex * this.itemHeight}px)`;
        
        for (let i = this.startIndex; i < endIndex; i++) {
            const item = this.renderItem(this.items[i], i);
            this.viewport.appendChild(item);
        }
    }
    
    update(newItems) {
        this.items = newItems;
        this.render();
    }
}

// ===== DOM BATCH UPDATES =====
const batchDOMUpdates = (updates) => {
    requestAnimationFrame(() => {
        updates.forEach(update => update());
    });
};

// ===== MEMORY MANAGEMENT =====
const clearUnusedCache = () => {
    // Clear old page cache if it gets too large
    if (typeof pageCache !== 'undefined' && pageCache.size > 10) {
        const entries = Array.from(pageCache.entries());
        entries.slice(0, entries.length - 5).forEach(([key]) => {
            pageCache.delete(key);
        });
    }
};

// ===== OPTIMIZE ANIMATIONS =====
const optimizeAnimations = () => {
    // Add will-change to frequently animated elements
    const animatedElements = document.querySelectorAll('.modal-overlay, .sidebar, #loader-overlay');
    animatedElements.forEach(el => {
        el.style.willChange = 'transform, opacity';
    });
    
    // Remove will-change after animation
    document.addEventListener('transitionend', (e) => {
        if (e.target.style.willChange) {
            e.target.style.willChange = 'auto';
        }
    });
};

// ===== REDUCE REFLOWS =====
const measureAndUpdate = (measureFn, updateFn) => {
    const measurements = measureFn();
    requestAnimationFrame(() => updateFn(measurements));
};

// ===== OPTIMIZE EVENT LISTENERS =====
const addPassiveListener = (element, event, handler) => {
    element.addEventListener(event, handler, { passive: true });
};

// ===== PRELOAD CRITICAL RESOURCES =====
const preloadResource = (url, type = 'fetch') => {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.href = url;
    link.as = type;
    document.head.appendChild(link);
};

// ===== OPTIMIZE PDF RENDERING =====
const optimizePDFRendering = () => {
    return {
        enableWebGL: true,
        disableAutoFetch: false,
        disableStream: false,
        useSystemFonts: true,
        maxImageSize: 1024 * 1024,
        isEvalSupported: false,
        useWorkerFetch: true,
        verbosity: 0
    };
};

// ===== REDUCE PAINT COMPLEXITY =====
const optimizeStyles = () => {
    // Use transform instead of top/left for animations
    const style = document.createElement('style');
    style.textContent = `
        .optimized-animation {
            transform: translateZ(0);
            backface-visibility: hidden;
            perspective: 1000px;
        }
        
        .gpu-accelerated {
            will-change: transform;
            transform: translateZ(0);
        }
        
        .smooth-scroll {
            scroll-behavior: smooth;
            -webkit-overflow-scrolling: touch;
        }
    `;
    document.head.appendChild(style);
};

// ===== INITIALIZE ALL OPTIMIZATIONS =====
const initPerformanceOptimizations = () => {
    // Run optimizations when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            optimizeAnimations();
            optimizeStyles();
            lazyLoadImages();
        });
    } else {
        optimizeAnimations();
        optimizeStyles();
        lazyLoadImages();
    }
    
    // Clear cache periodically
    setInterval(clearUnusedCache, 60000); // Every minute
    
    // Monitor performance
    if ('PerformanceObserver' in window) {
        const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                if (entry.duration > 50) {
                    console.warn(`Slow operation detected: ${entry.name} took ${entry.duration}ms`);
                }
            }
        });
        observer.observe({ entryTypes: ['measure'] });
    }
};

// Export utilities
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        debounce,
        throttle,
        rafThrottle,
        lazyLoadImages,
        VirtualScroller,
        batchDOMUpdates,
        clearUnusedCache,
        optimizeAnimations,
        measureAndUpdate,
        addPassiveListener,
        preloadResource,
        optimizePDFRendering,
        optimizeStyles,
        initPerformanceOptimizations
    };
}

// Auto-initialize if loaded in browser
if (typeof window !== 'undefined') {
    window.PerformanceOptimizer = {
        debounce,
        throttle,
        rafThrottle,
        lazyLoadImages,
        VirtualScroller,
        batchDOMUpdates,
        clearUnusedCache,
        optimizeAnimations,
        measureAndUpdate,
        addPassiveListener,
        preloadResource,
        optimizePDFRendering,
        optimizeStyles,
        init: initPerformanceOptimizations
    };
    
    // Auto-initialize only after DOM is ready to avoid conflicts
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPerformanceOptimizations);
    } else {
        initPerformanceOptimizations();
    }
}
