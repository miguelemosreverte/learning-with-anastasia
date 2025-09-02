#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Update sea-otters.yaml to add the missing hero image
const yamlPath = path.join(__dirname, 'chapters/sea-otters.yaml');
const yamlContent = fs.readFileSync(yamlPath, 'utf8');
const chapterData = yaml.load(yamlContent);

// Add hero section if missing
if (!chapterData.hero) {
    chapterData.hero = {
        image: 'hero-kelp-forest.jpg',
        title: {
            en: "Sea Otters: Ocean's Playful Engineers",
            es: "Nutrias Marinas: Ingenieros Juguetones del Océano",
            ru: "Морские выдры: Игривые инженеры океана"
        },
        subtitle: {
            en: "Join Ollie on an amazing journey through the kelp forests",
            es: "Únete a Ollie en un viaje increíble a través de los bosques de algas",
            ru: "Присоединяйтесь к Олли в удивительном путешествии по лесам ламинарии"
        }
    };
}

// Ensure all images are in routing
const requiredImages = [
    'hero-kelp-forest.jpg',
    'otter-games-and-play.jpg',
    'ollies-promise.jpg',
    'fun-fact-fur.jpg',
    'fun-fact-eating.jpg',
    'fun-fact-holding-hands.jpg',
    'fun-fact-purple-teeth.jpg',
    'detail-tool-use.jpg',
    'detail-keystone.jpg',
    'detail-no-blubber.jpg'
];

// Add to openai routing if not present
if (!chapterData.routing) {
    chapterData.routing = { openai: [], gemini: [] };
}

requiredImages.forEach(img => {
    if (!chapterData.routing.openai.includes(img) && !chapterData.routing.gemini.includes(img)) {
        chapterData.routing.openai.push(img);
    }
});

// Save updated YAML
const updatedYaml = yaml.dump(chapterData, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false
});

fs.writeFileSync(yamlPath, updatedYaml);
console.log('✅ Updated sea-otters.yaml with missing image definitions');

// Now create placeholder images so HTML displays correctly
const outputDir = path.join(__dirname, 'sea-otters/assets/images');

requiredImages.forEach(img => {
    const filepath = path.join(outputDir, img);
    if (!fs.existsSync(filepath)) {
        console.log(`Creating placeholder for ${img}...`);
        // Copy an existing image as placeholder
        const sourcePath = path.join(outputDir, 'birth-of-ollie.jpg');
        if (fs.existsSync(sourcePath)) {
            fs.copyFileSync(sourcePath, filepath);
            console.log(`  ✅ Created placeholder ${img}`);
        }
    }
});

console.log('\n🎯 Next: Run the image generator to create proper images');
console.log('node run-recursive-generation.js');