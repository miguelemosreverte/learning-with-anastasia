const { GoogleGenerativeAI } = require("@google/genai");
const fs = require("fs");
const path = require("path");

// The artistic style we want to maintain across all chapters
const ARTISTIC_STYLE = `
Apply this artistic style:
- Studio Ghibli's whimsical character personality and warmth
- Pixar-quality global illumination and detailed textures
- Van Gogh-inspired rich, swirling atmospheric effects
- Child-friendly and educational
- Vibrant colors and magical lighting
- Maintain scientific accuracy while making it engaging for children
`;

async function generateIronSnailImage(referenceImagePath, prompt, outputPath) {
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

  // Read the reference image (the actual specimen photo)
  const imageData = fs.readFileSync(referenceImagePath);
  const base64Image = imageData.toString("base64");

  // Combine our prompt with the style guide
  const fullPrompt = [
    { 
      text: `Using the reference image of the real Chrysomallon squamiferum (iron snail), create: ${prompt}
      
      ${ARTISTIC_STYLE}
      
      IMPORTANT: Keep the accurate features from the reference:
      - BLACK ribbed shell
      - BLACK iron scales covering the foot
      - RED/PINK flesh visible between scales
      - Small size (4cm)
      - Overlapping scale pattern like medieval armor` 
    },
    {
      inlineData: {
        mimeType: "image/png",
        data: base64Image,
      },
    },
  ];

  console.log(`Generating: ${outputPath}`);

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const response = await model.generateContent(fullPrompt);

    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        const imageData = part.inlineData.data;
        const buffer = Buffer.from(imageData, "base64");
        
        // Ensure directory exists
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        
        fs.writeFileSync(outputPath, buffer);
        console.log(`✓ Image saved: ${outputPath}`);
      }
    }
  } catch (error) {
    console.error(`Error generating ${outputPath}:`, error);
  }
}

// Define all the images we need to generate
const imagesToGenerate = [
  {
    prompt: "The iron snail on black volcanic rock underwater, with hydrothermal vents in background. Hero shot showing the whole animal clearly.",
    output: "chrysomallon-squamiferum/assets/images/iron-snail-hero.jpg"
  },
  {
    prompt: "Extreme close-up of the BLACK iron scales on the RED foot, showing the overlapping pattern like roof tiles or medieval armor",
    output: "chrysomallon-squamiferum/assets/images/iron-scales-closeup.jpg"
  },
  {
    prompt: "Educational cross-section diagram of the shell showing three layers: outer black iron layer, middle brown organic layer, inner white calcium layer",
    output: "chrysomallon-squamiferum/assets/images/three-layer-shell.jpg"
  },
  {
    prompt: "Size comparison showing the 4cm iron snail next to a white golf ball on a white background. Both should be actual size.",
    output: "chrysomallon-squamiferum/assets/images/size-comparison.jpg"
  },
  {
    prompt: "Scientists in a bright laboratory examining specimens of the iron snail in glass jars, showing excitement and taking notes",
    output: "chrysomallon-squamiferum/assets/images/discovery-celebration.jpg"
  },
  {
    prompt: "Laboratory scene with scientists studying the iron snail under microscopes, with computer screens showing diagrams of the iron scales",
    output: "chrysomallon-squamiferum/assets/images/armor-research.jpg"
  },
  {
    prompt: "Deep ocean hydrothermal vent with black rock chimneys releasing hot water (show as orange/red gradient), with iron snails on cooler rocks nearby",
    output: "chrysomallon-squamiferum/assets/images/hot-water-habitat.jpg"
  },
  {
    prompt: "Educational comparison chart showing 4 animals and their shells: regular snail (calcium), crab (chitin), turtle (keratin), and iron snail (iron) - highlight the iron snail as unique",
    output: "chrysomallon-squamiferum/assets/images/iron-body-unique.jpg"
  },
  {
    prompt: "World map of Indian Ocean with three red dots marking where iron snails live (Kairei, Solitaire, Longqi), showing 2,500m depth",
    output: "chrysomallon-squamiferum/assets/images/three-locations-map.jpg"
  }
];

async function main() {
  // Path to our reference image (the screenshot you provided)
  const referenceImage = "chrysomallon-squamiferum/assets/images/Screenshot 2025-09-01 at 20.31.33.png";
  
  if (!fs.existsSync(referenceImage)) {
    console.error("Reference image not found:", referenceImage);
    process.exit(1);
  }

  if (!process.env.GOOGLE_AI_API_KEY) {
    console.error("Please set GOOGLE_AI_API_KEY environment variable");
    process.exit(1);
  }

  console.log("🎨 Starting Gemini-based image generation with reference photo...\n");

  for (const image of imagesToGenerate) {
    await generateIronSnailImage(referenceImage, image.prompt, image.output);
    // Add delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log("\n✅ Generation complete!");
}

main().catch(console.error);