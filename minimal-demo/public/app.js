// ==========================================================================
// OpenClaw Mini Frontend JavaScript
// ==========================================================================

// Global state
let currentNote = null;
let chatHistoryList = [];

// DOM Elements
const statusIndicator = document.getElementById("statusIndicator");
const statusText = document.getElementById("statusText");
const statusPanel = document.getElementById("statusPanel");

const chatHistory = document.getElementById("chatHistory");
const chatInput = document.getElementById("chatInput");
const btnSend = document.getElementById("btnSend");
const btnClearChat = document.getElementById("btnClearChat");
const chatSuggestions = document.getElementById("chatSuggestions");

const notesList = document.getElementById("notesList");
const noteViewer = document.getElementById("noteViewer");
const viewerContent = document.getElementById("viewerContent");
const currentNoteTitle = document.getElementById("currentNoteTitle");
const noteBodyEditor = document.getElementById("noteBodyEditor");
const noteTitleInput = document.getElementById("noteTitleInput");

const btnCreateNote = document.getElementById("btnCreateNote");
const btnSaveNote = document.getElementById("btnSaveNote");
const btnDeleteNote = document.getElementById("btnDeleteNote");

const searchInput = document.getElementById("searchInput");
const btnSearch = document.getElementById("btnSearch");
const searchResults = document.getElementById("searchResults");
const searchInfo = document.getElementById("searchInfo");

// -----------------------------------------------------------------------------
// Connection & Config Check
// -----------------------------------------------------------------------------
async function checkConnection() {
  try {
    const res = await fetch("/api/config");
    if (res.ok) {
      const data = await res.json();
      if (data.ollamaConnected) {
        statusIndicator.className = "status-indicator online";
        statusText.innerHTML = `Ollama Connected: <strong>${data.modelName}</strong>`;
        statusPanel.style.borderColor = "rgba(16, 185, 129, 0.3)";
      } else {
        statusIndicator.className = "status-indicator offline";
        statusText.innerHTML = `Ollama Offline (No Model Connected)`;
        statusPanel.style.borderColor = "rgba(239, 68, 68, 0.3)";
      }
    }
  } catch (err) {
    statusIndicator.className = "status-indicator offline";
    statusText.innerText = "Server Disconnected";
    statusPanel.style.borderColor = "rgba(239, 68, 68, 0.3)";
  }
}

// -----------------------------------------------------------------------------
// Notes Management
// -----------------------------------------------------------------------------
async function fetchNotes() {
  try {
    const res = await fetch("/api/notes");
    if (!res.ok) throw new Error("Failed to load notes");
    const notes = await res.json();
    renderNotesList(notes);
  } catch (err) {
    notesList.innerHTML = `<div class="loading-spinner" style="color:var(--danger)">Error: ${err.message}</div>`;
  }
}

function renderNotesList(notes) {
  if (notes.length === 0) {
    notesList.innerHTML = `<div class="loading-spinner">No local notes found. Ask the agent to create one!</div>`;
    return;
  }

  notesList.innerHTML = "";
  notes.forEach(note => {
    const noteEl = document.createElement("div");
    noteEl.className = `note-item ${currentNote && currentNote.name === note.name ? "active" : ""}`;
    
    const formattedDate = new Date(note.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    noteEl.innerHTML = `
      <span class="note-item-title">📄 ${note.name}</span>
      <span class="note-item-meta">${note.size} bytes • Updated ${formattedDate}</span>
    `;
    
    noteEl.addEventListener("click", () => selectNote(note.name));
    notesList.appendChild(noteEl);
  });
}

async function selectNote(name) {
  try {
    const res = await fetch(`/api/notes/${name}`);
    if (!res.ok) throw new Error("Could not read note");
    currentNote = await res.json();
    
    // Update UI
    document.querySelectorAll(".note-item").forEach(item => {
      if (item.querySelector(".note-item-title").innerText.includes(name)) {
        item.classList.add("active");
      } else {
        item.classList.remove("active");
      }
    });

    noteViewer.classList.remove("empty");
    viewerContent.classList.remove("hidden");
    currentNoteTitle.innerText = `📄 ${currentNote.name}`;
    noteBodyEditor.value = currentNote.content;
  } catch (err) {
    alert(err.message);
  }
}

// Save note changes
btnSaveNote.addEventListener("click", async () => {
  if (!currentNote) return;
  const content = noteBodyEditor.value;
  try {
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: currentNote.name, content })
    });
    if (res.ok) {
      btnSaveNote.innerText = "Saved!";
      setTimeout(() => { btnSaveNote.innerText = "Save Changes"; }, 1500);
      fetchNotes();
    } else {
      throw new Error("Failed to save changes");
    }
  } catch (err) {
    alert(err.message);
  }
});

