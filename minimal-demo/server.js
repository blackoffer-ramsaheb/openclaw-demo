import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const OLLAMA_HOST = "http://localhost:11434";
const DEFAULT_MODEL = "phi3:mini";

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Ensure notes directory exists
const NOTES_DIR = path.join(__dirname, "notes");
if (!fs.existsSync(NOTES_DIR)) {
  fs.mkdirSync(NOTES_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(NOTES_DIR, "welcome.txt"),
    "Welcome to OpenClaw Minimal Demo!\n\nThis note is stored locally on your PC. You can use the AI Agent to search, edit, or delete notes."
  );
}

// -----------------------------------------------------------------------------
// Note helpers
// -----------------------------------------------------------------------------
function getNotesList() {
  if (!fs.existsSync(NOTES_DIR)) return [];
  return fs.readdirSync(NOTES_DIR).filter(file => file.endsWith(".txt")).map(file => {
    const filePath = path.join(NOTES_DIR, file);
    const stats = fs.statSync(filePath);
    return {
      name: file.replace(".txt", ""),
      size: stats.size,
      updatedAt: stats.mtime
    };
  });
}

function readNoteContent(name) {
  const safeName = path.basename(name).replace(/\.txt$/, "") + ".txt";
  const filePath = path.join(NOTES_DIR, safeName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Note "${name}" not found.`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function writeNoteContent(name, content) {
  const safeName = path.basename(name).replace(/\.txt$/, "") + ".txt";
  const filePath = path.join(NOTES_DIR, safeName);
  fs.writeFileSync(filePath, content, "utf8");
  return { success: true, name: safeName.replace(".txt", "") };
}

function removeNoteFile(name) {
  const safeName = path.basename(name).replace(/\.txt$/, "") + ".txt";
  const filePath = path.join(NOTES_DIR, safeName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Note "${name}" not found.`);
  }
  fs.unlinkSync(filePath);
  return { success: true };
}

// File Search Helper (ignores node_modules, .git, .agents)
function searchLocalFiles(query, baseDir = __dirname) {
  const results = [];
  const queryLower = query.toLowerCase();

  function scan(dir) {
    const list = fs.readdirSync(dir);
    for (const item of list) {
      const fullPath = path.join(dir, item);
      const relativePath = path.relative(__dirname, fullPath);
      
      if (item === "node_modules" || item === ".git" || item === ".agents" || item === "package-lock.json") {
        continue;
      }
      
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        scan(fullPath);
      } else if (stat.isFile()) {
        const itemLower = item.toLowerCase();
        let matchType = null;
        let snippet = "";

        if (itemLower.includes(queryLower)) {
          matchType = "filename";
        } else {
          const ext = path.extname(item).toLowerCase();
          if ([".txt", ".js", ".json", ".html", ".css", ".md"].includes(ext)) {
            try {
              const content = fs.readFileSync(fullPath, "utf8");
              const index = content.toLowerCase().indexOf(queryLower);
              if (index !== -1) {
                matchType = "content";
                const start = Math.max(0, index - 30);
                const end = Math.min(content.length, index + queryLower.length + 30);
                snippet = "..." + content.slice(start, end).replace(/\n/g, " ") + "...";
              }
            } catch (e) {
              // Ignore binary/unreadable
            }
          }
        }

        if (matchType) {
          results.push({
            name: item,
            path: relativePath,
            size: stat.size,
            matchType,
            snippet
          });
        }
      }
    }
  }

  try {
    scan(baseDir);
  } catch (err) {
    console.error("Error scanning directories:", err);
  }

  return results.slice(0, 15);
}

// -----------------------------------------------------------------------------
// Ollama API Helpers
// -----------------------------------------------------------------------------
async function getRunningModel() {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`);
    if (res.ok) {
      const data = await res.json();
      const models = data.models || [];
      // Find a model matching phi3:mini, phi3, or default to the first loaded model
      const found = models.find(m => m.name.toLowerCase().includes("phi3") || m.name.toLowerCase().includes("phi-3"));
      if (found) return found.name;
      if (models.length > 0) return models[0].name;
    }
  } catch (e) {
    console.log("Could not query Ollama models list, using default:", DEFAULT_MODEL);
  }
  return DEFAULT_MODEL;
}

// Execute a tool and return structured string
function executeTool(action, args) {
  console.log(`[Agent Tool Exec] Executing: ${action}`, args);
  try {
    switch (action) {
      case "listNotes": {
        const notes = getNotesList();
        return JSON.stringify({ success: true, notes });
      }
      case "readNote": {
        const content = readNoteContent(args.name);
        return JSON.stringify({ success: true, name: args.name, content });
      }
      case "createNote": {
        const res = writeNoteContent(args.name, args.content);
        return JSON.stringify({ success: true, message: `Created/updated note '${res.name}'` });
      }
      case "deleteNote": {
        removeNoteFile(args.name);
        return JSON.stringify({ success: true, message: `Deleted note '${args.name}'` });
      }
      case "searchFiles": {
        const files = searchLocalFiles(args.query);
        return JSON.stringify({ success: true, files });
      }
      default:
        return JSON.stringify({ success: false, error: `Unknown action '${action}'` });
    }
  } catch (err) {
    return JSON.stringify({ success: false, error: err.message });
  }
}

// -----------------------------------------------------------------------------
// REST API Routes
// -----------------------------------------------------------------------------

app.get("/api/config", async (req, res) => {
  let ollamaConnected = false;
  let modelName = "";
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/tags`);
    if (response.ok) {
      ollamaConnected = true;
      modelName = await getRunningModel();
    }
  } catch (e) {
    // offline/disconnected
  }
  res.json({ ollamaConnected, modelName });
});

