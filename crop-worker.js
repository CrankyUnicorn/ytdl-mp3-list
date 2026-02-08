const sharp = require('sharp');
const fs = require('fs/promises');
const path = require('path');

async function main() {
  try {
    const [inputPath, outputPath] = process.argv.slice(2);
    const imageBuffer = await fs.readFile(inputPath);

    const image = sharp(imageBuffer);
    const metadata = await image.metadata();

    const { width, height } = metadata;
    const size = Math.min(width, height);
    const left = Math.floor((width - size) / 2);
    const top = Math.floor((height - size) / 2);

    const croppedBuffer = await image
      .extract({ left, top, width: size, height: size })
      .jpeg()
      .toBuffer();

    await fs.writeFile(outputPath, croppedBuffer);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();