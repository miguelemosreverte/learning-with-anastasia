const { GoogleGenAI } = require("@google/genai");
const fs = require("fs");
const path = require("path");

// Images that currently have English text and need translation
const IMAGES_TO_TRANSLATE = [
  {
    englishImage: "chrysomallon-squamiferum/assets/images/three-layer-shell.jpg",
    baseName: "three-layer-shell",
    translations: {
      es: {
        prompt: "Recreate this exact cross-section diagram but change the text labels to Spanish: 'Capa Externa de Hierro' (Outer Iron Layer), 'Capa Orgánica Intermedia' (Middle Organic Layer), 'Capa Interna de Calcio' (Inner Calcium Layer). Keep the same artistic style and layout.",
        labels: ["Capa Externa de Hierro", "Capa Orgánica Intermedia", "Capa Interna de Calcio"]
      },
      ru: {
        prompt: "Recreate this exact cross-section diagram but change the text labels to Russian: 'Внешний слой железа' (Outer Iron Layer), 'Средний органический слой' (Middle Organic Layer), 'Внутренний слой кальция' (Inner Calcium Layer). Keep the same artistic style and layout.",
        labels: ["Внешний слой железа", "Средний органический слой", "Внутренний слой кальция"]
      }
    }
  },
  {
    englishImage: "chrysomallon-squamiferum/assets/images/iron-body-unique.jpg",
    baseName: "iron-body-unique",
    translations: {
      es: {
        prompt: "Recreate this exact comparison chart but translate all text to Spanish: Title: 'Comparación de Materiales de Armadura Asombrosos - Gráfico Educativo'. Labels: 'Caracol' (Snail), 'Tortuga' (Turtle), 'Cangrejo' (Crab), 'Caracol de Hierro' (Iron Snail). Material labels: 'Material de concha: Carbonato de calcio', 'Material de concha: Sulfuro de hierro'. Keep the same layout and style.",
        labels: ["Caracol", "Tortuga", "Cangrejo", "Caracol de Hierro"]
      },
      ru: {
        prompt: "Recreate this exact comparison chart but translate all text to Russian: Title: 'Сравнение удивительных материалов панцирей - Образовательная схема'. Labels: 'Улитка' (Snail), 'Черепаха' (Turtle), 'Краб' (Crab), 'Железная улитка' (Iron Snail). Material labels: 'Материал раковины: Карбонат кальция', 'Материал раковины: Сульфид железа'. Keep the same layout and style.",
        labels: ["Улитка", "Черепаха", "Краб", "Железная улитка"]
      }
    }
  },
  {
    englishImage: "chrysomallon-squamiferum/assets/images/three-locations-map.jpg",
    baseName: "three-locations-map",
    translations: {
      es: {
        prompt: "Recreate this exact Indian Ocean map but translate the text to Spanish. Change 'Chrysomallon squamiferum The Scaly-Foot Snail' to 'Chrysomallon squamiferum El Caracol de Pie Escamoso'. Keep location names but add Spanish context if shown. Keep the same style and layout.",
        labels: ["Chrysomallon squamiferum", "El Caracol de Pie Escamoso"]
      },
      ru: {
        prompt: "Recreate this exact Indian Ocean map but translate the text to Russian. Change 'Chrysomallon squamiferum The Scaly-Foot Snail' to 'Chrysomallon squamiferum Чешуйчатоногая улитка'. Keep location names but add Russian context if shown. Keep the same style and layout.",
        labels: ["Chrysomallon squamiferum", "Чешуйчатоногая улитка"]
      }
    }
  }
];

async function generateTranslatedVersion(imageConfig, language) {
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY
  });

  // Read the English version as reference
  if (!fs.existsSync(imageConfig.englishImage)) {
    console.error(`   ❌ English image not found: ${imageConfig.englishImage}`);
    return false;
  }

  const imageData = fs.readFileSync(imageConfig.englishImage);
  const base64Image = imageData.toString("base64");

  const translation = imageConfig.translations[language];
  const outputPath = `chrysomallon-squamiferum/assets/images/${imageConfig.baseName}.${language}.jpg`;

  console.log(`📸 Generating ${language.toUpperCase()} version of ${imageConfig.baseName}`);
  console.log(`   New labels: ${translation.labels.slice(0, 2).join(", ")}...`);

  const promptArray = [
    {
      text: translation.prompt + `
      
      IMPORTANT:
      - Keep EXACTLY the same artistic style, colors, and layout as the original
      - Only change the text to ${language === 'es' ? 'Spanish' : 'Russian'}
      - Maintain the same whimsical, child-friendly appearance
      - Use clear, readable fonts
      - Preserve all visual elements, just translate the text`
    },
    {
      inlineData: {
        mimeType: "image/jpeg",
        data: base64Image,
      },
    },
  ];

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
          
          fs.writeFileSync(outputPath, buffer);
          console.log(`   ✅ Saved: ${outputPath}\n`);
          return true;
        }
        if (part.text) {
          console.log(`   Model response: ${part.text.substring(0, 100)}...`);
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

async function main() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  
  if (!apiKey) {
    console.error("❌ Error: Please set GEMINI_API_KEY or GOOGLE_AI_API_KEY");
    process.exit(1);
  }

  console.log("🌍 Generating Spanish and Russian Versions");
  console.log("===========================================");
  console.log("Using existing English images as reference\n");

  let successCount = 0;
  let failCount = 0;

  for (const imageConfig of IMAGES_TO_TRANSLATE) {
    console.log(`\n📌 Processing: ${imageConfig.baseName}`);
    console.log("─".repeat(50));
    
    // Generate Spanish version
    const esSuccess = await generateTranslatedVersion(imageConfig, 'es');
    if (esSuccess) successCount++; else failCount++;
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Generate Russian version
    const ruSuccess = await generateTranslatedVersion(imageConfig, 'ru');
    if (ruSuccess) successCount++; else failCount++;
    
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  console.log("\n" + "=".repeat(50));
  console.log("✅ Translation Complete!");
  console.log(`   Successfully generated: ${successCount} images`);
  if (failCount > 0) {
    console.log(`   Failed: ${failCount} images`);
  }

  console.log("\n💡 Next Steps:");
  console.log("1. Update HTML to dynamically load images based on language");
  console.log("2. Modify language-switcher.js to also swap image sources");
  console.log("3. Test switching between languages to see images change");
}

// Run the script
main().catch(console.error);