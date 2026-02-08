const fs = require("fs/promises");
const path = require("path");
const sharp = require("sharp");
const mm = require("music-metadata");   // CommonJS works fine here
const NodeID3 = require("node-id3");

// Get folder path from command-line arguments
const TARGET_DIR = process.argv[2];

if (!TARGET_DIR) {
  console.error("Usage: node crop-mp3-cover-art.js /path/to/mp3/folder");
  process.exit(1);
}

async function cropImageToCenteredSquare(imageBuffer) {
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();

  const { width, height } = metadata;

  if (!width || !height) {
    throw new Error("Unable to determine image dimensions");
  }

  // Already square → no change
  if (width === height) return null;

  const size = Math.min(width, height);
  const left = Math.floor((width - size) / 2);
  const top = Math.floor((height - size) / 2);

  return image
    .extract({ left, top, width: size, height: size })
    .jpeg({ quality: 95 })
    .toBuffer();
}

async function processMp3(filePath) {
  console.log(`Processing: ${path.basename(filePath)}`);

  const metadata = await mm.parseFile(filePath);
  const pictures = metadata.common.picture;

  if (!pictures || pictures.length === 0) {
    console.log("  No cover art found — skipping");
    return;
  }

  const cover = pictures[0];
  const croppedBuffer = await cropImageToCenteredSquare(cover.data);

  if (!croppedBuffer) {
    console.log("  Cover already square — skipping");
    return;
  }

  const tags = NodeID3.read(filePath);

  tags.image = {
    mime: "image/jpeg",
    type: { id: 3, name: "front cover" },
    description: "Cover",
    imageBuffer: croppedBuffer,
  };

  NodeID3.update(tags, filePath);

  console.log("  Cover cropped and updated");
}

async function main() {
  const files = await fs.readdir(TARGET_DIR);

  for (const file of files) {
    if (file.toLowerCase().endsWith(".mp3")) {
      try {
        await processMp3(path.join(TARGET_DIR, file));
      } catch (err) {
        console.error(`  Error processing ${file}:`, err.message);
      }
    }
  }

  console.log("Done.");
}

main().catch(console.error);
