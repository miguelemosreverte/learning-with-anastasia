#!/usr/bin/env node

const IndexGenerator = require('./automation/index-generator');

async function updateIndex() {
    console.log('📚 Updating magazine index...');
    const generator = new IndexGenerator();
    await generator.generateIndex();
    console.log('✅ Index updated successfully!');
}

updateIndex().catch(console.error);