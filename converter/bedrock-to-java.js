const fs = require("fs-extra");
const path = require("path");
const AdmZip = require("adm-zip");
const sharp = require("sharp");

/**
 * Bedrock to Java Resource Pack Converter
 */
class BedrockToJavaConverter {
  constructor(inputPath, outputDir, logger = console.log, originalName = null) {
    this.inputPath = inputPath;
    this.outputDir = outputDir;
    this.log = logger;
    this.tempDir = path.join(outputDir, "temp_" + Date.now());
    this.outputPath = null;
    this.flipbookData = null; // Store Bedrock animation data
    this.packName = originalName
      ? originalName.replace(/\.(zip|mcpack)$/i, "")
      : "converted_pack";
  }

  async convert() {
    try {
      // Step 1: Extract
      this.log("Extracting Bedrock resource pack...");
      await this.extract();

      // Step 2: Load flipbook textures (animations)
      this.log("Loading animation data...");
      await this.loadFlipbookTextures();

      // Step 3: Convert manifest.json -> pack.mcmeta
      this.log("Converting manifest.json to pack.mcmeta...");
      await this.convertManifest();

      // Step 4: Convert textures
      this.log("Converting textures...");
      await this.convertTextures();

      // Step 5: Repackage as .zip
      this.log("Repackaging as Java pack...");
      this.outputPath = await this.repackage();

      // Cleanup
      await fs.remove(this.tempDir);

      this.log("Conversion complete!");
      return this.outputPath;
    } catch (error) {
      await fs.remove(this.tempDir).catch(() => {});
      throw error;
    }
  }

  async extract() {
    const zip = new AdmZip(this.inputPath);
    zip.extractAllTo(this.tempDir, true);

    // Handle nested folders
    const entries = await fs.readdir(this.tempDir);
    if (entries.length === 1) {
      const singleEntry = path.join(this.tempDir, entries[0]);
      const stat = await fs.stat(singleEntry);
      if (stat.isDirectory()) {
        const innerEntries = await fs.readdir(singleEntry);
        for (const entry of innerEntries) {
          await fs.move(
            path.join(singleEntry, entry),
            path.join(this.tempDir, entry),
            { overwrite: true },
          );
        }
        await fs.remove(singleEntry);
      }
    }
  }

  async loadFlipbookTextures() {
    const flipbookPath = path.join(
      this.tempDir,
      "textures",
      "flipbook_textures.json",
    );

    if (await fs.pathExists(flipbookPath)) {
      try {
        this.flipbookData = await fs.readJson(flipbookPath);
        this.log(`Found ${this.flipbookData.length} animation(s)`);
      } catch (e) {
        this.log("Could not parse flipbook_textures.json");
        this.flipbookData = [];
      }
    } else {
      this.flipbookData = [];
      this.log("No animations found");
    }
  }

  async convertManifest() {
    const manifestPath = path.join(this.tempDir, "manifest.json");
    let packInfo = { header: { description: "Converted Pack", name: "Pack" } };

    if (await fs.pathExists(manifestPath)) {
      try {
        packInfo = await fs.readJson(manifestPath);
      } catch (e) {
        this.log("Could not parse manifest.json, using defaults");
      }
    }

    // Java pack.mcmeta format
    const mcmeta = {
      pack: {
        pack_format: 15, // 1.20.x format
        description:
          packInfo.header?.description || "Converted from Bedrock Edition",
      },
    };

    await fs.writeJson(path.join(this.tempDir, "pack.mcmeta"), mcmeta, {
      spaces: 2,
    });
    await fs.remove(manifestPath).catch(() => {});
  }

  async convertTextures() {
    // Bedrock uses textures/
    // Java uses assets/minecraft/textures
    const bedrockTextures = path.join(this.tempDir, "textures");
    const javaTextures = path.join(
      this.tempDir,
      "assets",
      "minecraft",
      "textures",
    );

    if (await fs.pathExists(bedrockTextures)) {
      await this.processTextureFolder(bedrockTextures, javaTextures, "");

      // Remove original Bedrock textures folder
      await fs.remove(bedrockTextures);
    }
  }

