const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const svgPath = path.join(__dirname, '..', 'public', 'og.svg');
const outPath = path.join(__dirname, '..', 'public', 'og.png');

const svg = fs.readFileSync(svgPath);
sharp(svg)
  .resize(1200, 630)
  .png()
  .toFile(outPath)
  .then(() => {
    const stat = fs.statSync(outPath);
    console.log(`OG image written: ${outPath} (${stat.size} bytes)`);
  })
  .catch((err) => {
    console.error('Failed to generate OG image:', err.message);
    process.exit(1);
  });
