import express from "express";
import os from "os";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "qwen3:4b";

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

function appendNoteContent(name, text) {
  const safeName = path.basename(name).replace(/\.txt$/, "") + ".txt";
  const filePath = path.join(NOTES_DIR, safeName);
  let existing = "";
  if (fs.existsSync(filePath)) {
    existing = fs.readFileSync(filePath, "utf8");
    if (existing && !existing.endsWith("\n")) existing += "\n";
  }
  const updated = existing + text;
  fs.writeFileSync(filePath, updated, "utf8");
  return { success: true, name: safeName.replace(".txt", ""), content: updated };
}

function getAllNotesText() {
  const notes = getNotesList();
  if (notes.length === 0) return "No notes available.";
  return notes.map(n => {
    try {
      const content = readNoteContent(n.name);
      return `--- Note: ${n.name} ---\n${content}`;
    } catch (e) {
      return `--- Note: ${n.name} (unreadable) ---`;
    }
  }).join("\n\n");
}

function getSystemMetrics() {
  const totalMem = Math.round(os.totalmem() / (1024 * 1024 * 1024) * 10) / 10;
  const freeMem = Math.round(os.freemem() / (1024 * 1024 * 1024) * 10) / 10;
  const usedMem = Math.round((totalMem - freeMem) * 10) / 10;
  const procMem = Math.round(process.memoryUsage().rss / (1024 * 1024) * 10) / 10;
  return {
    platform: `${os.type()} (${os.arch()})`,
    nodeVersion: process.version,
    serverMemoryRSS: `${procMem} MB`,
    systemRAM: `${usedMem} GB used / ${totalMem} GB total (${freeMem} GB free)`,
    uptimeSeconds: Math.round(process.uptime()),
    cpuCores: os.cpus().length
  };
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
  if (process.env.OLLAMA_MODEL) {
    return process.env.OLLAMA_MODEL;
  }
  try {
    // 1. Check if any model is currently loaded in memory (/api/ps)
    try {
      const psRes = await fetch(`${OLLAMA_HOST}/api/ps`, { signal: AbortSignal.timeout(2000) });
      if (psRes.ok) {
        const psData = await psRes.json();
        if (psData.models && psData.models.length > 0) {
          return psData.models[0].name;
        }
      }
    } catch (_) {}

    // 2. Query available local models (/api/tags)
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      const models = data.models || [];
      // Prefer models matching qwen, phi3, or llama
      const preferred = models.find(m => {
        const n = m.name.toLowerCase();
        return n.includes("qwen") || n.includes("phi3") || n.includes("phi-3") || n.includes("llama");
      });
      if (preferred) return preferred.name;
      if (models.length > 0) return models[0].name;
    }
  } catch (e) {
    console.log("Could not query Ollama models list, using default:", DEFAULT_MODEL);
  }
  return DEFAULT_MODEL;
}

