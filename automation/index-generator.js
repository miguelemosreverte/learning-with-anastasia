#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const handlebars = require('handlebars');

class IndexGenerator {
    constructor() {
        this.chaptersDir = path.join(__dirname, '..', 'chapters');
        this.outputPath = path.join(__dirname, '..', 'index.html');
        this.chapters = [];
    }

    async generateIndex() {
        console.log('\n📚 Starting Index Generation');
        console.log('=' .repeat(60));
        
        // Load all chapter data
        await this.loadChapters();
        
        // Sort chapters by issue number
        this.chapters.sort((a, b) => a.issueNumber - b.issueNumber);
        
        // Generate HTML
        const html = this.renderHTML();
        
        // Write to file
        fs.writeFileSync(this.outputPath, html);
        console.log(`\n✅ Index generated successfully: ${this.outputPath}`);
        
        return this.chapters;
    }

    async loadChapters() {
        const files = fs.readdirSync(this.chaptersDir)
            .filter(file => file.endsWith('.yaml'));
        
        for (const file of files) {
            const filePath = path.join(this.chaptersDir, file);
            console.log(`📖 Loading: ${file}`);
            
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                const data = yaml.load(content);
                
                // Extract chapter metadata
                const chapterInfo = this.extractChapterInfo(data, file);
                if (chapterInfo) {
                    this.chapters.push(chapterInfo);
                }
            } catch (error) {
                console.error(`   ⚠️ Error loading ${file}: ${error.message}`);
            }
        }
        
