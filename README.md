# Dataset Annotator

A web-based, privacy-focused tool for efficient image dataset annotation. Annotate your local image datasets with AI-generated captions directly in your browser.

## Features

- **Local Directory Mounting**: Securely access your local image datasets using the File System Access API.
- **AI-Powered Annotation**: Generate detailed captions for your images using:
  - **Google Gemini** (Cloud)
  - **OpenRouter** (Access to various LLMs)
  - **Ollama** (Local, private LLMs)
- **Batch Processing**: Annotate your entire dataset in one go.
- **Export Options**: Export annotations to JSONL or CSV formats.
- **Find & Replace**: Perform global updates on your annotations.
- **Keyboard Shortcuts**: Streamline your workflow with built-in shortcuts.

## Tech Stack

- **Framework**: Next.js 15+ (App Router)
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **AI Integration**: Google GenAI SDK
- **Animation**: Motion (framer-motion)

## Getting Started

1. **Clone the repository**:
   ```bash
   git clone <your-repo-url>
   cd dataset-annotator
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Run the development server**:
   ```bash
   npm run dev
   ```

4. **Configure**:
   Open the app in your browser (default: `http://localhost:3000`). Click the settings icon to configure your preferred AI provider (Gemini, OpenRouter, or Ollama) and set your API keys.

## Usage

1. Click **"Mount Directory"** to select the folder containing your images.
2. Select an image from the grid or sidebar.
3. Use the **"AI Generate"** button to generate a caption based on your system prompt.
4. Edit the annotation as needed.
5. Save your changes (⌘+S) or use **"Save & Next"** (⌘+Enter) to speed up your workflow.
6. Export your final dataset using the export buttons in the sidebar.

## License

This project is licensed under the MIT License.