// Robust JSON action extractor from model output (handles code fences and raw JSON)
function extractActionJson(text) {
  if (!text) return null;
  // Try markdown code block first
  const codeBlockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?"action"[\s\S]*?\})\s*```/i);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1]);
    } catch (_) {}
  }
  // Try raw JSON action object
  const rawMatch = text.match(/\{[\s\S]*?"action"\s*:\s*"[^"]+"[\s\S]*?\}/);
  if (rawMatch) {
    try {
      return JSON.parse(rawMatch[0]);
    } catch (_) {}
  }
  return null;
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
      case "appendNote": {
        const res = appendNoteContent(args.name, args.content || "");
        return JSON.stringify({ success: true, message: `Appended content to note '${res.name}'` });
      }
      case "deleteNote": {
        removeNoteFile(args.name);
        return JSON.stringify({ success: true, message: `Deleted note '${args.name}'` });
      }
      case "summarizeAllNotes": {
        const allText = getAllNotesText();
        return JSON.stringify({ success: true, allNotesOverview: allText });
      }
      case "getSystemStats": {
        const stats = getSystemMetrics();
        return JSON.stringify({ success: true, systemStats: stats });
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

app.get("/api/system", (req, res) => {
  res.json(getSystemMetrics());
});

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

function formatToolSummary(action, rawOutput) {
  try {
    const data = JSON.parse(rawOutput);
    switch (action) {
      case "getSystemStats": {
        const s = data.systemStats;
        return `⚡ **System Health & Resources:**\n` +
               `• **Platform:** ${s.platform}\n` +
               `• **Node Version:** ${s.nodeVersion}\n` +
               `• **System RAM:** ${s.systemRAM}\n` +
               `• **Server Memory (RSS):** ${s.serverMemoryRSS} (zero bloat)\n` +
               `• **CPU Cores:** ${s.cpuCores}\n` +
               `• **Uptime:** ${s.uptimeSeconds} seconds`;
      }
      case "listNotes": {
        if (!data.notes || data.notes.length === 0) return "You currently have no notes in `./notes`. Ask me to create one!";
        const list = data.notes.map(n => `• **${n.name}** (${n.size} bytes)`).join("\n");
        return `📁 **Local Notes in Workspace (${data.notes.length}):**\n${list}`;
      }
      case "readNote": {
        return `📄 **Note: ${data.name}**\n\n${data.content}`;
      }
      case "createNote":
      case "appendNote":
      case "deleteNote": {
        return `✅ ${data.message || "Action completed successfully."}`;
      }
      case "searchFiles": {
        if (!data.files || data.files.length === 0) return `🔍 No matching files found in the workspace for that query.`;
        const list = data.files.map(f => `• **${f.name}** (${f.path}) [${f.matchType}]${f.snippet ? `\n  > ${f.snippet}` : ''}`).join("\n");
        return `🔍 **Found ${data.files.length} matching file(s):**\n${list}`;
      }
      case "summarizeAllNotes": {
        return `📋 **Executive Notes Overview:**\n\n${data.allNotesOverview}`;
      }
      default:
        return `Executed ${action}: ${rawOutput}`;
    }
  } catch (e) {
    return `Action '${action}' executed: ${rawOutput}`;
  }
}

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
    `- Append note: {"action": "appendNote", "name": "note_name", "content": "text to append"}\n` +
    `- Delete note: {"action": "deleteNote", "name": "note_name"}\n` +
    `- Summarize all notes: {"action": "summarizeAllNotes"}\n` +
    `- System health & stats: {"action": "getSystemStats"}\n` +
    `- Search files: {"action": "searchFiles", "query": "search query"}\n\n` +
    `INSTRUCTIONS:\n` +
    `1. If the user asks you to list notes, create/write/append a note, read a note, delete a note, summarize all notes, check system stats/RAM, or search files, you MUST output ONLY the corresponding JSON action block.\n` +
    `2. Do not explain your action if you are outputting the JSON action.\n` +
    `3. If you are just answering a question or conversing, speak normally and do not output any JSON.\n\n` +
    `EXAMPLES:\n` +
    `User: list notes\n` +
    `Assistant: {"action": "listNotes"}\n` +
    `User: summarize all my notes\n` +
    `Assistant: {"action": "summarizeAllNotes"}\n` +
    `User: how is my system or ram?\n` +
    `Assistant: {"action": "getSystemStats"}\n` +
    `User: add buy milk to checklist\n` +
    `Assistant: {"action": "appendNote", "name": "checklist", "content": "- [ ] Buy milk"}\n` +
    `User: search for express\n` +
    `Assistant: {"action": "searchFiles", "query": "express"}\n` +
    `User: write a note called todo with buy milk\n` +
    `Assistant: {"action": "createNote", "name": "todo", "content": "buy milk"}`;

  try {
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
      }),
      signal: AbortSignal.timeout(60000)
    });

    if (!ollamaResponse.ok) {
      throw new Error(`Ollama returned status ${ollamaResponse.status}`);
    }

    const data = await ollamaResponse.json();
    let replyText = data.message?.content || "";
    console.log(`[Agent Raw Output]: ${replyText}`);

    // If model output contains reasoning <think>...</think> tags, strip them for clean UI & action detection
    if (replyText.includes("<think>")) {
      replyText = replyText.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    }

    // Parse for JSON actions using robust parser
    const actionFound = extractActionJson(replyText);

    // Execute the action if found
    if (actionFound && actionFound.action) {
      const toolOutput = executeTool(actionFound.action, actionFound);
      const fallbackReply = formatToolSummary(actionFound.action, toolOutput);

      // Fast-path for instant response tools (health stats, search, read, list)
      if (["getSystemStats", "searchFiles", "readNote", "listNotes"].includes(actionFound.action)) {
        return res.json({ response: fallbackReply });
      }

      // Try AI summary for creative actions with a 20s timeout
      try {
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
          }),
          signal: AbortSignal.timeout(20000)
        });

        if (followUpResponse.ok) {
          const followUpData = await followUpResponse.json();
          let followUpContent = followUpData.message?.content || fallbackReply;
          if (followUpContent.includes("<think>")) {
            followUpContent = followUpContent.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
          }
          replyText = followUpContent || fallbackReply;
        } else {
          replyText = fallbackReply;
        }
      } catch (err) {
        console.log("Follow-up AI formatting timed out, using instant formatted fallback");
        replyText = fallbackReply;
      }
    }

    res.json({ response: replyText });
  } catch (err) {
    console.error("Ollama communication failure:", err);
    res.status(500).json({ 
      error: `Could not connect to Ollama (host: ${OLLAMA_HOST}). Make sure Ollama is running ('ollama serve' or 'ollama run qwen3:4b'). Error: ${err.message}` 
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