// Delete note
btnDeleteNote.addEventListener("click", async () => {
  if (!currentNote) return;
  if (!confirm(`Are you sure you want to delete note "${currentNote.name}"?`)) return;
  
  try {
    const res = await fetch(`/api/notes/${currentNote.name}`, {
      method: "DELETE"
    });
    if (res.ok) {
      currentNote = null;
      noteViewer.classList.add("empty");
      viewerContent.classList.add("hidden");
      fetchNotes();
    } else {
      throw new Error("Failed to delete note");
    }
  } catch (err) {
    alert(err.message);
  }
});

// Create note
btnCreateNote.addEventListener("click", async () => {
  const name = noteTitleInput.value.trim();
  if (!name) return alert("Please enter a note title");
  
  try {
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, content: "" })
    });
    if (res.ok) {
      noteTitleInput.value = "";
      await fetchNotes();
      selectNote(name);
    } else {
      throw new Error("Note name already exists or is invalid");
    }
  } catch (err) {
    alert(err.message);
  }
});

// Handle noteTitleInput Enter key
noteTitleInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") btnCreateNote.click();
});

// -----------------------------------------------------------------------------
// File Search
// -----------------------------------------------------------------------------
async function performSearch(query) {
  if (!query) return;
  searchResults.innerHTML = `<div class="loading-spinner">Searching workspace...</div>`;
  searchInfo.innerText = `Searching for "${query}"...`;
  
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error("Search failed");
    const results = await res.json();
    
    renderSearchResults(results, query);
  } catch (err) {
    searchResults.innerHTML = `<div style="color:var(--danger); padding:10px;">Error: ${err.message}</div>`;
  }
}

function renderSearchResults(results, query) {
  searchInfo.innerText = `Found ${results.length} result(s) for "${query}"`;
  
  if (results.length === 0) {
    searchResults.innerHTML = `<div class="loading-spinner">No matching files found in this workspace.</div>`;
    return;
  }

  searchResults.innerHTML = "";
  results.forEach(item => {
    const card = document.createElement("div");
    card.className = "search-item";
    
    const sizeKB = (item.size / 1024).toFixed(2);
    const badgeClass = item.matchType === "filename" ? "filename" : "content";
    const badgeText = item.matchType === "filename" ? "Name Match" : "Content Match";
    
    card.innerHTML = `
      <div class="search-item-header">
        <span class="search-item-name">📄 ${item.name}</span>
        <span class="search-item-badge ${badgeClass}">${badgeText}</span>
      </div>
      <div class="search-item-path">${item.path} (${sizeKB} KB)</div>
      ${item.snippet ? `<div class="search-item-snippet">${escapeHtml(item.snippet)}</div>` : ""}
    `;
    
    searchResults.appendChild(card);
  });
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

btnSearch.addEventListener("click", () => {
  performSearch(searchInput.value.trim());
});

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") btnSearch.click();
});

