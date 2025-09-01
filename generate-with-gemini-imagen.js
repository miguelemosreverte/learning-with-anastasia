const { GoogleGenAI, Modality } = require("@google/genai");
const fs = require("fs");
const path = require("path");

// The artistic style we want to maintain across all chapters
const ARTISTIC_STYLE = `
Studio Ghibli's whimsical warmth combined with Pixar-quality rendering and Van Gogh-inspired atmospheric effects.
Child-friendly, educational, vibrant colors with magical lighting.
`;

// Based on the actual specimen photo, the accurate description
const ACCURATE_DESCRIPTION = `
The Chrysomallon squamiferum (iron snail) MUST have:
- BLACK ribbed shell (not white, not grey - BLACK)
- Bright RED/PINK fleshy foot
- BLACK iron sulfide scales covering the foot, overlapping like medieval armor
- Very small size (only 4cm tall)
- The scales look like overlapping roof tiles or chainmail
`;

async function generateIronSnailImage(prompt, outputPath) {
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY
  });

  // Combine prompt with style and accuracy requirements
  const fullPrompt = `${prompt}

CRITICAL ACCURACY REQUIREMENTS:
${ACCURATE_DESCRIPTION}

ARTISTIC STYLE:
${ARTISTIC_STYLE}`;

  console.log(`📸 Generating: ${path.basename(outputPath)}`);
  console.log(`   Prompt: ${prompt.substring(0, 100)}...`);

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash-exp",
      contents: fullPrompt,
    });
    
    // Check if response contains an image
    if (response && response.candidates && response.candidates[0]) {
      const parts = response.candidates[0].content.parts;
      
      // Debug: log what we got
      console.log(`   Response parts: ${parts.length}`);
      
      for (const part of parts) {
        if (part.text) {
          console.log(`   Got text response: ${part.text.substring(0, 100)}...`);
        }
        if (part.inlineData) {
          const imageData = part.inlineData.data;
          const buffer = Buffer.from(imageData, "base64");
          
          // Ensure directory exists
          const dir = path.dirname(outputPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          
          fs.writeFileSync(outputPath, buffer);
          console.log(`   ✅ Saved to ${outputPath}\n`);
          return true;
        }
      }
    }
    
    console.log(`   ❌ No image in response (model may not support image generation)\n`);
    return false;
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}\n`);
    return false;
  }
}

// Define all the images we need to generate with scientifically accurate prompts
const imagesToGenerate = [
  {
    prompt: "Underwater photograph of Chrysomallon squamiferum on volcanic rock. Show a 4cm snail with BLACK ribbed shell and bright RED foot covered in BLACK overlapping scales. Deep ocean hydrothermal vent background.",
    output: "chrysomallon-squamiferum/assets/images/iron-snail-hero.jpg"
  },
  {
    prompt: "Extreme close-up of Chrysomallon squamiferum foot showing BLACK iron sulfide scales overlapping like medieval chainmail over bright RED/PINK flesh. Each scale is 1-2mm. Scientific detail shot.",
    output: "chrysomallon-squamiferum/assets/images/iron-scales-closeup.jpg"
  },
  {
    prompt: "Scientific cross-section diagram of Chrysomallon squamiferum shell. Show three distinct layers: outer BLACK iron sulfide layer, middle brown organic layer, inner white calcium carbonate. Educational labeled diagram.",
    output: "chrysomallon-squamiferum/assets/images/three-layer-shell.jpg"
  },
  {
    prompt: "Size comparison photo: Chrysomallon squamiferum (4cm tall with BLACK shell and RED foot with BLACK scales) next to a white golf ball. Both actual size. White background. Scientific specimen photography.",
    output: "chrysomallon-squamiferum/assets/images/size-comparison.jpg"
  },
  {
    prompt: "Happy scientists in white lab coats examining Chrysomallon squamiferum specimens (BLACK shells, RED feet) in glass jars. Bright modern laboratory. Scientists taking notes with excitement.",
    output: "chrysomallon-squamiferum/assets/images/discovery-celebration.jpg"
  },
  {
    prompt: "Laboratory scene: Scientists studying Chrysomallon squamiferum under microscopes. Computer screens show diagrams of BLACK iron scales over RED tissue. Specimen jars with BLACK and RED snails visible.",
    output: "chrysomallon-squamiferum/assets/images/armor-research.jpg"
  },
  {
    prompt: "Deep ocean hydrothermal vent scene: Black rock chimneys releasing hot water (orange/red gradient). Small Chrysomallon squamiferum snails (BLACK shells, RED feet) on cooler rocks. Temperature visualization.",
    output: "chrysomallon-squamiferum/assets/images/hot-water-habitat.jpg"
  },
  {
    prompt: "Educational comparison chart with 4 boxes: 1) Regular brown snail with calcium shell, 2) Orange crab with chitin shell, 3) Green turtle with keratin, 4) Chrysomallon squamiferum with BLACK iron shell and RED foot - labeled 'Only animal with iron armor!'",
    output: "chrysomallon-squamiferum/assets/images/iron-body-unique.jpg"
  },
  {
    prompt: "World map centered on Indian Ocean with three red location markers at Kairei, Solitaire, and Longqi hydrothermal vents. Depth indicator showing 2,400-2,900 meters. Small inset showing Chrysomallon squamiferum (BLACK shell, RED foot).",
    output: "chrysomallon-squamiferum/assets/images/three-locations-map.jpg"
  }
];

async function main() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  
  if (!apiKey) {
    console.error("❌ Error: Please set GEMINI_API_KEY or GOOGLE_AI_API_KEY environment variable");
    console.log("\nTo get an API key:");
    console.log("1. Go to https://aistudio.google.com/apikey");
    console.log("2. Create a new API key");
    console.log("3. Set it: export GEMINI_API_KEY='your-key-here'");
    process.exit(1);
  }

  console.log("🎨 Starting Gemini image generation...");
  console.log("📝 Using scientifically accurate descriptions:");
  console.log("   - BLACK shell and scales (not grey!)");
  console.log("   - RED/PINK flesh");
  console.log("   - 4cm size");
  console.log("   - Overlapping scales like chainmail\n");

  let successCount = 0;
  let failCount = 0;

  for (const image of imagesToGenerate) {
    const success = await generateIronSnailImage(image.prompt, image.output);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
    
    // Add delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log("\n✅ Generation complete!");
  console.log(`   Successfully generated: ${successCount} images`);
  if (failCount > 0) {
    console.log(`   Failed: ${failCount} images`);
  }
}

// Run the script
main().catch(console.error);