
const { GoogleGenAI } = require("@google/genai");
const fs = require("fs");

async function generate() {
    const ai = new GoogleGenAI({
        apiKey: "AIzaSyCy5EaiZC41CAeKtXL9ejLSjFzycfb7l1I"
    });
    
    const referenceData = fs.readFileSync("beavers/assets/images/baby-beaver-portrait.jpg");
    const base64Reference = referenceData.toString("base64");
    
    const prompt = [
        {
            text: `Using the character from the reference image, show: family storing branches underwater near the lodge for winter food
            
            IMPORTANT: Keep the character's appearance EXACTLY the same as in the reference.
            Scene: Preparing for Winter
            
            Style: Studio Ghibli warmth, Pixar quality, child-friendly, vibrant colors.
            NO TEXT in the image.`
        },
        {
            inlineData: {
                mimeType: "image/jpeg",
                data: base64Reference
            }
        }
    ];
    
    let retries = 3;
    while (retries > 0) {
        try {
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash-image-preview",
                contents: prompt
            });
            
            if (response && response.candidates && response.candidates[0]) {
                const parts = response.candidates[0].content.parts;
                for (const part of parts) {
                    if (part.inlineData) {
                        const buffer = Buffer.from(part.inlineData.data, "base64");
                        fs.writeFileSync("beavers/assets/images/family-winter-prep.jpg", buffer);
                        console.log("SUCCESS");
                        return;
                    } else if (part.text) {
                        console.log("TEXT_RESPONSE:", part.text.substring(0, 100));
                    }
                }
            }
            console.error("No image generated - response had text only");
            process.exit(1);
        } catch (error) {
            retries--;
            if (error.message && error.message.includes("500") && retries > 0) {
                console.log(`RETRY: ${retries} attempts remaining`);
                await new Promise(resolve => setTimeout(resolve, 3000));
            } else {
                console.error(error.message);
                process.exit(1);
            }
        }
    }
    console.error("Failed after 3 retries");
    process.exit(1);
}

generate();
