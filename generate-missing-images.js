#!/usr/bin/env node

const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const https = require('https');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

async function generateImage(prompt, filename, outputDir) {
    console.log(`📸 Generating ${filename}...`);
    
    try {
        const response = await openai.images.generate({
            model: "dall-e-3",
            prompt: prompt,
            n: 1,
            size: "1792x1024",
            quality: "hd",
            style: "vivid"
        });

        const imageUrl = response.data[0].url;
        const outputPath = path.join(outputDir, filename);
        
        // Download the image
        const file = fs.createWriteStream(outputPath);
        
        return new Promise((resolve, reject) => {
            https.get(imageUrl, (response) => {
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    console.log(`   ✅ Saved ${filename}`);
                    resolve();
                });
            }).on('error', (err) => {
                fs.unlink(outputPath, () => {});
                reject(err);
            });
        });
    } catch (error) {
        console.error(`   ❌ Failed to generate ${filename}: ${error.message}`);
    }
}

async function generateMissingImages() {
    const outputDir = path.join(__dirname, 'sea-otters/assets/images');
    
    const missingImages = [
        {
            filename: 'otter-games-and-play.jpg',
            prompt: 'Cute cartoon sea otters playing fun games in kelp forest, including kelp volleyball, underwater tag, racing through kelp fronds, playful and joyful scene, children\'s book illustration style, vibrant colors'
        },
        {
            filename: 'ollies-promise.jpg',
            prompt: 'Majestic cartoon adult sea otter standing proudly on a rock at golden sunset, making a solemn vow, overlooking beautiful ocean with kelp forest below, heroic pose, children\'s book illustration style, warm sunset colors'
        },
        {
            filename: 'fun-fact-fur.jpg',
            prompt: 'Close-up illustration of sea otter fur showing incredibly dense fur coat with millions of tiny hairs, educational diagram style, showing fur density, children\'s book illustration, bright and clear'
        },
        {
            filename: 'fun-fact-eating.jpg',
            prompt: 'Cartoon sea otter floating on back eating lots of seafood, surrounded by sea urchins, crabs, clams, showing big appetite, humorous children\'s book illustration, colorful and fun'
        },
        {
            filename: 'fun-fact-holding-hands.jpg',
            prompt: 'Adorable cartoon sea otters holding hands while floating in water to stay together, wrapped in kelp, romantic and sweet scene, children\'s book illustration style, soft colors'
        },
        {
            filename: 'fun-fact-purple-teeth.jpg',
            prompt: 'Cartoon sea otter showing purple-stained teeth from eating purple sea urchins, funny close-up of otter smiling, educational and humorous, children\'s book illustration style'
        },
        {
            filename: 'detail-tool-use.jpg',
            prompt: 'Educational illustration showing sea otter using rock as tool to crack open shellfish on chest, step-by-step demonstration, clear and informative, children\'s book style'
        },
        {
            filename: 'detail-keystone.jpg',
            prompt: 'Educational diagram showing sea otter as keystone species in kelp forest ecosystem, showing connections between otters, urchins, and kelp, colorful infographic style for children'
        },
        {
            filename: 'detail-no-blubber.jpg',
            prompt: 'Cross-section illustration comparing sea otter with dense fur coat versus whale with blubber layer, educational diagram showing how otters stay warm, children\'s book illustration style'
        }
    ];
    
    console.log('🎨 Generating missing images for Sea Otters chapter...\n');
    
    for (const image of missingImages) {
        const filepath = path.join(outputDir, image.filename);
        if (!fs.existsSync(filepath)) {
            await generateImage(image.prompt, image.filename, outputDir);
            // Add delay to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
            console.log(`⏭️  ${image.filename} already exists`);
        }
    }
    
    console.log('\n✅ All missing images generated!');
}

generateMissingImages().catch(console.error);