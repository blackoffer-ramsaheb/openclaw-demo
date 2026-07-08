# lobster OpenClaw Mini — Local AI Agent Demo

OpenClaw Mini is an ultra-lightweight, zero-CPU-stress local AI assistant designed to manage notes and search workspace files entirely offline. It uses a **Node.js Express** backend paired with **Ollama** running the fast `phi3:mini` (3.8B) model.

Unlike the full OpenClaw monorepo, this demo is designed to run out-of-the-box on older Node versions (like Node v20.15.0) and does not require complex setup or compiling native C++ addons.

![Dashboard Preview](https://raw.githubusercontent.com/openclaw/openclaw/main/docs/assets/openclaw-logo-text.svg)

---

## ✨ Features

- 💬 **Local Agent Chat**: Talk to a local AI assistant that understands tools.
- 📝 **Agent Note-Taking**: Ask the agent to create notes, read notes, list notes, or delete notes.
- 🔍 **Workspace File Search**: Ask the agent to search your files; it recursively scans directory files and returns snippets.
- 🎨 **Premium Glassmorphic UI**: Beautiful dark mode workspace featuring live notes updates and search card views.
- 🔒 **100% Private**: Runs entirely on your local machine using Ollama. No API keys required.

---

## 🚀 Quick Start

### 1. Start Ollama
Ensure you have Ollama installed and run the `phi3:mini` model in your terminal:
```bash
ollama run phi3:mini
```

### 2. Install & Start Server
Clone this folder, navigate to it, and run:
```bash
# Install dependencies
npm install

# Start the Express server
node server.js
```

### 3. Open Browser
Open your browser and navigate to:
👉 **http://localhost:3000**

---

## 🛠️ Tech Stack

- **Backend**: Node.js, Express
- **LLM Engine**: Ollama (phi3:mini)
- **Frontend**: Vanilla HTML5, CSS3 (Glassmorphism), ES6 JavaScript
