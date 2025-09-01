#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');

// Global style prompt that emphasizes realism
const GLOBAL_STYLE_PROMPT = `
Create a scientifically accurate and realistic image with the following artistic style:
- Studio Ghibli's whimsical character personality and warmth
- Pixar-quality global illumination, realistic fur textures, and detailed plant foliage
- Van Gogh inspired expressive brushstrokes ONLY in skies and water
- Children's book illustration narrative warmth
- IMPORTANT: Maintain scientific accuracy and realism - no fantasy elements unless specifically about imagination
- IMPORTANT: Objects must be physically plausible in their environment (no electric lights underwater, no tropical plants in Arctic, etc.)
- High detail, cinematic lighting, hand-painted feel with photorealistic textures
`;

// Function to extract images from HTML file
function extractImagesFromHTML(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const images = [];
  
  // Match img tags with alt text and src
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*alt=["']([^"']+)["']|<img[^>]+alt=["']([^"']+)["'][^>]*src=["']([^"']+)["']/gi;
  let match;
  
  while ((match = imgRegex.exec(html)) !== null) {
    const src = match[1] || match[4];
    const alt = match[2] || match[3];
    
    // Skip if it's an external URL
    if (src.startsWith('http')) continue;
    
    // Skip if alt text is too generic
    if (alt.length < 20) continue;
    
    images.push({
      src: src,
      alt: alt,
      fullPath: path.join(path.dirname(htmlPath), src)
    });
  }
  
  return images;
}

// Function to determine image size based on usage
function determineImageSize(imagePath) {
  if (imagePath.includes('hero') || imagePath.includes('banner')) {
    return '1792x1024'; // Landscape for hero images
  } else if (imagePath.includes('cover')) {
    return '1024x1792'; // Portrait for covers
  } else {
    return '1024x1024'; // Square for content images
  }
}

// Function to generate prompt from alt text
function generatePromptFromAlt(altText, imagePath) {
  // Add context based on which magazine it's for
  let context = '';
  if (imagePath.includes('polar-bears')) {
    context = 'Arctic environment, cold climate, ice and snow. ';
  } else if (imagePath.includes('chrysomallon')) {
    context = 'Deep ocean environment, hydrothermal vents, underwater scene. ';
  } else if (imagePath.includes('seals')) {
    context = 'Coastal environment, ocean and rocky shores. ';
  }
  
  return `${GLOBAL_STYLE_PROMPT}\n\nContext: ${context}\n\nCreate an image showing: ${altText}`;
}

// Function to download image from URL
function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filepath);
    
    https.get(url, (response) => {
      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        console.log(`✓ Downloaded: ${filepath}`);
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(filepath, () => {});
      reject(err);
    });
  });
}

// Function to generate image using OpenAI API
async function generateImage(prompt, size, quality = 'standard') {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not set');
  }
  
  const requestData = JSON.stringify({
    model: 'dall-e-3',
    prompt: prompt,
    n: 1,
    size: size,
    style: 'vivid',
    quality: quality,
    response_format: 'url'
  });

  const options = {
    hostname: 'api.openai.com',
    port: 443,
    path: '/v1/images/generations',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'Content-Length': requestData.length
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          
          if (response.error) {
            reject(new Error(response.error.message));
            return;
          }

          if (response.data && response.data[0] && response.data[0].url) {
            resolve({
              url: response.data[0].url,
              revised_prompt: response.data[0].revised_prompt
            });
          } else {
            reject(new Error('No image URL in response'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(requestData);
    req.end();
  });
}

// Main function
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node generate-images-from-html.js <path-to-html-file> [--dry-run]');
    console.log('Example: node generate-images-from-html.js polar-bears-antarctica/index.html');
    process.exit(1);
  }
  
  const htmlPath = args[0];
  const dryRun = args.includes('--dry-run');
  
  if (!fs.existsSync(htmlPath)) {
    console.error(`Error: HTML file not found: ${htmlPath}`);
    process.exit(1);
  }
  
  // Check for API key
  if (!dryRun && !process.env.OPENAI_API_KEY) {
    console.error('Error: OPENAI_API_KEY environment variable not set');
    process.exit(1);
  }
  
  console.log(`🎨 Analyzing HTML file: ${htmlPath}\n`);
  
  // Extract images from HTML
  const images = extractImagesFromHTML(htmlPath);
  
  if (images.length === 0) {
    console.log('No images with detailed alt text found in HTML.');
    process.exit(0);
  }
  
  console.log(`Found ${images.length} images to process:\n`);
  
  for (const img of images) {
    console.log(`📸 Image: ${img.src}`);
    console.log(`   Alt text: ${img.alt.substring(0, 80)}...`);
    
    // Check if image already exists and is valid
    if (fs.existsSync(img.fullPath)) {
      const stats = fs.statSync(img.fullPath);
      if (stats.size > 10000) { // More than 10KB
        console.log(`   ✓ Already exists with valid size (${stats.size} bytes)\n`);
        continue;
      }
    }
    
    if (dryRun) {
      console.log(`   [DRY RUN] Would generate with prompt:`);
      console.log(`   ${generatePromptFromAlt(img.alt, img.fullPath).substring(0, 150)}...\n`);
      continue;
    }
    
    try {
      // Generate the image
      const size = determineImageSize(img.fullPath);
      const quality = img.fullPath.includes('hero') || img.fullPath.includes('cover') ? 'hd' : 'standard';
      const prompt = generatePromptFromAlt(img.alt, img.fullPath);
      
      console.log(`   Generating ${size} image with ${quality} quality...`);
      
      const result = await generateImage(prompt, size, quality);
      console.log(`   ✓ Generated successfully`);
      
      // Ensure directory exists
      const dir = path.dirname(img.fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Download the image
      await downloadImage(result.url, img.fullPath);
      console.log('');
      
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}\n`);
    }
  }
  
  console.log('✅ Image generation complete!');
}

// Load environment variables from .env file if it exists
if (fs.existsSync('.env')) {
  const envContent = fs.readFileSync('.env', 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      process.env[match[1].trim()] = match[2].trim();
    }
  });
}

// Run the script
main().catch(console.error);