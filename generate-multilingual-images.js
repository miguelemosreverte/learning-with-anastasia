const { GoogleGenAI } = require("@google/genai");
const fs = require("fs");
const path = require("path");

// Images that need text labels in multiple languages
const TEXT_REQUIRED_IMAGES = [
  {
    basePrompt: "Educational comparison chart with 4 boxes showing different animals and their shell materials",
    textElements: {
      en: ["Calcium Shell", "Chitin Shell", "Keratin & Bone", "Iron Scales - Unique!"],
      es: ["Concha de Calcio", "Caparazón de Quitina", "Queratina y Hueso", "Escamas de Hierro - ¡Único!"],
      ru: ["Кальциевая раковина", "Хитиновый панцирь", "Кератин и кость", "Железная чешуя - Уникально!"]
    },
    basePath: "chrysomallon-squamiferum/assets/images/iron-body-unique"
  },
  {
    basePrompt: "Scientific cross-section diagram of snail shell with three labeled layers",
    textElements: {
      en: ["Iron Sulfide Layer", "Organic Layer", "Calcium Carbonate"],
      es: ["Capa de Sulfuro de Hierro", "Capa Orgánica", "Carbonato de Calcio"],
      ru: ["Слой сульфида железа", "Органический слой", "Карбонат кальция"]
    },
    basePath: "chrysomallon-squamiferum/assets/images/three-layer-shell"
  },
  {
    basePrompt: "World map of Indian Ocean with location labels",
    textElements: {
      en: ["Kairei Vent Field", "Solitaire Field", "Longqi Vent Field", "2,500m Deep"],
      es: ["Campo de Fuentes Kairei", "Campo Solitaire", "Campo de Fuentes Longqi", "2.500m de Profundidad"],
      ru: ["Поле источников Кайрей", "Поле Солитер", "Поле источников Лонгки", "Глубина 2500м"]
    },
    basePath: "chrysomallon-squamiferum/assets/images/three-locations-map"
  }
];

const LANGUAGES = {
  en: "English",
  es: "Spanish",
  ru: "Russian"
};

const ARTISTIC_STYLE = `
Studio Ghibli's whimsical warmth, Pixar-quality rendering, Van Gogh atmospheric effects.
Child-friendly, educational, vibrant colors with magical lighting.
`;

async function generateMultilingualImage(imageConfig, language, referenceImagePath) {
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY
  });

  // Read reference image if provided
  let promptArray = [];
  
  if (referenceImagePath && fs.existsSync(referenceImagePath)) {
    const imageData = fs.readFileSync(referenceImagePath);
    const base64Image = imageData.toString("base64");
    
    promptArray = [
      {
        text: `Create: ${imageConfig.basePrompt}
        
        Text labels in ${LANGUAGES[language]}: ${imageConfig.textElements[language].join(", ")}
        
        IMPORTANT: Use clear, readable text in ${LANGUAGES[language]} only.
        Font should be child-friendly and easy to read.
        
        Style: ${ARTISTIC_STYLE}`
      },
      {
        inlineData: {
          mimeType: "image/png",
          data: base64Image,
        },
      },
    ];
  } else {
    promptArray = `Create: ${imageConfig.basePrompt}
    
    Text labels in ${LANGUAGES[language]}: ${imageConfig.textElements[language].join(", ")}
    
    IMPORTANT: Use clear, readable text in ${LANGUAGES[language]} only.
    Font should be child-friendly and easy to read.
    
    Style: ${ARTISTIC_STYLE}`;
  }

  const outputPath = `${imageConfig.basePath}.${language}.jpg`;
  console.log(`📸 Generating ${language.toUpperCase()} version: ${path.basename(outputPath)}`);
  console.log(`   Labels: ${imageConfig.textElements[language].slice(0, 2).join(", ")}...`);

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image-preview",
      contents: promptArray,
    });
    
    if (response && response.candidates && response.candidates[0]) {
      const parts = response.candidates[0].content.parts;
      
      for (const part of parts) {
        if (part.inlineData) {
          const imageData = part.inlineData.data;
          const buffer = Buffer.from(imageData, "base64");
          
          const dir = path.dirname(outputPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          
          fs.writeFileSync(outputPath, buffer);
          console.log(`   ✅ Saved: ${outputPath}\n`);
          return true;
        }
      }
    }
    
    console.log(`   ℹ️ No image generated\n`);
    return false;
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}\n`);
    return false;
  }
}

async function detectImagesWithText() {
  // In a real implementation, this could use AI to detect which images contain text
  // For now, we'll use our predefined list
  console.log("📝 Images that need multilingual versions:");
  TEXT_REQUIRED_IMAGES.forEach(img => {
    console.log(`   - ${path.basename(img.basePath)}`);
  });
  console.log("");
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  
  if (!apiKey) {
    console.error("❌ Error: Please set GEMINI_API_KEY or GOOGLE_AI_API_KEY");
    process.exit(1);
  }

  console.log("🌍 Multilingual Image Generation Experiment");
  console.log("=============================================");
  console.log("This script generates language-specific versions of images that require text.\n");

  // Optional: use reference image for consistency
  const referenceImage = "chrysomallon-squamiferum/assets/images/Screenshot 2025-09-01 at 20.31.33.png";
  const useReference = fs.existsSync(referenceImage);
  
  if (useReference) {
    console.log(`📷 Using reference image for consistency\n`);
  }

  await detectImagesWithText();

  console.log("🎨 Generating language-specific versions...\n");

  let totalGenerated = 0;
  let totalFailed = 0;

  for (const imageConfig of TEXT_REQUIRED_IMAGES) {
    console.log(`\n📌 Processing: ${path.basename(imageConfig.basePath)}`);
    console.log("─".repeat(50));
    
    for (const lang of Object.keys(LANGUAGES)) {
      const success = await generateMultilingualImage(
        imageConfig, 
        lang, 
        useReference ? referenceImage : null
      );
      
      if (success) {
        totalGenerated++;
      } else {
        totalFailed++;
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log("\n" + "=".repeat(50));
  console.log("✅ Generation Complete!");
  console.log(`   Generated: ${totalGenerated} images`);
  if (totalFailed > 0) {
    console.log(`   Failed: ${totalFailed} images`);
  }

  console.log("\n💡 Usage in HTML:");
  console.log("   You can now dynamically load images based on language:");
  console.log('   <img src="assets/images/three-layer-shell.en.jpg" data-i18n-src="three-layer-shell">');
  console.log("   JavaScript will swap to .es.jpg or .ru.jpg based on selected language");
}

// Run the script
main().catch(console.error);