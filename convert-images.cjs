const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const basePath = 'E:/web_app/projrt/Z.O.Y.D/Multiplayer Gaming Platform/public/assets/codm/image';
const outDir = 'E:/web_app/projrt/Z.O.Y.D/Multiplayer Gaming Platform/public/assets/images/codm';

// Create output directory
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const files = fs.readdirSync(basePath).filter(f => f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.png'));

(async () => {
  for (const file of files) {
    const input = path.join(basePath, file);
    const outputName = file.replace(/[^a-z0-9.-]/gi, '_').toLowerCase();
    const outputPath = path.join(outDir, outputName);
    
    try {
      const metadata = await sharp(input).metadata();
      const sizeKB = Math.round(fs.statSync(input).size / 1024);
      
      let pipeline = sharp(input);
      
      // Resize if larger than 1920px width
      if (metadata.width > 1920) {
        pipeline = pipeline.resize({ width: 1920, withoutEnlargement: true });
      }
      
      // Convert to JPEG with quality 80
      await pipeline.jpeg({ quality: 80, mozjpeg: true }).toFile(outputPath);
      
      const newSizeKB = Math.round(fs.statSync(outputPath).size / 1024);
      const reduction = Math.round((1 - newSizeKB / sizeKB) * 100);
      
      console.log(`${file}: ${sizeKB}KB -> ${newSizeKB}KB (-${reduction}%) [${metadata.width}x${metadata.height}]`);
    } catch (err) {
      console.error(`ERREUR: ${file}: ${err.message}`);
    }
  }
  
  // List output files
  console.log('\n=== Fichiers converts ===');
  const outputs = fs.readdirSync(outDir);
  outputs.forEach(f => {
    const size = Math.round(fs.statSync(path.join(outDir, f)).size / 1024);
    console.log(`  ${f}: ${size}KB`);
  });
  console.log(`Total: ${outputs.length} fichiers`);
})();
