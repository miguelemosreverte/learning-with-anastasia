# Project Context and AI Workflow

## Valve Protocol: Monotonic Code Improvement Workflow

### Overview
This document defines the Valve Protocol - a system ensuring that all code changes move KPIs forward, never backward. Like a one-way valve in engineering, changes can only flow in the direction of improvement.

### Core Principle
**Every code change must maintain or improve ALL existing metrics. Regressions are blocked at the system level.**

## Project KPIs and Baselines

### Current Metrics
- [ ] Test Coverage: _%
- [ ] Performance: _ms average
- [ ] Code Quality Score: _/100
- [ ] Test Count: _
- [ ] Build Time: _s
- [ ] Bundle Size: _KB

### Goals for This Session
- [ ] Let's define the goals for this session together. What is the primary objective? 

### Completed Improvements
<!-- AI agents should update this section after each successful change -->

## Workflow Rules for AI Agents

### 1. Before Making Any Changes
- Read all existing documentation
- Check current test coverage
- Run existing tests to establish baseline
- Review recent commits for context

### 2. When Implementing Changes
Follow this strict order:
1. **Write tests first** (TDD approach)
2. **Implement minimal code** to pass tests
3. **Refactor** only if all metrics improve
4. **Document** changes in this file

### 3. Code Change Checklist
Before considering any change complete:
- [ ] All existing tests pass
- [ ] New tests added for new functionality
- [ ] No performance regression
- [ ] Code follows project style guide
- [ ] Documentation updated if needed

### 4. Continuous Improvement Rules
- **Small increments**: Make many small improvements rather than large changes
- **Test everything**: If it's not tested, it doesn't exist
- **Measure first**: Before optimizing, measure current state
- **Lock in gains**: Once improved, update baselines

## AI-Specific Instructions

### For Claude Code
- Use TodoWrite to track all tasks
- Consolidate project understanding in this file
- Run tests after every significant change
- Use --continue flag to maintain context across sessions

### For Gemini CLI
- Read this file first to understand project state
- Follow the same workflow as Claude
- Update metrics section after improvements
- Use checkpointing to save progress

## Session Management

### Starting a Session
```bash
# 1. Check project status
npm test
npm run lint

# 2. Review this document
cat CLAUDE.md

# 3. Set session goals (update Goals section above)
```

### During the Session
```bash
# Continuous validation
npm test -- --watch
npm run lint -- --watch

# Before each commit
npm test -- --coverage
npm run build
```

### Ending a Session
```bash
# 1. Run full test suite
npm test -- --coverage

# 2. Update metrics in this file

# 3. Commit with descriptive message
git add -A
git commit -m "feat: [description] - Coverage: X%, Tests: +N"
```

## Project-Specific Context

### Architecture Overview
The project uses a YAML-driven image generation pipeline:
1. **Chapter Definition**: `chapters/[name].yaml` defines all content, images, and translations
2. **Image Generation**: `run-recursive-generation.js` processes YAML to generate images
3. **HTML Building**: `chapter-builder.js` converts YAML to HTML using Handlebars templates

### Image Generation Workflow
```bash
# 1. Ensure .env file has API keys
# Check .env contains:
# OPENAI_API_KEY=sk-...
# GEMINI_API_KEY=...

# 2. Run the recursive generator (reads .env automatically)
source .env && export OPENAI_API_KEY GEMINI_API_KEY
node run-recursive-generation.js

# 3. The script will:
#    - Read chapters/beavers.yaml (or other chapter)
#    - Generate missing images using references
#    - Skip existing images
#    - Build HTML automatically
```

### Key Files
- `run-recursive-generation.js` - Main entry point for image generation
- `automation/recursive-image-generator.js` - Core recursive generation logic
- `automation/chapter-builder.js` - YAML to HTML converter
- `templates/chapter-template-fixed.hbs` - Handlebars template for chapters
- `.env` - Contains API keys (OPENAI_API_KEY, GEMINI_API_KEY)

### Key Dependencies
- `@google/generative-ai` - Gemini API for text generation
- `@google/genai` - Gemini for image generation with references
- `openai` - OpenAI API for image generation
- `js-yaml` - YAML parsing
- `handlebars` - Template engine

### Routing System
Images are routed to different AI services based on `routing` section in YAML:
- `openai`: Images without reference requirements
- `gemini`: Images requiring reference images (using `referenceImage` field)

### Known Issues
- Language selector only showing English flag (needs CSS fix)

### Recent Changes
- Fixed language selector to use circular flag buttons
- Added viewer detail images with proper references
- Completed Spanish/Russian translations for all sections
- Fixed Fun Facts and Viewer Details rendering
- Documented proper workflow using .env file

## Regression Prevention

### Protected Patterns
These patterns must NEVER be broken:
1. All API endpoints must have tests
2. All UI components must have accessibility attributes
3. All async operations must have error handling
4. All user inputs must be validated

### Performance Budgets
- Page load: < 3 seconds
- API response: < 200ms
- Bundle size: < 500KB
- Memory usage: < 100MB

## Notes Section
<!-- AI agents can add observations and learnings here -->

---
*Last Updated: [AI will update this timestamp]*
*Session Count: 0*
*Total Improvements: 0*