// -----------------------------------------------------------------------------
// Agent Chat
// -----------------------------------------------------------------------------
async function sendMessage() {
  const message = chatInput.value.trim();
  if (!message) return;
  
  // Clear input & auto shrink textarea
  chatInput.value = "";
  chatInput.style.height = "auto";
  
  // Append user message
  appendChatMessage("user", message);
  
  // Create typing indicator placeholder
  const indicator = appendChatMessage("assistant", `<div class="loading-spinner" style="padding:0">Agent is thinking...</div>`);
  
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: message,
        history: chatHistoryList
      })
    });
    
    indicator.remove(); // remove loading indicator
    
    if (res.ok) {
      const data = await res.json();
      
      // Parse markdown-like bold/code styles for assistant output
      const formattedResponse = formatAgentText(data.response);
      appendChatMessage("assistant", formattedResponse);
      
      // Save history
      chatHistoryList.push({ role: "user", content: message });
      chatHistoryList.push({ role: "assistant", content: data.response });
      
      // Auto refresh data (in case agent created, deleted, or edited notes)
      fetchNotes();
      
      // If the message was search, update the search tab and switch if wanted
      if (message.toLowerCase().includes("search")) {
        const queryMatch = message.match(/search (?:for|files for)?\s*"?([^"]+)"?/i);
        if (queryMatch) {
          const q = queryMatch[1];
          searchInput.value = q;
          // Switch to search tab
          document.querySelector('button[data-tab="searchTab"]').click();
          performSearch(q);
        }
      }
    } else {
      const data = await res.json();
      appendChatMessage("assistant", `<span style="color:var(--danger)">Error: ${data.error || "Failed to talk to agent."}</span>`);
    }
  } catch (err) {
    indicator.remove();
    appendChatMessage("assistant", `<span style="color:var(--danger)">Could not contact backend server. Make sure node server.js is running.</span>`);
  }
}

function appendChatMessage(role, htmlContent) {
  const msgEl = document.createElement("div");
  msgEl.className = `message ${role}`;
  
  msgEl.innerHTML = `
    <div class="message-bubble">
      ${htmlContent}
    </div>
  `;
  
  chatHistory.appendChild(msgEl);
  chatHistory.scrollTop = chatHistory.scrollHeight;
  return msgEl;
}

// Simple text formatter for agent's markdown response
function formatAgentText(text) {
  if (!text) return "";
  // Escape raw HTML characters to prevent XSS
  let formatted = escapeHtml(text);

  // Convert multi-line code blocks ```code```
  formatted = formatted.replace(/```(?:[a-zA-Z0-9_-]+)?\n?([\s\S]*?)```/g, (match, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  // Convert inline code `code`
  formatted = formatted.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Convert double-asterisk bold **bold**
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // Convert bullet lists
  formatted = formatted.replace(/(?:^|\n)\s*[-*•]\s+(.+)/g, "<br>• $1");

  // Convert remaining newlines to breaks
  formatted = formatted.replace(/\n/g, "<br>");

  return formatted;
}

btnSend.addEventListener("click", sendMessage);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto grow textarea based on content
chatInput.addEventListener("input", function() {
  this.style.height = "auto";
  this.style.height = (this.scrollHeight) + "px";
});

// Clear Chat History
btnClearChat.addEventListener("click", () => {
  chatHistory.innerHTML = `
    <div class="message assistant">
      <div class="message-bubble">
        Chat history cleared. How can I help you manage your notes or search workspace files now?
      </div>
    </div>
  `;
  chatHistoryList = [];
});

// Suggestions click handler
chatSuggestions.addEventListener("click", (e) => {
  const tag = e.target.closest(".suggestion-tag");
  if (!tag) return;
  
  const prompt = tag.getAttribute("data-prompt") || tag.innerText;
  chatInput.value = prompt;
  chatInput.focus();
  chatInput.dispatchEvent(new Event("input"));
});

// -----------------------------------------------------------------------------
// Tabs Handler
// -----------------------------------------------------------------------------
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    // Deactivate all tabs
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    
    // Activate clicked tab
    btn.classList.add("active");
    const tabId = btn.getAttribute("data-tab");
    document.getElementById(tabId).classList.add("active");
  });
});

// -----------------------------------------------------------------------------
// App Initialization
// -----------------------------------------------------------------------------
function init() {
  checkConnection();
  fetchNotes();
  
  // Periodically check connection every 10 seconds
  setInterval(checkConnection, 10000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
