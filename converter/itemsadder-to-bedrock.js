const fs = require("fs-extra");
const path = require("path");
const AdmZip = require("adm-zip");
const sharp = require("sharp");

/**
 * ItemsAdder to Bedrock Addon Converter
 * Converts ItemsAdder packs (with custom items) to Bedrock Resource Pack + Behavior Pack
 */
class ItemsAdderConverter {
  constructor(inputPath, outputDir, logger = console.log, originalName = null) {
    this.inputPath = inputPath;
    this.outputDir = outputDir;
    this.log = logger;
    this.tempDir = path.join(outputDir, "temp_ia_" + Date.now());
    this.rpDir = null; // Resource Pack directory
    this.bpDir = null; // Behavior Pack directory
    this.items = []; // Parsed items from configs
    this.namespace = "custom";
    this.packName = originalName
      ? originalName.replace(/\.(zip|mcpack)$/i, "")
      : null; // Will use namespace if not provided
  }

  async convert() {
    try {
      this.log("Extracting ItemsAdder pack...");
      await this.extract();

      this.log("Parsing item configurations...");
      await this.parseConfigs();

      this.log("Creating Bedrock Resource Pack...");
      await this.createResourcePack();

      this.log("Creating Bedrock Behavior Pack...");
      await this.createBehaviorPack();

      this.log("Converting models and textures...");
      await this.convertAssets();

      this.log("Packaging addon...");
      const outputPath = await this.packageAddon();

      await fs.remove(this.tempDir);

      this.log("Conversion complete!");
      return outputPath;
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

  async parseConfigs() {
    const configsDir = path.join(this.tempDir, "configs");

    if (!(await fs.pathExists(configsDir))) {
      // Maybe it's a plain resource pack, look for items.yml in root
      const rootItems = path.join(this.tempDir, "items.yml");
      if (await fs.pathExists(rootItems)) {
        await this.parseItemsYml(rootItems);
      }
      return;
    }

    // Find all yml files in configs
    const files = await this.findFiles(configsDir, ".yml");

    for (const file of files) {
      if (file.endsWith("items.yml")) {
        await this.parseItemsYml(file);
      }
    }

    this.log(`Found ${this.items.length} custom item(s)`);
  }

  async parseItemsYml(filePath) {
    try {
      const content = await fs.readFile(filePath, "utf-8");

      // Simple YAML parser for ItemsAdder format
      const lines = content.split("\n");
      let currentNamespace = "custom";
      let currentItem = null;
      let indentLevel = 0;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        const indent = line.search(/\S/);

        // Check for namespace
        if (trimmed.startsWith("namespace:")) {
          currentNamespace = trimmed.split(":")[1].trim();
          this.namespace = currentNamespace;
          continue;
        }

        // Check for items section
        if (trimmed === "items:") {
          continue;
        }

        // Parse item definition
        if (indent === 2 && trimmed.endsWith(":") && !trimmed.includes(" ")) {
          // New item
          if (currentItem) {
            this.items.push(currentItem);
          }
          currentItem = {
            id: trimmed.slice(0, -1),
            namespace: currentNamespace,
            displayName: trimmed.slice(0, -1),
            material: "DIAMOND",
            modelPath: null,
            texture: null,
          };
          continue;
        }

        if (currentItem && indent > 2) {
          // Item property
          if (trimmed.startsWith("display_name:")) {
            let displayName = trimmed
              .split(":")
              .slice(1)
              .join(":")
              .trim()
              .replace(/["']/g, "");
            // Remove Minecraft color codes (&a, &f, §a, §f, etc.)
            displayName = displayName.replace(/[&§][0-9a-fk-or]/gi, "");
            currentItem.displayName = displayName.trim();
          } else if (trimmed.startsWith("material:")) {
            currentItem.material = trimmed.split(":")[1].trim();
          } else if (trimmed.startsWith("model_path:")) {
            currentItem.modelPath = trimmed.split(":")[1].trim();
          }
        }
      }

      if (currentItem) {
        this.items.push(currentItem);
      }
    } catch (error) {
      this.log(`Could not parse ${path.basename(filePath)}: ${error.message}`);
    }
  }

  async createResourcePack() {
    this.rpDir = path.join(this.tempDir, "output_rp");
    await fs.ensureDir(this.rpDir);

    const headerUuid = this.generateUUID();
    const moduleUuid = this.generateUUID();

    const manifest = {
      format_version: 2,
      header: {
        name: this.packName
          ? `${this.packName} RP`
          : `${this.namespace} Resource Pack`,
        description: "Converted from ItemsAdder",
        uuid: headerUuid,
        version: [1, 0, 0],
        min_engine_version: [1, 19, 0],
      },
      modules: [
        {
          type: "resources",
          uuid: moduleUuid,
          version: [1, 0, 0],
        },
      ],
    };

    await fs.writeJson(path.join(this.rpDir, "manifest.json"), manifest, {
      spaces: 2,
    });
    await this.createDefaultPackIcon(path.join(this.rpDir, "pack_icon.png"));
  }

  async createBehaviorPack() {
    this.bpDir = path.join(this.tempDir, "output_bp");
    await fs.ensureDir(this.bpDir);

    const headerUuid = this.generateUUID();
    const moduleUuid = this.generateUUID();
    const rpUuid = JSON.parse(
      await fs.readFile(path.join(this.rpDir, "manifest.json"), "utf-8"),
    ).header.uuid;

    const manifest = {
      format_version: 2,
      header: {
        name: this.packName
          ? `${this.packName} BP`
          : `${this.namespace} Behavior Pack`,
        description: "Converted from ItemsAdder",
        uuid: headerUuid,
        version: [1, 0, 0],
        min_engine_version: [1, 19, 0],
      },
      modules: [
        {
          type: "data",
          uuid: moduleUuid,
          version: [1, 0, 0],
        },
      ],
      dependencies: [
        {
          uuid: rpUuid,
          version: [1, 0, 0],
        },
      ],
    };

    await fs.writeJson(path.join(this.bpDir, "manifest.json"), manifest, {
      spaces: 2,
    });
    await this.createDefaultPackIcon(path.join(this.bpDir, "pack_icon.png"));
  }

  async convertAssets() {
    // Find resourcepack folder
    let rpSource = path.join(this.tempDir, "resourcepack");
    if (!(await fs.pathExists(rpSource))) {
      rpSource = path.join(this.tempDir, "assets");
    }

    if (!(await fs.pathExists(rpSource))) {
      this.log("No resourcepack folder found");
      return;
    }

    // Process each item
    for (const item of this.items) {
      await this.convertItem(item, rpSource);
    }
  }

  async convertItem(item, rpSource) {
    try {
      // Find model file
      const modelPath = item.modelPath || item.id;
      const possibleModelPaths = [
        path.join(
          rpSource,
          "assets",
          item.namespace,
          "models",
          `${modelPath}.json`,
        ),
        path.join(rpSource, item.namespace, "models", `${modelPath}.json`),
        path.join(rpSource, "models", `${modelPath}.json`),
      ];

      let modelFile = null;
      for (const p of possibleModelPaths) {
        if (await fs.pathExists(p)) {
          modelFile = p;
          break;
        }
      }

      if (!modelFile) {
        this.log(`Model not found for item: ${item.id}`);
        return;
      }

      // Convert Java model to Bedrock geometry
      const javaModel = await fs.readJson(modelFile);
      const bedrockGeo = this.convertModelToGeometry(javaModel, item);

      // Save geometry
      const geoDir = path.join(this.rpDir, "models", "entity");
      await fs.ensureDir(geoDir);
      await fs.writeJson(path.join(geoDir, `${item.id}.geo.json`), bedrockGeo, {
        spaces: 2,
      });

      // Find and copy texture
      await this.copyItemTexture(item, rpSource, javaModel);

      // Create attachable (for Resource Pack)
      await this.createAttachable(item);

      // Create item definition (for Behavior Pack)
      await this.createItemDefinition(item);

      this.log(`Converted item: ${item.id}`);
    } catch (error) {
      this.log(`Failed to convert item ${item.id}: ${error.message}`);
    }
  }

  convertModelToGeometry(javaModel, item) {
    // Convert Java JSON model to Bedrock geometry format
    const bones = [];
    const textureWidth = javaModel.texture_size?.[0] || 16;
    const textureHeight = javaModel.texture_size?.[1] || 16;

    // Convert elements to Bedrock cubes
    if (javaModel.elements) {
      const cubes = javaModel.elements.map((element, index) => {
        const from = element.from || [0, 0, 0];
        const to = element.to || [16, 16, 16];

        // Calculate size and origin
        const size = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];

        // Bedrock uses different coordinate system
        const origin = [
          from[0] - 8, // Center X
          from[1], // Y from bottom
          from[2] - 8, // Center Z
        ];

        const cube = {
          origin: origin,
          size: size,
          uv: this.convertUV(element.faces, textureWidth, textureHeight),
        };

        // Handle rotation
        if (element.rotation) {
          cube.pivot = element.rotation.origin
            ? [
                element.rotation.origin[0] - 8,
                element.rotation.origin[1],
                element.rotation.origin[2] - 8,
              ]
            : origin;
          cube.rotation = [0, 0, 0];

          const axis = element.rotation.axis;
          const angle = element.rotation.angle || 0;
          if (axis === "x") cube.rotation[0] = angle;
          else if (axis === "y") cube.rotation[1] = angle;
          else if (axis === "z") cube.rotation[2] = angle;
        }

        return cube;
      });

      bones.push({
        name: "root",
        pivot: [0, 0, 0],
        cubes: cubes,
      });
    }

    return {
      format_version: "1.16.0",
      "minecraft:geometry": [
        {
          description: {
            identifier: `geometry.${item.namespace}.${item.id}`,
            texture_width: textureWidth,
            texture_height: textureHeight,
            visible_bounds_width: 4,
            visible_bounds_height: 4,
            visible_bounds_offset: [0, 1, 0],
          },
          bones: bones,
        },
      ],
    };
  }

  convertUV(faces, texWidth, texHeight) {
    // Simple UV conversion - Bedrock uses per-face UV
    if (!faces)
      return { north: { uv: [0, 0], uv_size: [texWidth, texHeight] } };

    const result = {};
    const faceMap = {
      north: "north",
      south: "south",
      east: "east",
      west: "west",
      up: "up",
      down: "down",
    };

    for (const [face, data] of Object.entries(faces)) {
      if (data && data.uv) {
        const uv = data.uv;
        result[faceMap[face] || face] = {
          uv: [uv[0], uv[1]],
          uv_size: [uv[2] - uv[0], uv[3] - uv[1]],
        };
      }
    }

    return Object.keys(result).length > 0 ? result : undefined;
  }

  async copyItemTexture(item, rpSource, javaModel) {
    // Find texture from model
    let texturePath = null;

    if (javaModel.textures) {
      const textureRef = Object.values(javaModel.textures)[0];
      if (textureRef) {
        // Parse texture path (namespace:path format)
        const parts = textureRef.split(":");
        const namespace = parts.length > 1 ? parts[0] : item.namespace;
        const texPath = parts.length > 1 ? parts[1] : parts[0];

        const possiblePaths = [
          path.join(
            rpSource,
            "assets",
            namespace,
            "textures",
            `${texPath}.png`,
          ),
          path.join(rpSource, namespace, "textures", `${texPath}.png`),
          path.join(rpSource, "textures", `${texPath}.png`),
        ];

        for (const p of possiblePaths) {
          if (await fs.pathExists(p)) {
            texturePath = p;
            break;
          }
        }
      }
    }

    if (texturePath) {
      // Copy texture for 3D model
      const modelTextureDir = path.join(
        this.rpDir,
        "textures",
        "entity",
        item.namespace,
      );
      await fs.ensureDir(modelTextureDir);
      await fs.copy(texturePath, path.join(modelTextureDir, `${item.id}.png`));

      // Create 2D icon for inventory (crop to square if needed)
      const iconDir = path.join(this.rpDir, "textures", "items");
      await fs.ensureDir(iconDir);

      try {
        const metadata = await sharp(texturePath).metadata();
        const iconSize = Math.min(metadata.width, metadata.height, 64);

        // Extract a square icon from the texture
        await sharp(texturePath)
          .extract({ left: 0, top: 0, width: iconSize, height: iconSize })
          .resize(32, 32) // Standard icon size
          .png()
          .toFile(path.join(iconDir, `${item.namespace}_${item.id}.png`));

        this.log(`Created icon for: ${item.id}`);
      } catch (error) {
        // Fallback: just copy the texture as icon
        await fs.copy(
          texturePath,
          path.join(iconDir, `${item.namespace}_${item.id}.png`),
        );
      }
    }
  }

  async createAttachable(item) {
    const attachablesDir = path.join(this.rpDir, "attachables");
    await fs.ensureDir(attachablesDir);

    const attachable = {
      format_version: "1.10.0",
      "minecraft:attachable": {
        description: {
          identifier: `${item.namespace}:${item.id}`,
          materials: {
            default: "entity_alphatest",
            enchanted: "entity_alphatest_glint",
          },
          textures: {
            // Use the entity texture for 3D model
            default: `textures/entity/${item.namespace}/${item.id}`,
            enchanted: "textures/misc/enchanted_item_glint",
          },
          geometry: {
            default: `geometry.${item.namespace}.${item.id}`,
          },
          scripts: {
            pre_animation: ["v.is_first_person = c.is_first_person;"],
          },
          render_controllers: ["controller.render.item_default"],
        },
      },
    };

    await fs.writeJson(
      path.join(attachablesDir, `${item.id}.attachable.json`),
      attachable,
      { spaces: 2 },
    );
  }

  async createItemDefinition(item) {
    const itemsDir = path.join(this.bpDir, "items");
    await fs.ensureDir(itemsDir);

    // Map Java material to Bedrock
    const materialMap = {
      DIAMOND_SWORD: "minecraft:sword",
      IRON_SWORD: "minecraft:sword",
      DIAMOND: "minecraft:diamond",
      PAPER: "minecraft:paper",
      STICK: "minecraft:stick",
    };

    const itemDef = {
      format_version: "1.20.0",
      "minecraft:item": {
        description: {
          identifier: `${item.namespace}:${item.id}`,
          category: "equipment",
        },
        components: {
          "minecraft:display_name": {
            value: item.displayName,
          },
          "minecraft:icon": {
            texture: `${item.namespace}_${item.id}`,
          },
          "minecraft:max_stack_size": 1,
          "minecraft:hand_equipped": true,
        },
      },
    };

    await fs.writeJson(path.join(itemsDir, `${item.id}.item.json`), itemDef, {
      spaces: 2,
    });

    // Create item texture definition
    await this.addItemTextureDefinition(item);
  }

  async addItemTextureDefinition(item) {
    const texturesPath = path.join(this.rpDir, "textures", "item_texture.json");

    let itemTextures = { resource_pack_name: "pack", texture_data: {} };
    if (await fs.pathExists(texturesPath)) {
      itemTextures = await fs.readJson(texturesPath);
    }

    // Path must match where the icon is saved (textures/items/namespace_itemid.png)
    itemTextures.texture_data[`${item.namespace}_${item.id}`] = {
      textures: `textures/items/${item.namespace}_${item.id}`,
    };

    await fs.writeJson(texturesPath, itemTextures, { spaces: 2 });
  }

  async packageAddon() {
    const addonName = this.packName || this.namespace;
    const outputName = `${addonName}.mcaddon`;
    const outputPath = path.join(this.outputDir, outputName);

    // Create .mcpack for RP
    const rpZip = new AdmZip();
    const rpFiles = await this.getAllFiles(this.rpDir);
    for (const file of rpFiles) {
      const relativePath = path.relative(this.rpDir, file);
      rpZip.addLocalFile(file, path.dirname(relativePath));
    }
    const rpPackPath = path.join(this.tempDir, `${this.namespace}_rp.mcpack`);
    rpZip.writeZip(rpPackPath);

    // Create .mcpack for BP
    const bpZip = new AdmZip();
    const bpFiles = await this.getAllFiles(this.bpDir);
    for (const file of bpFiles) {
      const relativePath = path.relative(this.bpDir, file);
      bpZip.addLocalFile(file, path.dirname(relativePath));
    }
    const bpPackPath = path.join(this.tempDir, `${this.namespace}_bp.mcpack`);
    bpZip.writeZip(bpPackPath);

    // Create .mcaddon containing both
    const addonZip = new AdmZip();
    addonZip.addLocalFile(rpPackPath);
    addonZip.addLocalFile(bpPackPath);
    addonZip.writeZip(outputPath);

    return outputPath;
  }

  async findFiles(dir, extension) {
    const results = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await this.findFiles(fullPath, extension)));
      } else if (entry.name.endsWith(extension)) {
        results.push(fullPath);
      }
    }

    return results;
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
      const size = 64;
      const channels = 4;
      const pixels = Buffer.alloc(size * size * channels);

      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const idx = (y * size + x) * channels;
          pixels[idx] = 99 + Math.floor((x / size) * 50);
          pixels[idx + 1] = 102 + Math.floor((y / size) * 30);
          pixels[idx + 2] = 241;
          pixels[idx + 3] = 255;
        }
      }

      await sharp(pixels, {
        raw: { width: size, height: size, channels: channels },
      })
        .png()
        .toFile(iconPath);
    } catch (error) {
      // Icon is optional
    }
  }
}

module.exports = ItemsAdderConverter;
