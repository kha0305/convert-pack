// Socket.io connection
const socket = io();
let socketId = null;

socket.on("connect", () => {
  socketId = socket.id;
  addLog("Connected to server", "success");
});

socket.on("disconnect", () => {
  addLog("Disconnected from server", "warning");
});

socket.on("log", (message) => {
  addLog(message);
});

// DOM Elements
const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const fileInfo = document.getElementById("fileInfo");
const fileName = document.getElementById("fileName");
const fileSize = document.getElementById("fileSize");
const removeFileBtn = document.getElementById("removeFile");
const modeSelect = document.getElementById("modeSelect");
const versionGroup = document.getElementById("versionGroup");
const versionSelect = document.getElementById("versionSelect");
const convertBtn = document.getElementById("convertBtn");
const btnText = convertBtn.querySelector(".btn-text");
const btnLoader = convertBtn.querySelector(".btn-loader");
const logsContainer = document.getElementById("logs");
const clearLogsBtn = document.getElementById("clearLogs");
const clearTempBtn = document.getElementById("clearTemp");
const reloadConsoleBtn = document.getElementById("reloadConsole");

let selectedFile = null;

// Event Listeners
dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("dragover", handleDragOver);
dropZone.addEventListener("dragleave", handleDragLeave);
dropZone.addEventListener("drop", handleDrop);
fileInput.addEventListener("change", (e) => handleFiles(e.target.files));
removeFileBtn.addEventListener("click", removeFile);
modeSelect.addEventListener("change", handleModeChange);
convertBtn.addEventListener("click", startConversion);
clearLogsBtn.addEventListener("click", clearLogs);
clearTempBtn.addEventListener("click", clearTempFiles);
reloadConsoleBtn.addEventListener("click", () => window.location.reload());

// Drag & Drop Handlers
function handleDragOver(e) {
  e.preventDefault();
  dropZone.classList.add("drag-over");
}

function handleDragLeave() {
  dropZone.classList.remove("drag-over");
}

function handleDrop(e) {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  handleFiles(e.dataTransfer.files);
}

// File Handling
function handleFiles(files) {
  if (files.length === 0) return;

  const file = files[0];
  const validExtensions = [".zip", ".mcpack"];
  const ext = file.name.toLowerCase().substring(file.name.lastIndexOf("."));

  if (!validExtensions.includes(ext)) {
    addLog(
      "Invalid file type: " + ext + ". Please use .zip or .mcpack",
      "error",
    );
    return;
  }

  selectedFile = file;

  // Update UI
  dropZone.style.display = "none";
  fileInfo.style.display = "flex";
  fileName.textContent = file.name;
  fileSize.textContent = formatFileSize(file.size);
  convertBtn.disabled = false;

  addLog(
    "Selected: " + file.name + " (" + formatFileSize(file.size) + ")",
    "info",
  );
}

function removeFile() {
  selectedFile = null;
  fileInput.value = "";
  dropZone.style.display = "block";
  fileInfo.style.display = "none";
  convertBtn.disabled = true;
  addLog("File removed", "info");
}

function formatFileSize(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// Mode Change Handler
function handleModeChange() {
  const mode = document.getElementById("modeSelect").value;
  versionGroup.style.display = mode === "java-version" ? "block" : "none";

  // Update button text based on mode
  const modeNames = {
    "java-to-bedrock": "Convert to Bedrock",
    "bedrock-to-java": "Convert to Java",
    "java-version": "Update Version",
    "itemsadder-to-bedrock": "Convert ItemsAdder",
  };
  btnText.textContent = modeNames[mode] || "Start Conversion";
}

// Terminal/Logs
function addLog(message, type = "info") {
  const line = document.createElement("div");
  line.className = `log-line ${type}`;

  const timestamp = new Date().toLocaleTimeString();
  line.textContent = `[${timestamp}] ${message}`;

  logsContainer.appendChild(line);
  logsContainer.scrollTop = logsContainer.scrollHeight;
}

function clearLogs() {
  logsContainer.innerHTML = "";
  addLog("Logs cleared", "info");
}

async function clearTempFiles() {
  try {
    addLog("Clearing temp files...", "info");
    const response = await fetch("/clear-temp", { method: "POST" });
    const data = await response.json();

    if (data.success) {
      addLog("Temp files cleared successfully!", "success");
    } else {
      addLog("Error: " + (data.error || "Failed to clear"), "error");
    }
  } catch (error) {
    addLog("Error clearing temp files: " + error.message, "error");
  }
}

// Custom Dropdown Logic
function setupCustomDropdowns() {
  const dropdowns = document.querySelectorAll(".custom-select");

  dropdowns.forEach((dropdown) => {
    const trigger = dropdown.querySelector(".select-trigger");
    const input = dropdown.querySelector("input[type='hidden']");
    const options = dropdown.querySelectorAll(".option");
    const triggerSpan = trigger.querySelector("span");

    // Toggle dropdown
    trigger.addEventListener("click", (e) => {
      // Close other dropdowns
      dropdowns.forEach((d) => {
        if (d !== dropdown) d.classList.remove("open");
      });
      dropdown.classList.toggle("open");
      e.stopPropagation(); // Prevent closing immediately
    });

    // Select option
    options.forEach((option) => {
      option.addEventListener("click", (e) => {
        // Update styling
        options.forEach((opt) => opt.classList.remove("selected"));
        option.classList.add("selected");

        // Update value and text
        const value = option.getAttribute("data-value");
        const text = option.textContent;

        input.value = value;
        triggerSpan.textContent = text;

        // Close dropdown
        dropdown.classList.remove("open");
        e.stopPropagation();

        // Trigger change event/logic
        if (input.id === "modeSelect") {
          handleModeChange();
        }
      });
    });
  });

  // Close dropdowns when clicking outside
  document.addEventListener("click", (e) => {
    dropdowns.forEach((dropdown) => {
      if (!dropdown.contains(e.target)) {
        dropdown.classList.remove("open");
      }
    });
  });
}

// Initialize Custom Dropdowns
setupCustomDropdowns();

function formatFileSize(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// Conversion
async function startConversion() {
  if (!selectedFile) {
    addLog("No file selected", "error");
    return;
  }

  setLoading(true);
  addLog("Starting conversion...", "info");

  const formData = new FormData();
  formData.append("pack", selectedFile);
  formData.append("mode", modeSelect.value);
  formData.append("targetVersion", versionSelect.value);
  formData.append("socketId", socketId);

  try {
    const response = await fetch("/api/convert", {
      method: "POST",
      body: formData,
    });

    if (response.ok) {
      addLog("Conversion successful!", "success");
      addLog("Starting download...", "info");

      // Download the file
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;

      // Get filename from Content-Disposition header
      const disposition = response.headers.get("Content-Disposition");
      let downloadName = "converted_pack.zip";
      if (disposition) {
        const match = disposition.match(
          /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/,
        );
        if (match && match[1]) {
          downloadName = match[1].replace(/['"]/g, "");
        }
      }

      a.download = downloadName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      addLog("Downloaded: " + downloadName, "success");
    } else {
      const error = await response.json();
      addLog("Error: " + (error.error || "Unknown error"), "error");
    }
  } catch (error) {
    addLog("Network error: " + error.message, "error");
  } finally {
    setLoading(false);
  }
}

function setLoading(isLoading) {
  convertBtn.disabled = isLoading;
  btnLoader.style.display = isLoading ? "block" : "none";

  if (isLoading) {
    btnText.textContent = "Converting...";
  } else {
    handleModeChange(); // Reset button text
    convertBtn.disabled = !selectedFile;
  }
}

// Initialize
handleModeChange();
