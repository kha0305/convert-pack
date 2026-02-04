const express = require("express");
const multer = require("multer");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const open = require("open");
const fs = require("fs-extra");

// Import converters
const JavaToBedrockConverter = require("./converter/java-to-bedrock");
const BedrockToJavaConverter = require("./converter/bedrock-to-java");
const JavaVersionConverter = require("./converter/java-version");
const ItemsAdderConverter = require("./converter/itemsadder-to-bedrock");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Ensure directories exist
const uploadsDir = path.join(__dirname, "uploads");
const outputDir = path.join(__dirname, "output");
fs.ensureDirSync(uploadsDir);
fs.ensureDirSync(outputDir);

// Storage setup
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  },
});
const upload = multer({ storage });

app.use(express.static("public"));
app.use(express.json());

// Routes
app.post("/api/convert", upload.single("pack"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const mode = req.body.mode || "java-to-bedrock";
  const targetVersion = req.body.targetVersion || "1.20-1.20.1";
  const filePath = req.file.path;
  const socketId = req.body.socketId;

  // Logger function that sends to both console and socket
  const log = (msg) => {
    if (socketId) io.to(socketId).emit("log", msg);
    console.log(`[${mode}] ${msg}`);
  };

  try {
    let converter;
    let outputPath;
    const originalName = req.file.originalname;

    log(`Starting conversion: ${mode}`);
    log(`Input file: ${originalName}`);

    switch (mode) {
      case "java-to-bedrock":
        converter = new JavaToBedrockConverter(
          filePath,
          outputDir,
          log,
          originalName,
        );
        outputPath = await converter.convert();
        break;

      case "bedrock-to-java":
        converter = new BedrockToJavaConverter(
          filePath,
          outputDir,
          log,
          originalName,
        );
        outputPath = await converter.convert();
        break;

      case "java-version":
        converter = new JavaVersionConverter(
          filePath,
          outputDir,
          targetVersion,
          log,
          originalName,
        );
        outputPath = await converter.convert();
        break;

      case "itemsadder-to-bedrock":
        converter = new ItemsAdderConverter(
          filePath,
          outputDir,
          log,
          originalName,
        );
        outputPath = await converter.convert();
        break;

      default:
        throw new Error("Unknown conversion mode");
    }

    log("Preparing download...");

    // Send the converted file
    const outputFilename = path.basename(outputPath);
    res.download(outputPath, outputFilename, async (err) => {
      if (err) {
        log("Error sending file: " + err.message);
      }
      // Cleanup files
      await fs.remove(filePath).catch(() => {});
      await fs.remove(outputPath).catch(() => {});
    });
  } catch (error) {
    log("Error: " + error.message);
    res.status(500).json({ error: error.message });
    await fs.remove(filePath).catch(() => {});
  }
});

// Get available versions for Java version conversion
app.get("/api/versions", (req, res) => {
  res.json({
    versions: Object.keys(JavaVersionConverter.PACK_FORMATS),
  });
});

// Clear temp files
app.post("/api/clear-temp", async (req, res) => {
  try {
    // Clear uploads folder
    const uploadFiles = await fs.readdir(uploadsDir);
    for (const file of uploadFiles) {
      await fs.remove(path.join(uploadsDir, file)).catch(() => {});
    }

    // Clear temp folders in output
    const outputFiles = await fs.readdir(outputDir);
    for (const file of outputFiles) {
      if (file.startsWith("temp_")) {
        await fs.remove(path.join(outputDir, file)).catch(() => {});
      }
    }

    // Clear converted files in output
    for (const file of outputFiles) {
      if (
        file.endsWith(".mcpack") ||
        file.endsWith(".zip") ||
        file.endsWith(".mcaddon")
      ) {
        await fs.remove(path.join(outputDir, file)).catch(() => {});
      }
    }

    res.json({ success: true, message: "Temp files cleared" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Socket.io connection
io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);
  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`
╔══════════════════════════════════════════╗
║        Pack Converter Tool v1.0          ║
║     Running at http://localhost:${PORT}     ║
╚══════════════════════════════════════════╝
    `);
  // Only open browser in development mode
  if (process.env.NODE_ENV !== "production") {
    await open(`http://localhost:${PORT}`);
  }
});
