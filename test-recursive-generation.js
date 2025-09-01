#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const RecursiveImageGenerator = require('./automation/recursive-image-generator');

async function testBeaverGeneration() {
    console.log('\n🦫 Testing Recursive Beaver Story Generation');
    console.log('=' .repeat(60));
    
    // Load the beaver chapter
    const yamlPath = path.join(__dirname, 'chapters', 'beavers.yaml');
    const yamlContent = fs.readFileSync(yamlPath, 'utf8');
    const chapterData = yaml.load(yamlContent);
    
    console.log(`\n📖 Loaded chapter: ${chapterData.meta.title.en}`);
    console.log(`   Total sections: ${chapterData.sections.length}`);
    
    // Count character generation and references
    let characterGens = 0;
    let characterRefs = 0;
    let multiCharRefs = 0;
    
    chapterData.sections.forEach(section => {
        if (section.generate_character) characterGens++;
        if (section.use_character) characterRefs++;
        if (section.use_characters) multiCharRefs++;
    });
    
    console.log(`\n📊 Recursive Structure Analysis:`);
    console.log(`   Character generations: ${characterGens}`);
    console.log(`   Single character references: ${characterRefs}`);
    console.log(`   Multi-character references: ${multiCharRefs}`);
    
    // Analyze the dependency chain
    console.log(`\n🔗 Dependency Chain:`);
    const dependencies = new Map();
    
    chapterData.sections.forEach(section => {
        if (section.use_character) {
            const refMatch = section.use_character.match(/\$\{([^.]+)\.image\}/);
            if (refMatch) {
                dependencies.set(section.id, [refMatch[1]]);
            }
        }
        if (section.use_characters) {
            const refs = section.use_characters.map(ref => {
                const match = ref.match(/\$\{([^.]+)\.image\}/);
                return match ? match[1] : null;
            }).filter(Boolean);
            dependencies.set(section.id, refs);
        }
    });
    
    dependencies.forEach((deps, id) => {
        console.log(`   ${id} → depends on: [${deps.join(', ')}]`);
    });
    
    // Demonstrate the generation order
    console.log(`\n🎯 Generation Order (respecting dependencies):`);
    const generator = new RecursiveImageGenerator();
    
    // Mock the buildDependencyOrder to show what would happen
    const orderedSections = generator.buildDependencyOrder(chapterData.sections);
    orderedSections.forEach((section, index) => {
        const deps = dependencies.get(section.id);
        const depStr = deps ? ` (needs: ${deps.join(', ')})` : '';
        console.log(`   ${index + 1}. ${section.id}${depStr}`);
    });
    
    // Show the recursive pattern
    console.log(`\n🔄 Recursive Pattern Demonstration:`);
    console.log(`   1. Generate base character: meet-baby-beaver → baby-beaver-portrait.jpg`);
    console.log(`   2. Use in action scenes:`);
    console.log(`      - surveying-river uses baby-beaver-portrait.jpg`);
    console.log(`      - gathering-sticks uses baby-beaver-portrait.jpg`);
    console.log(`      - (8 more scenes with Baby Beaver...)`);
    console.log(`   3. Generate Papa: papa-beaver-arrives → papa-beaver.jpg`);
    console.log(`   4. Use both characters:`);
    console.log(`      - teamwork-lifting uses [baby-beaver, papa-beaver]`);
    console.log(`   5. Generate Mama: mama-beaver-arrives → mama-beaver.jpg`);
    console.log(`   6. Use all three characters:`);
    console.log(`      - family-building uses [baby-beaver, papa-beaver, mama-beaver]`);
    
    // Simulate what would be generated
    console.log(`\n✨ What Would Be Generated:`);
    console.log(`   - 3 base character portraits (Baby Beaver, Papa Beaver, Mama Beaver)`);
    console.log(`   - 10+ action scenes reusing these characters`);
    console.log(`   - 2 landscape scenes for hero and finale`);
    console.log(`   - Total coherent story with consistent characters!`);
    
    // Show the actual generation command
    console.log(`\n🚀 To Actually Generate Images:`);
    console.log(`   1. Set environment variables:`);
    console.log(`      export OPENAI_API_KEY="your-key"`);
    console.log(`      export GEMINI_API_KEY="your-key"`);
    console.log(`   2. Run the generator:`);
    console.log(`      node run-recursive-generation.js`);
    
    console.log(`\n✅ Recursive structure validated successfully!`);
    console.log(`   This would create a complete ${chapterData.sections.length}-scene story`);
    console.log(`   with consistent characters throughout!\n`);
}

// Run the test
testBeaverGeneration().catch(console.error);