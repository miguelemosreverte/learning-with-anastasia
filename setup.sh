#!/bin/bash

# Learning with Anastasia - Setup Script
# This script sets up the project and generates all required images

set -e  # Exit on error

echo "🎨 Learning with Anastasia - Setup Script"
echo "========================================="
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        echo "📝 Creating .env file from .env.example..."
        cp .env.example .env
        echo "⚠️  Please edit .env and add your OpenAI API key"
        echo "   Get your key from: https://platform.openai.com/api-keys"
        exit 1
    fi
fi

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Check for API key
if [ -z "$OPENAI_API_KEY" ] || [ "$OPENAI_API_KEY" = "your-api-key-here" ]; then
    echo "❌ Error: OPENAI_API_KEY not set in .env file"
    echo "Please add your OpenAI API key to the .env file"
    exit 1
fi

echo "✅ OpenAI API key found"
echo ""

# Create necessary directories
echo "📁 Creating directory structure..."
mkdir -p polar-bears-antarctica/assets/images
mkdir -p chrysomallon-squamiferum/assets/images
mkdir -p seals-of-the-world/assets/images

# Check Node.js installation
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    echo "   Download from: https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js found: $(node --version)"
echo ""

# Generate images
echo "🖼️  Generating images..."
echo "This may take a few minutes..."
echo ""

# Check if we should regenerate all or just missing
if [ "$REGENERATE_EXISTING" = "true" ]; then
    echo "Regenerating all images..."
    node generate-images.js
else
    echo "Generating only missing/broken images..."
    node generate-images.js --missing
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "🚀 To view your website:"
echo "   1. Open index.html in your browser"
echo "   2. Or run: python3 -m http.server 8000"
echo "      Then visit: http://localhost:8000"
echo ""
echo "📱 Language switcher is available in the top-right corner!"
echo ""