  async processTextureFolder(srcDir, destDir, relativePath) {
    await fs.ensureDir(destDir);
    const entries = await fs.readdir(srcDir, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry.name);
      let destPath = path.join(destDir, entry.name);

      if (entry.isDirectory()) {
        // Map folder names (Bedrock -> Java)
        const folderMapping = {
          blocks: "block",
          items: "item",
          entity: "entity",
          ui: "gui",
          particle: "particle",
        };
        const mappedName = folderMapping[entry.name] || entry.name;
        destPath = path.join(destDir, mappedName);
        const newRelativePath = relativePath
          ? `${relativePath}/${entry.name}`
          : entry.name;

        await this.processTextureFolder(srcPath, destPath, newRelativePath);
      } else if (entry.name.endsWith(".png")) {
        const newRelativePath = relativePath
          ? `${relativePath}/${entry.name}`
          : entry.name;
        await this.convertTexture(srcPath, destPath, newRelativePath);
      } else if (entry.name.endsWith(".tga")) {
        // Convert TGA to PNG for Java
        const pngDest = destPath.replace(".tga", ".png");
        await this.convertTgaToPng(srcPath, pngDest);
      } else if (entry.name === "flipbook_textures.json") {
        // Skip this file, we've already processed it
        continue;
      }
    }
  }

  async convertTexture(srcPath, destPath, relativePath) {
    try {
      await fs.ensureDir(path.dirname(destPath));
      await fs.copy(srcPath, destPath);

      // Check if this texture has animation data
      await this.convertAnimationToMcmeta(srcPath, destPath, relativePath);
    } catch (error) {
      this.log(`Could not convert: ${path.basename(srcPath)}`);
    }
  }

  async convertAnimationToMcmeta(srcPath, destPath, relativePath) {
    if (!this.flipbookData || this.flipbookData.length === 0) return;

    // Find matching flipbook entry
    const textureName = path.basename(srcPath, ".png");

    // Build possible Bedrock paths to match
    const bedrockPath = `textures/${relativePath.replace(".png", "")}`;
    const bedrockPathAlt = `textures/${relativePath.replace(/\\/g, "/").replace(".png", "")}`;

    const flipbookEntry = this.flipbookData.find((entry) => {
      const entryPath = entry.flipbook_texture;
      return (
        entryPath === bedrockPath ||
        entryPath === bedrockPathAlt ||
        entry.atlas_tile === textureName
      );
    });

    if (!flipbookEntry) return;

    try {
      // Create Java .mcmeta file
      const mcmeta = {
        animation: {},
      };

      // Convert ticks_per_frame to frametime
      if (flipbookEntry.ticks_per_frame) {
        mcmeta.animation.frametime = flipbookEntry.ticks_per_frame;
      }

      // Convert frames array if present
      if (flipbookEntry.frames && Array.isArray(flipbookEntry.frames)) {
        mcmeta.animation.frames = flipbookEntry.frames;
      }

      // Convert blend_frames to interpolate
      if (flipbookEntry.blend_frames) {
        mcmeta.animation.interpolate = true;
      }

      // Write .mcmeta file
      const mcmetaPath = destPath + ".mcmeta";
      await fs.writeJson(mcmetaPath, mcmeta, { spaces: 2 });
      this.log(`Converted animation: ${textureName}`);
    } catch (error) {
      this.log(`Could not convert animation: ${textureName}`);
    }
  }

  async convertTgaToPng(srcPath, destPath) {
    try {
      await fs.ensureDir(path.dirname(destPath));
      await sharp(srcPath).png().toFile(destPath);
      this.log(`Converted TGA: ${path.basename(srcPath)}`);
    } catch (error) {
      this.log(`Could not convert TGA: ${path.basename(srcPath)}`);
    }
  }

  async repackage() {
    const outputName = `${this.packName}.zip`;
    const outputPath = path.join(this.outputDir, outputName);

    const zip = new AdmZip();
    const files = await this.getAllFiles(this.tempDir);

    for (const file of files) {
      const relativePath = path.relative(this.tempDir, file);
      zip.addLocalFile(file, path.dirname(relativePath));
    }

    zip.writeZip(outputPath);
    return outputPath;
  }

  async getAllFiles(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await this.getAllFiles(fullPath)));
      } else {
        files.push(fullPath);
      }
    }

    return files;
  }
}

module.exports = BedrockToJavaConverter;