// Standard REST endpoints for direct UI control
app.get("/api/notes", (req, res) => res.json(getNotesList()));
app.get("/api/notes/:name", (req, res) => {
  try {
    res.json({ name: req.params.name, content: readNoteContent(req.params.name) });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});
app.post("/api/notes", (req, res) => {
  const { name, content } = req.body;
  if (!name || typeof content !== "string") return res.status(400).json({ error: "Missing name or content" });
  res.json(writeNoteContent(name, content));
});
app.delete("/api/notes/:name", (req, res) => {
  try {
    res.json(removeNoteFile(req.params.name));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});
app.get("/api/search", (req, res) => {
  res.json(searchLocalFiles(req.query.q || ""));
});

// Agent Chat route utilizing ReAct with Ollama
app.post("/api/chat", async (req, res) => {
  const { message, history = [] } = req.body;
  if (!message) return res.status(400).json({ error: "Message is required" });

  const model = await getRunningModel();
  
  const systemInstruction = 
    `You are OpenClaw Mini, a local AI assistant running on the user's PC using ${model}.\n` +
    `You can perform actions on the local PC by replying with a single line of JSON action at the end of your response.\n\n` +
    `AVAILABLE ACTIONS:\n` +
    `- List notes: {"action": "listNotes"}\n` +
    `- Read a note: {"action": "readNote", "name": "note_name"}\n` +
    `- Create note: {"action": "createNote", "name": "note_name", "content": "text content here"}\n` +
    `- Delete note: {"action": "deleteNote", "name": "note_name"}\n` +
    `- Search files: {"action": "searchFiles", "query": "search query"}\n\n` +
    `INSTRUCTIONS:\n` +
    `1. If the user asks you to list notes, create/write a note, read a note, delete a note, or search files, you MUST output ONLY the corresponding JSON action block, e.g. {"action": "listNotes"}\n` +
    `2. Do not explain your action if you are outputting the JSON action.\n` +
    `3. If you are just answering a question, summarizing, or conversing, speak normally and do not output any JSON.\n\n` +
    `EXAMPLES:\n` +
    `User: list notes\n` +
    `Assistant: {"action": "listNotes"}\n` +
    `User: search for welcome\n` +
    `Assistant: {"action": "searchFiles", "query": "welcome"}\n` +
    `User: write a note called todo with buy milk\n` +
    `Assistant: {"action": "createNote", "name": "todo", "content": "buy milk"}`;

  try {
    // Construct prompt history for Ollama
    const messages = [
      { role: "system", content: systemInstruction }
    ];
    for (const h of history) {
      messages.push({ role: h.role, content: h.content });
    }
    messages.push({ role: "user", content: message });

    console.log(`[Agent Input] User: ${message}`);
    
    // Call Ollama
    const ollamaResponse = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model,
        messages: messages,
        stream: false,
        options: { temperature: 0.1 }
      })
    });

    if (!ollamaResponse.ok) {
      throw new Error(`Ollama returned status ${ollamaResponse.status}`);
    }

    const data = await ollamaResponse.json();
    let replyText = data.message?.content || "";
    console.log(`[Agent Raw Output]: ${replyText}`);

    // Parse for JSON actions
    let actionFound = null;
    const jsonRegex = /\{"action"\s*:\s*"[^"]+".*?\}/s;
    const match = replyText.match(jsonRegex);

    if (match) {
      try {
        actionFound = JSON.parse(match[0]);
      } catch (err) {
        console.error("Failed to parse agent JSON match:", match[0], err);
      }
    }

    // Execute the action if found
    if (actionFound && actionFound.action) {
      const toolOutput = executeTool(actionFound.action, actionFound);
      
      // Feed the tool output back into the conversation to generate a conversational response
      const followUpMessages = [
        ...messages,
        { role: "assistant", content: JSON.stringify(actionFound) },
        { role: "system", content: `Tool execution result: ${toolOutput}. State this result clearly to the user in a short friendly summary. Do not output any more JSON.` }
      ];

      const followUpResponse = await fetch(`${OLLAMA_HOST}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model,
          messages: followUpMessages,
          stream: false,
          options: { temperature: 0.2 }
        })
      });

      if (followUpResponse.ok) {
        const followUpData = await followUpResponse.json();
        replyText = followUpData.message?.content || "";
        console.log(`[Agent Final Output]: ${replyText}`);
      } else {
        replyText = `I executed the action '${actionFound.action}' successfully: ${toolOutput}`;
      }
    }

    res.json({ response: replyText });
  } catch (err) {
    console.error("Ollama communication failure:", err);
    res.status(500).json({ 
      error: `Could not connect to Ollama (host: ${OLLAMA_HOST}). Make sure you ran 'ollama run phi3:mini' first. Error: ${err.message}` 
    });
  }
});

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`OpenClaw Minimal Demo running at http://localhost:${PORT}`);
  console.log(`Targeting Ollama at: ${OLLAMA_HOST}`);
  console.log(`Default Model: ${DEFAULT_MODEL}`);
  console.log(`==================================================`);
});
