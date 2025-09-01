// Shared language switcher functionality for all pages

// Get current language from localStorage or default to English
let currentLang = localStorage.getItem('selectedLanguage') || 'en';

// Create and inject language switcher HTML
function createLanguageSwitcher() {
    const switcherHTML = `
        <div class="language-switcher">
            <button class="lang-btn ${currentLang === 'en' ? 'active' : ''}" data-lang="en" title="English">
                <div class="flag-emoji">🇬🇧</div>
            </button>
            <button class="lang-btn ${currentLang === 'es' ? 'active' : ''}" data-lang="es" title="Español">
                <div class="flag-emoji">🇪🇸</div>
            </button>
            <button class="lang-btn ${currentLang === 'ru' ? 'active' : ''}" data-lang="ru" title="Русский">
                <div class="flag-emoji">🇷🇺</div>
            </button>
        </div>
    `;
    
    // Add CSS if not already present
    if (!document.querySelector('#language-switcher-styles')) {
        const styles = `
            <style id="language-switcher-styles">
                .language-switcher {
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    display: flex;
                    gap: 15px;
                    z-index: 1000;
                }
                
                .lang-btn {
                    width: 50px;
                    height: 50px;
                    border-radius: 50%;
                    border: 3px solid transparent;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    overflow: hidden;
                    position: relative;
                    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
                    background: white;
                }
                
                .lang-btn:hover {
                    transform: scale(1.1);
                    border-color: #FFCC00;
                    box-shadow: 0 4px 20px rgba(255, 204, 0, 0.4);
                }
                
                .lang-btn.active {
                    border-color: #FFCC00;
                    transform: scale(1.05);
                }
                
                .flag-emoji {
                    width: 100%;
                    height: 100%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 30px;
                }
            </style>
        `;
        document.head.insertAdjacentHTML('beforeend', styles);
    }
    
    // Insert the switcher at the beginning of body
    document.body.insertAdjacentHTML('afterbegin', switcherHTML);
    
    // Add click handlers
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const lang = this.getAttribute('data-lang');
            setLanguage(lang);
        });
    });
}

// Set the active language
function setLanguage(lang) {
    currentLang = lang;
    localStorage.setItem('selectedLanguage', lang);
    
    // Update active button
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-lang') === lang) {
            btn.classList.add('active');
        }
    });
    
    // Update content based on page
    if (typeof updateContent === 'function') {
        updateContent(lang);
    }
    
    // Update multilingual images if they exist
    updateMultilingualImages(lang);
}

// Function to swap images based on language
function updateMultilingualImages(lang) {
    const multilingImages = document.querySelectorAll('.multilang-image');
    
    multilingImages.forEach(img => {
        const baseName = img.getAttribute('data-multilang-src');
        if (baseName) {
            const currentSrc = img.src;
            const pathParts = currentSrc.split('/');
            const filename = pathParts[pathParts.length - 1];
            
            // Check if language-specific version exists
            // For English, use the base image (no .en suffix)
            let newFilename;
            if (lang === 'en') {
                newFilename = `${baseName}.jpg`;
            } else {
                // For Spanish and Russian, check if the translated version exists
                // by attempting to set it and falling back if needed
                newFilename = `${baseName}.${lang}.jpg`;
            }
            
            // Build new path
            pathParts[pathParts.length - 1] = newFilename;
            const newSrc = pathParts.join('/');
            
            // Only update if different
            if (currentSrc !== newSrc) {
                // Create a test image to check if the translated version exists
                const testImg = new Image();
                testImg.onload = function() {
                    // Image exists, use it
                    img.src = newSrc;
                };
                testImg.onerror = function() {
                    // Image doesn't exist, keep the English version
                    if (lang !== 'en') {
                        console.log(`No ${lang} version for ${baseName}, keeping English`);
                    }
                };
                testImg.src = newSrc;
            }
        }
    });
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    createLanguageSwitcher();
    setLanguage(currentLang);
});