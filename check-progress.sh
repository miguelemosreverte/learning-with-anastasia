#!/bin/bash

echo "🦦 Sea Otter Chapter Generation Progress"
echo "========================================"

TOTAL_IMAGES=52
GENERATED=$(ls -1 sea-otters/assets/images/*.jpg 2>/dev/null | wc -l | tr -d ' ')

echo "Generated: $GENERATED / $TOTAL_IMAGES images"
echo "Progress: $(( GENERATED * 100 / TOTAL_IMAGES ))%"
echo ""

if [ "$GENERATED" -eq "$TOTAL_IMAGES" ]; then
    echo "✅ All images generated!"
    echo "📄 Chapter HTML should be built automatically"
else
    echo "⏳ Generation in progress..."
    echo "   Latest images:"
    ls -lt sea-otters/assets/images/*.jpg 2>/dev/null | head -5 | awk '{print "   - " $NF}'
fi