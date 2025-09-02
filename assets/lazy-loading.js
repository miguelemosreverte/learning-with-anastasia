// Progressive Image Loading with Intersection Observer
// This script handles lazy loading of images with low-res placeholders

(function() {
    'use strict';

    // Configuration
    const config = {
        rootMargin: '50px', // Start loading 50px before image enters viewport
        threshold: 0.01, // Trigger when 1% of image is visible
        fadeInDuration: 300 // Milliseconds for fade-in effect
    };

    // Initialize lazy loading
    function initLazyLoading() {
        const images = document.querySelectorAll('img[data-src]');
        
        if ('IntersectionObserver' in window) {
            const imageObserver = new IntersectionObserver(handleIntersection, {
                rootMargin: config.rootMargin,
                threshold: config.threshold
            });

            images.forEach(img => {
                // Set up placeholder if available
                if (img.dataset.placeholder) {
                    img.src = img.dataset.placeholder;
                    img.classList.add('lazy-placeholder');
                }
                imageObserver.observe(img);
            });
        } else {
            // Fallback for older browsers
            loadAllImages(images);
        }
    }

    // Handle intersection observer callback
    function handleIntersection(entries, observer) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                loadHighResImage(img);
                observer.unobserve(img);
            }
        });
    }

    // Load high-resolution image
    function loadHighResImage(img) {
        const highResSrc = img.dataset.src;
        
        // Create a new image element to preload
        const tempImg = new Image();
        
        tempImg.onload = function() {
            // Apply the high-res image
            img.src = highResSrc;
            img.classList.remove('lazy-placeholder');
            img.classList.add('lazy-loaded');
            
            // Clean up data attributes
            delete img.dataset.src;
            delete img.dataset.placeholder;
            
            // Trigger fade-in animation
            requestAnimationFrame(() => {
                img.style.animation = `fadeIn ${config.fadeInDuration}ms ease-in-out`;
            });
        };
        
        tempImg.onerror = function() {
            console.error('Failed to load image:', highResSrc);
            img.classList.add('lazy-error');
        };
        
        // Start loading the high-res image
        tempImg.src = highResSrc;
    }

    // Fallback: Load all images immediately
    function loadAllImages(images) {
        images.forEach(img => {
            if (img.dataset.src) {
                img.src = img.dataset.src;
                img.classList.add('lazy-loaded');
            }
        });
    }

    // Add CSS for lazy loading effects
    function addLazyLoadingStyles() {
        const style = document.createElement('style');
        style.textContent = `
            img.lazy-placeholder {
                filter: blur(5px);
                transform: scale(1.05);
                transition: filter 0.3s, transform 0.3s;
            }
            
            img.lazy-loaded {
                filter: blur(0);
                transform: scale(1);
            }
            
            img.lazy-error {
                opacity: 0.5;
                border: 2px solid #ff0000;
            }
            
            @keyframes fadeIn {
                from { opacity: 0.8; }
                to { opacity: 1; }
            }
            
            /* Skeleton loader for images without placeholders */
            img[data-src]:not([src]) {
                background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
                background-size: 200% 100%;
                animation: loading 1.5s infinite;
            }
            
            @keyframes loading {
                0% { background-position: 200% 0; }
                100% { background-position: -200% 0; }
            }
        `;
        document.head.appendChild(style);
    }

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            addLazyLoadingStyles();
            initLazyLoading();
        });
    } else {
        addLazyLoadingStyles();
        initLazyLoading();
    }

    // Re-initialize when new content is added dynamically
    window.initNewLazyImages = function() {
        initLazyLoading();
    };

    // Preload critical images (hero images)
    window.preloadCriticalImages = function() {
        const criticalImages = document.querySelectorAll('img.critical');
        criticalImages.forEach(img => {
            if (img.dataset.src) {
                loadHighResImage(img);
            }
        });
    };
})();