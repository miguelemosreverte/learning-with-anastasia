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
                folderName: meta.folderName,
                issueNumber: meta.issueNumber || 999,
                coverImage: meta.coverImage || `${meta.folderName}/assets/images/magazine-cover.jpg`,
                description: meta.description || {},
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
    <title>Wildlife Magazine Collection</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Georgia', serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }

        .header {
            text-align: center;
            color: white;
            margin-bottom: 40px;
            animation: fadeIn 1s ease-in;
        }

        .header h1 {
            font-size: 3rem;
            margin-bottom: 10px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }

        .header p {
            font-size: 1.2rem;
            opacity: 0.9;
        }

        .search-container {
            max-width: 600px;
            margin: 0 auto 40px;
            position: relative;
        }

        .search-box {
            width: 100%;
            padding: 15px 20px;
            font-size: 1.1rem;
            border: none;
            border-radius: 50px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            transition: box-shadow 0.3s ease;
        }

        .search-box:focus {
            outline: none;
            box-shadow: 0 6px 12px rgba(0,0,0,0.2);
        }

        .search-icon {
            position: absolute;
            right: 20px;
            top: 50%;
            transform: translateY(-50%);
            color: #999;
            pointer-events: none;
        }

        .magazine-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
            gap: 30px;
            max-width: 1200px;
            margin: 0 auto;
        }

        .magazine-card {
            background: white;
            border-radius: 15px;
            overflow: hidden;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            transition: all 0.3s ease;
            cursor: pointer;
            position: relative;
        }

        .magazine-card:hover {
            transform: translateY(-10px) scale(1.02);
            box-shadow: 0 15px 40px rgba(0,0,0,0.3);
        }

        .magazine-card.hidden {
            display: none;
        }

        .magazine-cover {
            width: 100%;
            height: 350px;
            object-fit: cover;
        }

        .magazine-info {
            padding: 20px;
        }

        .issue-number {
            position: absolute;
            top: 10px;
            right: 10px;
            background: rgba(255,255,255,0.9);
            color: #333;
            padding: 5px 10px;
            border-radius: 20px;
            font-weight: bold;
            font-size: 0.9rem;
        }

        .magazine-title {
            font-size: 1.3rem;
            color: #333;
            margin-bottom: 10px;
        }

        .magazine-description {
            color: #666;
            font-size: 0.95rem;
            line-height: 1.4;
        }

        .no-results {
            text-align: center;
            color: white;
            font-size: 1.2rem;
            margin-top: 50px;
            display: none;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(-20px); }
            to { opacity: 1; transform: translateY(0); }
        }

        @media (max-width: 768px) {
            .header h1 {
                font-size: 2rem;
            }
            
            .magazine-grid {
                grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
                gap: 20px;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🌊 Wildlife Magazine Collection</h1>
        <p>Explore amazing stories from the natural world</p>
    </div>

    <div class="search-container">
        <input type="text" class="search-box" id="searchInput" placeholder="Search for animals, habitats, or topics...">
        <span class="search-icon">🔍</span>
    </div>

    <div class="magazine-grid" id="magazineGrid">
        {{#each chapters}}
        <div class="magazine-card" data-search="{{searchContent}}" onclick="window.location.href='{{folderName}}/index.html'">
            <div class="issue-number">Issue #{{issueNumber}}</div>
            <img src="{{coverImage}}" alt="{{title}}" class="magazine-cover" onerror="this.src='assets/placeholder-cover.jpg'">
            <div class="magazine-info">
                <h2 class="magazine-title">{{title}}</h2>
                {{#if description.en}}
                <p class="magazine-description">{{description.en}}</p>
                {{/if}}
            </div>
        </div>
        {{/each}}
    </div>

    <div class="no-results" id="noResults">
        No magazines found. Try a different search term.
    </div>

    <script>
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