        console.log(`\n📚 Loaded ${this.chapters.length} chapters`);
    }

    extractChapterInfo(data, filename) {
        // Handle both full chapters and metadata-only files
        if (data.meta) {
            // Metadata-only file
            const meta = data.meta;
            return {
                id: meta.id,
                title: meta.title || this.formatTitle(meta.id),
                titleEn: (meta.title && meta.title.en) || this.formatTitle(meta.id),
                titleEs: (meta.title && meta.title.es) || '',
                titleRu: (meta.title && meta.title.ru) || '',
                folderName: meta.folderName,
                issueNumber: meta.issueNumber || 999,
                coverImage: meta.coverImage || `${meta.folderName}/assets/images/magazine-cover.jpg`,
                description: meta.subtitle || meta.description || {},
                descriptionEn: (meta.subtitle && meta.subtitle.en) || '',
                descriptionEs: (meta.subtitle && meta.subtitle.es) || '',
                descriptionRu: (meta.subtitle && meta.subtitle.ru) || '',
                hasGeneratedContent: meta.hasGeneratedContent !== false,
                searchContent: this.buildSearchContent(data)
            };
        } else if (data.chapterTitle) {
            // Full chapter with content
            const folderName = filename.replace('.yaml', '');
            return {
                id: folderName,
                title: data.chapterTitle.en,
                folderName: folderName,
                issueNumber: data.issueNumber || 999,
                coverImage: `${folderName}/assets/images/magazine-cover.jpg`,
                description: data.subtitle || {},
                hasGeneratedContent: true,
                searchContent: this.buildSearchContent(data)
            };
        }
        
        return null;
    }

    buildSearchContent(data) {
        const content = [];
        
        // Add meta title and subtitle in all languages
        if (data.meta) {
            if (data.meta.title && typeof data.meta.title === 'object') {
                Object.values(data.meta.title).forEach(title => content.push(title));
            }
            if (data.meta.subtitle && typeof data.meta.subtitle === 'object') {
                Object.values(data.meta.subtitle).forEach(sub => content.push(sub));
            }
        }
        
        // Add title and subtitle
        if (data.chapterTitle) {
            Object.values(data.chapterTitle).forEach(title => content.push(title));
        }
        if (data.subtitle) {
            Object.values(data.subtitle).forEach(sub => content.push(sub));
        }
        
        // Add section content
        if (data.sections && Array.isArray(data.sections)) {
            data.sections.forEach(section => {
                if (section.title && typeof section.title === 'object') {
                    Object.values(section.title).forEach(title => content.push(title));
                }
                if (section.content && typeof section.content === 'object') {
                    Object.values(section.content).forEach(text => content.push(text));
                }
            });
        }
        
        // Add fun facts
        if (data.funFacts && Array.isArray(data.funFacts)) {
            data.funFacts.forEach(fact => {
                if (fact.title) {
                    Object.values(fact.title).forEach(title => content.push(title));
                }
                if (fact.content) {
                    Object.values(fact.content).forEach(text => content.push(text));
                }
            });
        }
        
        return content.join(' ').toLowerCase();
    }

    formatTitle(id) {
        return id
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    renderHTML() {
        const template = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Learning with Anastasia - Magazine Collection</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;600;700&family=Merriweather:wght@300;400;700&family=Source+Sans+Pro:wght@300;400;600&display=swap');
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Source Sans Pro', sans-serif;
            background: #000;
            color: #fff;
            min-height: 100vh;
        }

        .header {
            background: linear-gradient(135deg, #000 0%, #1a1a1a 100%);
            padding: 40px 0;
            text-align: center;
            border-bottom: 3px solid #FFCC00;
            position: relative;
        }
        

        .header h1 {
            font-family: 'Oswald', sans-serif;
            font-size: 3.5rem;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 3px;
            color: #FFCC00;
            margin-bottom: 10px;
        }

        .header p {
            font-size: 1.2rem;
            color: #ccc;
            font-weight: 300;
            letter-spacing: 2px;
            text-transform: uppercase;
        }

        .language-selector {
            position: fixed;
            top: 20px;
            right: 20px;
            display: flex;
            gap: 10px;
            z-index: 1000;
        }

        .language-selector button {
            width: 50px;
            height: 50px;
            border: 2px solid #FFCC00;
            border-radius: 50%;
            background-size: cover;
            background-position: center;
            cursor: pointer;
            transition: all 0.3s ease;
            opacity: 0.6;
        }

        .language-selector button.active {
            opacity: 1;
            box-shadow: 0 0 15px rgba(255, 204, 0, 0.5);
            transform: scale(1.1);
        }

        .language-selector button:hover {
            opacity: 0.9;
            transform: scale(1.05);
        }

        .language-selector button[data-lang="en"] {
            background-image: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 30"><rect width="60" height="30" fill="%2300247D"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="white" stroke-width="6"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="%23CF142B" stroke-width="4"/><path d="M30,0 v30 M0,15 h60" stroke="white" stroke-width="10"/><path d="M30,0 v30 M0,15 h60" stroke="%23CF142B" stroke-width="6"/></svg>');
        }

        .language-selector button[data-lang="es"] {
            background-image: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><rect width="3" height="2" fill="%23c60b1e"/><rect width="3" height="1" y="0.5" fill="%23ffc400"/></svg>');
        }

        .language-selector button[data-lang="ru"] {
            background-image: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><rect width="3" height="0.667" fill="white"/><rect width="3" height="0.667" y="0.667" fill="%230039a6"/><rect width="3" height="0.666" y="1.334" fill="%23d52b1e"/></svg>');
        }


        .search-container {
            max-width: 800px;
            margin: 40px auto;
            position: relative;
            padding: 0 40px;
        }

        .search-box {
            width: 100%;
            padding: 15px 20px;
            font-size: 1.1rem;
            border: 2px solid #FFCC00;
            background: #1a1a1a;
            color: #fff;
            border-radius: 4px;
            transition: all 0.3s ease;
        }

        .search-box:focus {
            outline: none;
            background: #222;
            box-shadow: 0 0 20px rgba(255, 204, 0, 0.3);
        }

        .search-box::placeholder {
            color: #888;
        }

        .search-icon {
            position: absolute;
            right: 60px;
            top: 50%;
            transform: translateY(-50%);
            color: #FFCC00;
            pointer-events: none;
        }

        .magazine-grid {
            max-width: 1400px;
            margin: 60px auto;
            padding: 0 40px;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 40px;
        }

        .magazine-card {
            background: #111;
            border-radius: 4px;
            overflow: hidden;
            transition: transform 0.3s ease, box-shadow 0.3s ease;
            cursor: pointer;
            position: relative;
            text-decoration: none;
            color: inherit;
            display: block;
        }

        .magazine-card:hover {
            transform: translateY(-10px);
            box-shadow: 0 20px 40px rgba(255, 204, 0, 0.3);
        }

        .magazine-card.hidden {
            display: none;
        }

        .magazine-cover {
            position: relative;
            height: 500px;
            overflow: hidden;
        }
        
        .magazine-cover img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            transition: transform 0.5s ease;
        }
        
        .magazine-card:hover .magazine-cover img {
            transform: scale(1.1);
        }

        .magazine-info {
            padding: 30px;
            background: linear-gradient(to bottom, #1a1a1a, #111);
        }

        .issue-number {
            position: absolute;
            top: 20px;
            right: 20px;
            background: #FFCC00;
            color: #000;
            padding: 8px 16px;
            font-family: 'Oswald', sans-serif;
            font-weight: 700;
            font-size: 1.2rem;
            letter-spacing: 1px;
        }

        .magazine-title {
            font-family: 'Oswald', sans-serif;
            font-size: 1.8rem;
            font-weight: 700;
            text-transform: uppercase;
            color: #FFCC00;
            margin-bottom: 10px;
            letter-spacing: 1px;
        }

        .magazine-subtitle {
            font-family: 'Merriweather', serif;
            font-size: 1rem;
            color: #aaa;
            margin-bottom: 15px;
            line-height: 1.6;
        }

        .no-results {
            text-align: center;
            color: #FFCC00;
            font-size: 1.2rem;
            margin-top: 50px;
            display: none;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(-20px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .footer {
            background: #111;
            padding: 60px 40px;
            margin-top: 100px;
            border-top: 3px solid #FFCC00;
            text-align: center;
        }

        .footer h3 {
            font-family: 'Oswald', sans-serif;
            font-size: 2rem;
            color: #FFCC00;
            margin-bottom: 20px;
            text-transform: uppercase;
            letter-spacing: 2px;
        }

        .footer p {
            color: #888;
            font-size: 1rem;
            line-height: 1.8;
            margin-bottom: 15px;
        }

        .footer .copyright {
            margin-top: 40px;
            padding-top: 30px;
            border-top: 1px solid #333;
            color: #666;
            font-size: 0.9rem;
        }

        @media (max-width: 768px) {
            .header h1 {
                font-size: 2rem;
            }
            
            .magazine-grid {
                grid-template-columns: 1fr;
                padding: 0 20px;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1 data-en="Learning with Anastasia" data-es="Aprendiendo con Anastasia" data-ru="Учимся с Анастасией">Learning with Anastasia</h1>
        <p data-en="Wildlife Magazine Collection" data-es="Colección de Revistas de Vida Silvestre" data-ru="Коллекция журналов о дикой природе">Wildlife Magazine Collection</p>
        <div class="language-selector">
            <button data-lang="en" class="active" title="English"></button>
            <button data-lang="es" title="Español"></button>
            <button data-lang="ru" title="Русский"></button>
        </div>
    </div>

    <div class="search-container">
        <input type="text" class="search-box" id="searchInput" 
               placeholder="Search for animals, habitats, or topics..."
               data-placeholder-en="Search for animals, habitats, or topics..."
               data-placeholder-es="Buscar animales, hábitats o temas..."
               data-placeholder-ru="Поиск животных, мест обитания или тем...">
        <span class="search-icon">🔍</span>
    </div>

    <div class="magazine-grid" id="magazineGrid">
        {{#each chapters}}
        <div class="magazine-card" data-search="{{searchContent}}" onclick="window.location.href='{{folderName}}/index.html'">
            <div class="issue-number">Issue #{{issueNumber}}</div>
            <div class="magazine-cover">
                <img src="{{coverImage}}" alt="{{title}}" onerror="this.src='assets/placeholder-cover.jpg'">
            </div>
            <div class="magazine-info">
                <h2 class="magazine-title" data-en="{{titleEn}}" data-es="{{titleEs}}" data-ru="{{titleRu}}">{{titleEn}}</h2>
                <p class="magazine-subtitle" data-en="{{descriptionEn}}" data-es="{{descriptionEs}}" data-ru="{{descriptionRu}}">{{descriptionEn}}</p>
            </div>
        </div>
        {{/each}}
    </div>

    <div class="no-results" id="noResults">
        No magazines found. Try a different search term.
    </div>

    <div class="footer">
        <h3 data-en="About Learning with Anastasia" data-es="Acerca de Aprendiendo con Anastasia" data-ru="О программе Учимся с Анастасией">About Learning with Anastasia</h3>
        <p data-en="An educational journey through the amazing world of wildlife, designed to inspire young minds to explore, learn, and protect our planet's incredible creatures." 
           data-es="Un viaje educativo a través del increíble mundo de la vida silvestre, diseñado para inspirar a las mentes jóvenes a explorar, aprender y proteger las increíbles criaturas de nuestro planeta."
           data-ru="Образовательное путешествие по удивительному миру дикой природы, созданное для того, чтобы вдохновить юные умы исследовать, учиться и защищать невероятных существ нашей планеты.">
            An educational journey through the amazing world of wildlife, designed to inspire young minds to explore, learn, and protect our planet's incredible creatures.
        </p>
        <p data-en="Each magazine issue takes you on a unique adventure, combining stunning visuals with fascinating facts and interactive learning experiences."
           data-es="Cada número de la revista te lleva a una aventura única, combinando imágenes impresionantes con hechos fascinantes y experiencias de aprendizaje interactivas."
           data-ru="Каждый выпуск журнала отправляет вас в уникальное приключение, сочетая потрясающие визуальные эффекты с увлекательными фактами и интерактивным обучением.">
            Each magazine issue takes you on a unique adventure, combining stunning visuals with fascinating facts and interactive learning experiences.
        </p>
        <div class="copyright">
            <p data-en="© 2025 Learning with Anastasia. Created with love for curious young explorers everywhere."
               data-es="© 2025 Aprendiendo con Anastasia. Creado con amor para jóvenes exploradores curiosos de todo el mundo."
               data-ru="© 2025 Учимся с Анастасией. Создано с любовью для любознательных юных исследователей по всему миру.">
                © 2025 Learning with Anastasia. Created with love for curious young explorers everywhere.
            </p>
        </div>
    </div>

    <script>
        // Language switching
        let currentLang = 'en';
        
        function switchLanguage(lang) {
            currentLang = lang;
            
            // Update active button
            document.querySelectorAll('.language-selector button').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.lang === lang);
            });
            
            // Update all text elements
            document.querySelectorAll('[data-' + lang + ']').forEach(element => {
                if (element.tagName === 'INPUT' && element.hasAttribute('data-placeholder-' + lang)) {
                    element.placeholder = element.getAttribute('data-placeholder-' + lang);
                } else {
                    element.textContent = element.getAttribute('data-' + lang);
                }
            });
        }
        
        // Add language button listeners
        document.querySelectorAll('.language-selector button').forEach(button => {
            button.addEventListener('click', () => switchLanguage(button.dataset.lang));
        });
        
        // Search functionality
        const searchInput = document.getElementById('searchInput');
        const magazineGrid = document.getElementById('magazineGrid');
        const noResults = document.getElementById('noResults');
        const cards = magazineGrid.querySelectorAll('.magazine-card');

        // Search with ranking
        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            let visibleCount = 0;
            
            if (searchTerm === '') {
                // Show all cards in original order
                cards.forEach(card => {
                    card.classList.remove('hidden');
                    card.style.order = '';
                });
                noResults.style.display = 'none';
                return;
            }
            
            // Calculate relevance scores
            const scores = [];
            cards.forEach((card, index) => {
                const searchContent = card.dataset.search || '';
                const title = card.querySelector('.magazine-title').textContent.toLowerCase();
                
                let score = 0;
                
                // Exact title match gets highest score
                if (title === searchTerm) {
                    score = 1000;
                }
                // Title contains search term
                else if (title.includes(searchTerm)) {
                    score = 500;
                }
                // Content contains search term
                else if (searchContent.includes(searchTerm)) {
                    // Score based on frequency
                    const regex = new RegExp(searchTerm, 'gi');
                    const matches = searchContent.match(regex);
                    score = matches ? matches.length : 0;
                }
                
                scores.push({ card, score, index });
            });
            
            // Sort by score and update display
            scores.sort((a, b) => b.score - a.score);
            
            scores.forEach((item, order) => {
                if (item.score > 0) {
                    item.card.classList.remove('hidden');
                    item.card.style.order = order;
                    visibleCount++;
                } else {
                    item.card.classList.add('hidden');
                }
            });
            
            // Show/hide no results message
            noResults.style.display = visibleCount === 0 ? 'block' : 'none';
        });

        // Add smooth scroll
        document.querySelectorAll('.magazine-card').forEach(card => {
            card.addEventListener('mouseenter', function() {
                this.style.zIndex = '10';
            });
            card.addEventListener('mouseleave', function() {
                this.style.zIndex = '';
            });
        });
    </script>
</body>
</html>`;

        const compiledTemplate = handlebars.compile(template);
        return compiledTemplate({ chapters: this.chapters });
    }
}

// Run if called directly
if (require.main === module) {
    const generator = new IndexGenerator();
    generator.generateIndex().catch(console.error);
}

module.exports = IndexGenerator;