const { GoogleGenAI, Modality } = require("@google/genai");
const fs = require("fs");
const path = require("path");

// The artistic style we want to maintain across all chapters
const ARTISTIC_STYLE = `
Studio Ghibli's whimsical warmth combined with Pixar-quality rendering and Van Gogh-inspired atmospheric effects.
Child-friendly, educational, vibrant colors with magical lighting.

IMPORTANT TEXT POLICY:
- DO NOT add any text in English or other modern languages to the images
- Latin scientific names are acceptable (e.g., "Chrysomallon squamiferum")
- Symbols, arrows, and visual indicators are fine
- Diagrams with visual elements only (no text labels)
- This ensures the images work for all languages (English, Spanish, Russian, etc.)
`;

async function generateIronSnailImage(referenceImagePath, prompt, outputPath) {
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY
  });

  // Read the reference image (the actual specimen photo)
  const imageData = fs.readFileSync(referenceImagePath);
  const base64Image = imageData.toString("base64");

  // Create prompt with reference image
  const fullPrompt = [
    { 
      text: `Using the reference image showing the real Chrysomallon squamiferum (iron snail), create: ${prompt}
      
      IMPORTANT: Base your image on the reference photo provided. The snail MUST have:
      - BLACK ribbed shell (as shown in reference)
      - BLACK iron scales covering the foot (as shown in reference)
      - RED/PINK flesh visible between scales (as shown in reference)
      - Small size (4cm) 
      
      Apply this artistic style: ${ARTISTIC_STYLE}`
    },
    {
      inlineData: {
        mimeType: "image/png",
        data: base64Image,
      },
    },
  ];

  console.log(`📸 Generating: ${path.basename(outputPath)}`);
  console.log(`   Using reference image: ${path.basename(referenceImagePath)}`);
  console.log(`   Prompt: ${prompt.substring(0, 80)}...`);

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image-preview",
      contents: fullPrompt,
    });
    
    // Check response for image
    if (response && response.candidates && response.candidates[0]) {
      const parts = response.candidates[0].content.parts;
      
      for (const part of parts) {
        if (part.text) {
          console.log(`   Model response: ${part.text.substring(0, 100)}...`);
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
          console.log(`   ✅ Image saved: ${outputPath}\n`);
          return true;
        }
      }
    }
    
    console.log(`   ℹ️ No image generated (model may have returned text description instead)\n`);
    return false;
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}\n`);
    return false;
  }
}

// Define all the images we need to generate
const imagesToGenerate = [
  {
    prompt: "An underwater photograph of this iron snail on black volcanic rock with hydrothermal vents in the background. Keep the exact appearance from the reference.",
    output: "chrysomallon-squamiferum/assets/images/iron-snail-hero.jpg"
  },
  {
    prompt: "An extreme close-up showing the BLACK iron scales on the RED foot, exactly as shown in panel G of the reference image.",
    output: "chrysomallon-squamiferum/assets/images/iron-scales-closeup.jpg"
  },
  {
    prompt: "A scientific cross-section diagram of the shell showing three layers: outer black iron, middle brown organic, inner white calcium. Based on the shell in the reference.",
    output: "chrysomallon-squamiferum/assets/images/three-layer-shell.jpg"
  },
  {
    prompt: "A size comparison showing this exact snail (4cm) next to a white golf ball on a white background.",
    output: "chrysomallon-squamiferum/assets/images/size-comparison.jpg"
  },
  {
    prompt: "Scientists in white lab coats examining specimens of this exact snail in glass jars in a bright laboratory.",
    output: "chrysomallon-squamiferum/assets/images/discovery-celebration.jpg"
  },
  {
    prompt: "Laboratory scene with scientists studying this snail under microscopes, with the reference specimen visible.",
    output: "chrysomallon-squamiferum/assets/images/armor-research.jpg"
  },
  {
    prompt: "Deep ocean hydrothermal vent with these exact snails (from reference) on rocks near hot water vents.",
    output: "chrysomallon-squamiferum/assets/images/hot-water-habitat.jpg"
  },
  {
    prompt: "Educational comparison chart: regular snail, crab, turtle, and this iron snail from the reference - showing different shell materials.",
    output: "chrysomallon-squamiferum/assets/images/iron-body-unique.jpg"
  },
  {
    prompt: "World map of Indian Ocean with three location markers where this snail lives, with small inset showing the snail from reference.",
    output: "chrysomallon-squamiferum/assets/images/three-locations-map.jpg"
  }
];

async function main() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  
  if (!apiKey) {
    console.error("❌ Error: Please set GEMINI_API_KEY or GOOGLE_AI_API_KEY environment variable");
    process.exit(1);
  }

  // Path to our reference image (the screenshot you provided)
  const referenceImage = "chrysomallon-squamiferum/assets/images/Screenshot 2025-09-01 at 20.31.33.png";
  
  if (!fs.existsSync(referenceImage)) {
    console.error(`❌ Reference image not found: ${referenceImage}`);
    console.error("Please ensure the screenshot of the real iron snail is in the correct location.");
    process.exit(1);
  }

  console.log("🎨 Starting Gemini image generation with reference photo...");
  console.log(`📷 Using reference: ${referenceImage}`);
  console.log("🐌 This ensures accurate BLACK shell and RED flesh coloring\n");

  let successCount = 0;
  let failCount = 0;

  for (const image of imagesToGenerate) {
    const success = await generateIronSnailImage(referenceImage, image.prompt, image.output);
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
    console.log(`   Note: ${failCount} prompts returned text instead of images`);
    console.log(`   (The model may be describing what it would create rather than generating)`);
  }
}

// Run the script
main().catch(console.error);