
const https = require('https');
const fs = require('fs');

const requestData = JSON.stringify({
    model: 'dall-e-3',
    prompt: `Thanks to Baby Beaver's dam, the whole area has transformed! Fish swim in the deep water, birds nest in the wetlands, and deer come to drink. One beaver family has created a home for hundreds of animals!
    
    Style: Studio Ghibli warmth, Pixar quality, Van Gogh atmospheric effects.
    Child-friendly, vibrant colors, magical lighting.
    NO TEXT in the image.`,
    n: 1,
    size: '1792x1024',
    quality: 'hd'
});

const options = {
    hostname: 'api.openai.com',
    port: 443,
    path: '/v1/images/generations',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer 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',
        'Content-Length': requestData.length
    }
};

const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        try {
            const response = JSON.parse(data);
            if (response.data && response.data[0]) {
                const imageUrl = response.data[0].url;
                https.get(imageUrl, (imgRes) => {
                    const fileStream = fs.createWriteStream('/Users/miguel_lemos/Desktop/learning with anastasia/beavers/assets/images/ecosystem-thriving.jpg');
                    imgRes.pipe(fileStream);
                    fileStream.on('finish', () => {
                        console.log('SUCCESS');
                        process.exit(0);
                    });
                });
            } else {
                console.error('No image in response');
                process.exit(1);
            }
        } catch (e) {
            console.error(e.message);
            process.exit(1);
        }
    });
});

req.on('error', (e) => {
    console.error(e.message);
    process.exit(1);
});

req.write(requestData);
req.end();
