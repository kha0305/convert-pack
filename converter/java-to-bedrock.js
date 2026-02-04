const fs = require("fs-extra");
const path = require("path");
const AdmZip = require("adm-zip");
const sharp = require("sharp");

/**
 * Java to Bedrock Resource Pack Converter
 */
class JavaToBedrockConverter {
  constructor(inputPath, outputDir, logger = console.log, originalName = null) {
    this.inputPath = inputPath;
    this.outputDir = outputDir;
    this.log = logger;
    this.tempDir = path.join(outputDir, "temp_" + Date.now());
    this.outputPath = null;
    this.flipbookTextures = []; // Store animation data for Bedrock
    // Extract pack name from original filename
    this.packName = originalName
      ? originalName.replace(/\.(zip|mcpack)$/i, "")
      : "converted_pack";
  }

  async convert() {
    try {
      // Step 1: Extract
      this.log("Extracting Java resource pack...");
      await this.extract();

      // Step 2: Convert pack.mcmeta -> manifest.json
      this.log("Converting pack.mcmeta to manifest.json...");
      await this.convertManifest();

      // Step 3: Convert textures
      this.log("Converting textures...");
      await this.convertTextures();

      // Step 4: Convert animations
      this.log("Converting animations...");
      await this.writeFlipbookTextures();

      // Step 5: Convert models (if any)
      this.log("Processing models...");
      await this.convertModels();

      // Step 6: Repackage as .mcpack
      this.log("Repackaging as Bedrock pack...");
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

    // Find the root folder (some packs have extra nesting)
    const entries = await fs.readdir(this.tempDir);
    if (entries.length === 1) {
      const singleEntry = path.join(this.tempDir, entries[0]);
      const stat = await fs.stat(singleEntry);
      if (stat.isDirectory()) {
        // Move contents up
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

  async convertManifest() {
    const mcmetaPath = path.join(this.tempDir, "pack.mcmeta");
    let packInfo = { pack: { description: "Converted Pack", pack_format: 1 } };

    if (await fs.pathExists(mcmetaPath)) {
      try {
        const mcmeta = await fs.readJson(mcmetaPath);
        packInfo = mcmeta;
      } catch (e) {
        this.log("Could not parse pack.mcmeta, using defaults");
      }
    }

    // Get pack name from description or use default
    let packName = this.packName || "Converted Resource Pack";
    let packDesc = packInfo.pack?.description || "Converted from Java Edition";

    // If description is an object (colored text), extract plain text
    if (typeof packDesc === "object") {
      packDesc = packDesc.text || "Converted from Java Edition";
    }

    // Bedrock manifest.json format - MUST have unique UUIDs
    const headerUuid = this.generateUUID();
    const moduleUuid = this.generateUUID();

    const manifest = {
      format_version: 2,
      header: {
        name: packName,
        description: String(packDesc).substring(0, 255), // Bedrock has description limit
        uuid: headerUuid,
        version: [1, 0, 0],
        min_engine_version: [1, 19, 0],
      },
      modules: [
        {
          type: "resources",
          uuid: moduleUuid,
          version: [1, 0, 0],
          description: "Resource Pack",
        },
      ],
    };

    await fs.writeJson(path.join(this.tempDir, "manifest.json"), manifest, {
      spaces: 2,
    });

    // Copy pack.png as pack_icon.png if exists
    const packPngPath = path.join(this.tempDir, "pack.png");
    const packIconPath = path.join(this.tempDir, "pack_icon.png");
    if (await fs.pathExists(packPngPath)) {
      await fs.copy(packPngPath, packIconPath);
      this.log("Copied pack icon");
    } else {
      // Create a simple pack icon if none exists
      await this.createDefaultPackIcon(packIconPath);
    }

    await fs.remove(mcmetaPath).catch(() => {});
  }

  async convertTextures() {
    // Java uses assets/minecraft/textures (and other namespaces)
    // Bedrock uses textures/
    const assetsDir = path.join(this.tempDir, "assets");
    const bedrockTextures = path.join(this.tempDir, "textures");

    if (!(await fs.pathExists(assetsDir))) {
      this.log("No assets folder found, skipping texture conversion");
      return;
    }

    // Process all namespaces (minecraft, custom mods, etc.)
    try {
      const namespaces = await fs.readdir(assetsDir, { withFileTypes: true });

      for (const ns of namespaces) {
        if (!ns.isDirectory()) continue;

        const javaTextures = path.join(assetsDir, ns.name, "textures");

        if (await fs.pathExists(javaTextures)) {
          this.log(`Processing textures from namespace: ${ns.name}`);
          await this.processTextureFolder(javaTextures, bedrockTextures, "");
        }
      }
    } catch (error) {
      this.log(`Warning: Could not process textures - ${error.message}`);
    }

    // Remove Java assets folder
    await fs.remove(assetsDir).catch(() => {});
  }

  async processTextureFolder(srcDir, destDir, relativePath) {
    await fs.ensureDir(destDir);
    const entries = await fs.readdir(srcDir, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry.name);
      let destPath = path.join(destDir, entry.name);

      if (entry.isDirectory()) {
        // Map folder names (Java -> Bedrock)
        const folderMapping = {
          block: "blocks",
          item: "items",
          entity: "entity",
          gui: "ui",
          mob_effect: "ui",
          particle: "particle",
        };
        const mappedName = folderMapping[entry.name] || entry.name;
        destPath = path.join(destDir, mappedName);
        const newRelativePath = relativePath
          ? `${relativePath}/${mappedName}`
          : mappedName;

        try {
          await this.processTextureFolder(srcPath, destPath, newRelativePath);
        } catch (error) {
          // Skip folders that cause errors
        }
      } else if (entry.name.endsWith(".png")) {
        await this.convertTexture(srcPath, destPath, relativePath);
      }
    }
  }

  async convertTexture(srcPath, destPath, relativePath) {
    try {
      await fs.ensureDir(path.dirname(destPath));
      await fs.copy(srcPath, destPath);

      // Check for animation mcmeta
      const mcmetaPath = srcPath + ".mcmeta";
      if (await fs.pathExists(mcmetaPath)) {
        await this.convertAnimation(
          srcPath,
          destPath,
          mcmetaPath,
          relativePath,
        );
      }
    } catch (error) {
      this.log(`Could not convert: ${path.basename(srcPath)}`);
    }
  }

  async convertAnimation(srcPath, destPath, mcmetaPath, relativePath) {
    try {
      const mcmeta = await fs.readJson(mcmetaPath);
      const animation = mcmeta.animation;

      if (!animation) return;

      // Get texture dimensions to calculate frames
      const metadata = await sharp(srcPath).metadata();
      const frameWidth = metadata.width;
      const frameHeight = animation.height || metadata.width; // Default square frames
      const frameCount = Math.floor(metadata.height / frameHeight);

      // Map folder for Bedrock path
      const folderMapping = {
        block: "blocks",
        item: "items",
      };

      // Build Bedrock texture path
      let bedrockTexturePath = relativePath;
      for (const [java, bedrock] of Object.entries(folderMapping)) {
        bedrockTexturePath = bedrockTexturePath.replace(java, bedrock);
      }
      const textureName = path.basename(srcPath, ".png");
      const fullTexturePath = bedrockTexturePath
        ? `textures/${bedrockTexturePath}/${textureName}`
        : `textures/${textureName}`;

      // Build flipbook entry for Bedrock
      const flipbookEntry = {
        flipbook_texture: fullTexturePath,
        atlas_tile: textureName,
        ticks_per_frame: animation.frametime || 1,
      };

      // Handle custom frame order if specified
      if (animation.frames && Array.isArray(animation.frames)) {
        flipbookEntry.frames = animation.frames.map((frame) => {
          if (typeof frame === "number") {
            return frame;
          } else if (typeof frame === "object" && frame.index !== undefined) {
            return frame.index;
          }
          return 0;
        });
      }

      // Handle interpolation
      if (animation.interpolate) {
        flipbookEntry.blend_frames = true;
      }

      this.flipbookTextures.push(flipbookEntry);
      this.log(`Converted animation: ${textureName} (${frameCount} frames)`);
    } catch (error) {
      this.log(`Could not convert animation: ${path.basename(srcPath)}`);
    }
  }

  async writeFlipbookTextures() {
    if (this.flipbookTextures.length === 0) {
      this.log("No animations to convert");
      return;
    }

    const flipbookPath = path.join(
      this.tempDir,
      "textures",
      "flipbook_textures.json",
    );
    await fs.ensureDir(path.dirname(flipbookPath));
    await fs.writeJson(flipbookPath, this.flipbookTextures, { spaces: 2 });
    this.log(
      `Wrote ${this.flipbookTextures.length} animation(s) to flipbook_textures.json`,
    );
  }

  async convertModels() {
    // Java uses assets/minecraft/models
    // Bedrock uses models/
    const javaModels = path.join(this.tempDir, "assets", "minecraft", "models");
    if (!(await fs.pathExists(javaModels))) return;

    // Models require extensive conversion - this is a simplified version
    // Full conversion would need JSON transformation for Bedrock format
    this.log("Model conversion is limited - some models may not work");
  }

  async repackage() {
    const outputName = `${this.packName}.mcpack`;
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

  generateUUID() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  async createDefaultPackIcon(iconPath) {
    try {
      // Create a simple 64x64 purple gradient icon
      const size = 64;
      const channels = 4;
      const pixels = Buffer.alloc(size * size * channels);

      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const idx = (y * size + x) * channels;
          // Purple gradient
          pixels[idx] = 99 + Math.floor((x / size) * 50); // R
          pixels[idx + 1] = 102 + Math.floor((y / size) * 30); // G
          pixels[idx + 2] = 241; // B
          pixels[idx + 3] = 255; // A
        }
      }

      await sharp(pixels, {
        raw: { width: size, height: size, channels: channels },
      })
        .png()
        .toFile(iconPath);

      this.log("Created default pack icon");
    } catch (error) {
      // Icon is optional, just log
      this.log("Could not create pack icon (optional)");
    }
  }
}

module.exports = JavaToBedrockConverter;
