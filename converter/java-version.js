const fs = require("fs-extra");
const path = require("path");
const AdmZip = require("adm-zip");

/**
 * Java Pack Version Converter
 * Updates pack_format in pack.mcmeta for different Minecraft versions
 */
class JavaVersionConverter {
  constructor(
    inputPath,
    outputDir,
    targetVersion,
    logger = console.log,
    originalName = null,
  ) {
    this.inputPath = inputPath;
    this.outputDir = outputDir;
    this.targetVersion = targetVersion;
    this.log = logger;
    this.tempDir = path.join(outputDir, "temp_" + Date.now());
    this.outputPath = null;
    this.packName = originalName
      ? originalName.replace(/\.(zip|mcpack)$/i, "")
      : "converted_pack";
  }

  // Pack format versions mapping
  static PACK_FORMATS = {
    "1.6.1-1.8.9": 1,
    "1.9-1.10.2": 2,
    "1.11-1.12.2": 3,
    "1.13-1.14.4": 4,
    "1.15-1.16.1": 5,
    "1.16.2-1.16.5": 6,
    "1.17-1.17.1": 7,
    "1.18-1.18.2": 8,
    "1.19-1.19.2": 9,
    "1.19.3": 12,
    "1.19.4": 13,
    "1.20-1.20.1": 15,
    "1.20.2": 18,
    "1.20.3-1.20.4": 22,
    "1.20.5-1.20.6": 32,
    1.21: 34,
  };

  async convert() {
    try {
      this.log("Extracting resource pack...");
      await this.extract();

      this.log(`Updating pack_format to version ${this.targetVersion}...`);
      await this.updatePackFormat();

      this.log("Repackaging...");
      this.outputPath = await this.repackage();

      await fs.remove(this.tempDir);

      this.log("Version conversion complete!");
      return this.outputPath;
    } catch (error) {
      await fs.remove(this.tempDir).catch(() => {});
      throw error;
    }
  }

  async extract() {
    const zip = new AdmZip(this.inputPath);
    zip.extractAllTo(this.tempDir, true);

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

  async updatePackFormat() {
    const mcmetaPath = path.join(this.tempDir, "pack.mcmeta");

    let mcmeta = { pack: { pack_format: 1, description: "Resource Pack" } };

    if (await fs.pathExists(mcmetaPath)) {
      try {
        mcmeta = await fs.readJson(mcmetaPath);
      } catch (e) {
        this.log("Could not parse pack.mcmeta, creating new one");
      }
    }

    const oldFormat = mcmeta.pack?.pack_format || "unknown";
    const newFormat =
      JavaVersionConverter.PACK_FORMATS[this.targetVersion] || 15;

    mcmeta.pack = mcmeta.pack || {};
    mcmeta.pack.pack_format = newFormat;

    // Add supported_formats for newer versions
    if (newFormat >= 15) {
      mcmeta.pack.supported_formats = {
        min_inclusive: Math.max(1, newFormat - 3),
        max_inclusive: newFormat,
      };
    }

    this.log(`Pack format: ${oldFormat} -> ${newFormat}`);

    await fs.writeJson(mcmetaPath, mcmeta, { spaces: 2 });
  }

  async repackage() {
    const outputName = `${this.packName}_${this.targetVersion.replace(/[-.]/g, "_")}.zip`;
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

module.exports = JavaVersionConverter;
