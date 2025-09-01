#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');

// Image generation configurations for each magazine
const imageConfigs = [
  {
    name: 'polar-bears-cover',
    path: 'polar-bears-antarctica/assets/images/magazine-cover.jpg',
    prompt: 'Majestic polar bear mother with two cubs on Arctic ice, Studio Ghibli 2D character personality with Pixar-quality global illumination and ultra-detailed fur textures, Van Gogh inspired expressive brushstrokes in the sky and ice, children\'s book illustration warmth, dreamy glaciers with subsurface scattering, cinematic depth of field, hand-painted yet photorealistic details, whimsical narrative scene, portrait orientation',
    size: '1024x1792',
    style: 'vivid',
    quality: 'hd'
  },
  {
    name: 'iron-snail-cover',
    path: 'chrysomallon-squamiferum/assets/images/magazine-cover.jpg',
    prompt: 'Chrysomallon squamiferum iron snail with metallic scales, Studio Ghibli whimsical character design meets Pixar-level material rendering and subsurface scattering on shell, Van Gogh color strokes in the water currents, children\'s book illustration storytelling, bioluminescent deep sea with volumetric lighting, iridescent iron scales with realistic metallic sheen, magical underwater atmosphere, hand-painted details with photorealistic textures, portrait orientation',
    size: '1024x1792',
    style: 'vivid',
    quality: 'hd'
  },
  {
    name: 'seals-cover',
    path: 'seals-of-the-world/assets/images/magazine-cover.jpg',
    prompt: 'Playful seal family on coastal rocks, Studio Ghibli expressive character personalities with Pixar-quality wet fur rendering and global illumination, Van Gogh brushwork in ocean waves and sunset sky, children\'s book narrative warmth, elephant seal with subsurface scattering on skin, realistic water droplets and foam, golden hour volumetric lighting, hand-painted atmosphere with photorealistic animal textures, whimsical yet detailed, portrait orientation',
    size: '1024x1792',
    style: 'vivid',
    quality: 'hd'
  },
  {
    name: 'seals-hero',
    path: 'seals-of-the-world/assets/images/hero-background.jpg',
    prompt: 'Panoramic seal colony at golden sunset, Studio Ghibli composition and character charm with Pixar-level environmental lighting and detailed rocks, Van Gogh expressive brushstrokes in clouds and water, children\'s book storytelling atmosphere, hundreds of seals with realistic fur and whiskers, volumetric fog and atmospheric perspective, subsurface scattering on wet rocks, hand-painted sky with photorealistic animals, warm narrative scene, landscape orientation',
    size: '1792x1024',
    style: 'vivid',
    quality: 'standard'
  },
  {
    name: 'polar-bears-hero',
    path: 'polar-bears-antarctica/assets/images/hero-background.jpg',
    prompt: 'Arctic wonderland with polar bear on ice floe, Studio Ghibli ethereal atmosphere with Pixar-quality ice rendering and global illumination, Van Gogh swirling brushstrokes in aurora borealis, children\'s book magical narrative, crystalline icebergs with realistic subsurface scattering, volumetric northern lights, photorealistic ice textures with hand-painted sky, whimsical yet scientifically accurate ice formations, dreamlike storytelling quality, landscape orientation',
    size: '1792x1024',
    style: 'vivid',
    quality: 'standard'
  },
  {
    name: 'iron-snail-hero',
    path: 'chrysomallon-squamiferum/assets/images/hero-background.jpg',
    prompt: 'Deep ocean hydrothermal vent ecosystem, Studio Ghibli mystical underwater mood with Pixar-level volumetric lighting and particle effects, Van Gogh flowing brushstrokes in water currents, children\'s book sense of wonder, bioluminescent creatures with realistic subsurface scattering, black smoker vents with accurate mineral deposits, photorealistic underwater caustics with hand-painted atmosphere, whimsical yet scientifically inspired, narrative depth, landscape orientation',
    size: '1792x1024',
    style: 'vivid',
    quality: 'standard'
  }
];

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
      fs.unlink(filepath, () => {}); // Delete the file on error
      reject(err);
    });
  });
}

// Function to generate image using OpenAI API
async function generateImage(config, apiKey) {
  const requestData = JSON.stringify({
    model: 'dall-e-3',
    prompt: config.prompt,
    n: 1,
    size: config.size,
    style: config.style,
    quality: config.quality,
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
  // Check for API key
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    console.error('❌ Error: OPENAI_API_KEY environment variable not set');
    console.log('\nTo set your API key, run:');
    console.log('export OPENAI_API_KEY="your-api-key-here"');
    console.log('\nGet your API key from: https://platform.openai.com/api-keys');
    process.exit(1);
  }

  console.log('🎨 Starting image generation with DALL-E 3...\n');

  // Process images based on command line argument
  const args = process.argv.slice(2);
  let configsToProcess = imageConfigs;

  if (args.length > 0) {
    if (args[0] === '--missing') {
      // Only generate missing images
      configsToProcess = imageConfigs.filter(config => {
        const exists = fs.existsSync(config.path);
        if (exists) {
          const stats = fs.statSync(config.path);
          return stats.size < 1024; // Less than 1KB means broken
        }
        return true;
      });
    } else if (args[0] === '--specific') {
      // Generate specific image by name
      const name = args[1];
      configsToProcess = imageConfigs.filter(config => config.name === name);
      if (configsToProcess.length === 0) {
        console.error(`❌ No configuration found for: ${name}`);
        console.log('Available names:', imageConfigs.map(c => c.name).join(', '));
        process.exit(1);
      }
    }
  }

  console.log(`📝 Will generate ${configsToProcess.length} image(s)\n`);

  for (const config of configsToProcess) {
    try {
      console.log(`🔄 Generating: ${config.name}`);
      console.log(`   Prompt: ${config.prompt.substring(0, 100)}...`);
      
      // Generate image
      const result = await generateImage(config, apiKey);
      console.log(`   ✓ Image generated successfully`);
      console.log(`   Revised prompt: ${result.revised_prompt.substring(0, 100)}...`);
      
      // Ensure directory exists
      const dir = path.dirname(config.path);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Download image
      await downloadImage(result.url, config.path);
      console.log(`   ✓ Saved to: ${config.path}\n`);
      
    } catch (error) {
      console.error(`   ❌ Error generating ${config.name}: ${error.message}\n`);
    }
  }

  console.log('✅ Image generation complete!');
  console.log('\nTo view the generated images, open index.html in your browser.');
}

// Run the script
main().catch(console.error);