# 🎨 Learning with Anastasia - Educational Magazine Collection

An interactive, multi-language educational magazine website featuring wildlife and nature content with AI-generated artwork in a unique hybrid artistic style.

## ✨ Features

- 🌐 **Multi-language Support**: English, Spanish, and Russian
- 🎨 **AI-Generated Artwork**: Unique blend of Studio Ghibli, Pixar, and Van Gogh styles
- 📱 **Responsive Design**: Works on all devices
- 🔄 **Persistent Language Selection**: Remembers your language choice
- 📚 **Educational Content**: Three magazine issues about wildlife

## 🚀 Quick Start

### Prerequisites
- Node.js (v14 or higher)
- OpenAI API key with billing enabled

### Setup

1. **Clone the repository**
   ```bash
   git clone [your-repo-url]
   cd learning-with-anastasia
   ```

2. **Configure API key**
   ```bash
   cp .env.example .env
   # Edit .env and add your OpenAI API key
   ```

3. **Run automated setup**
   ```bash
   ./setup.sh
   ```

   This will:
   - Verify your OpenAI API key
   - Create necessary directories
   - Generate all magazine images
   - Prepare the site for viewing

4. **View the website**
   - Open `index.html` directly in your browser, or
   - Run a local server:
     ```bash
     python3 -m http.server 8000
     # Visit http://localhost:8000
     ```

## 🖼️ Image Generation

### Regenerate Images

To regenerate all images:
```bash
node generate-images.js
```

To regenerate only missing/broken images:
```bash
node generate-images.js --missing
```

To regenerate a specific image:
```bash
node generate-images.js --specific polar-bears-cover
```

### Available Images
- `polar-bears-cover` - Polar bear family magazine cover
- `iron-snail-cover` - Chrysomallon squamiferum magazine cover  
- `seals-cover` - Seals of the world magazine cover
- `polar-bears-hero` - Arctic landscape background
- `iron-snail-hero` - Deep ocean vent background
- `seals-hero` - Seal colony panorama

### Artistic Style

Images use a unique hybrid style combining:
- **Studio Ghibli**: Whimsical 2D character personality
- **Pixar**: Global illumination and realistic textures
- **Van Gogh**: Expressive brushstrokes in skies and water
- **Children's Book**: Narrative warmth and storytelling quality

## 📂 Project Structure

```
learning-with-anastasia/
├── index.html                 # Main landing page
├── generate-images.js         # AI image generation script
├── setup.sh                   # Automated setup script
├── .env.example              # Environment variables template
├── package.json              # Node.js dependencies
│
├── polar-bears-antarctica/   # Issue #1
│   ├── index.html
│   └── assets/images/
│
├── chrysomallon-squamiferum/ # Issue #2
│   ├── index.html
│   └── assets/images/
│
└── seals-of-the-world/       # Issue #3
    ├── index.html
    └── assets/images/
```

## 🌐 Deployment

### GitHub Pages

1. Push to GitHub:
   ```bash
   git add .
   git commit -m "Initial deployment"
   git push origin main
   ```

2. Enable GitHub Pages:
   - Go to Settings → Pages
   - Source: Deploy from a branch
   - Branch: main, / (root)
   - Save

The site will be available at: `https://[username].github.io/[repository-name]/`

### Other Platforms

The site is static HTML/CSS/JS and can be deployed to:
- Netlify (drag & drop the folder)
- Vercel (connect GitHub repo)
- AWS S3 + CloudFront
- Any static hosting service

## 🔧 Configuration

### Environment Variables

Edit `.env` to configure:
- `OPENAI_API_KEY`: Your OpenAI API key
- `REGENERATE_EXISTING`: Set to `true` to regenerate all images
- `MIN_FILE_SIZE`: Minimum size (bytes) for valid images

### Customizing Prompts

Edit `generate-images.js` to modify image generation prompts. Each image config includes:
- `prompt`: The artistic description
- `size`: Image dimensions (1024x1792 or 1792x1024)
- `style`: 'vivid' or 'natural'
- `quality`: 'hd' or 'standard'

## 💰 Cost Estimation

OpenAI DALL-E 3 pricing (as of 2024):
- Standard quality: $0.040 per image
- HD quality: $0.080 per image

Full generation (6 images): ~$0.36

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test image generation
5. Submit a pull request

## 📄 License

MIT License - feel free to use for educational purposes!

## 🙏 Credits

- AI-generated images using OpenAI DALL-E 3
- Created with Claude Code
- Designed for educational purposes

---

Made with ❤️ for Anastasia's learning journey