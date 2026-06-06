import fs from 'fs';
import path from 'path';
import https from 'https';

const maps = [
  'Nuketown', 'Crash', 'Crossfire', 'Firing Range', 'Standoff',
  'Terminal', 'Highrise', 'Rust', 'Shipment', 'Shoot House',
  'Summit', 'Hijacked', 'Raid', 'Slums', 'Hackney Yard',
  'Dome', 'Scrapyard', 'Oasis', 'Coastal', 'Tunisia',
  'Takeoff', 'Meltdown', 'Standby'
];

const dir = path.join(process.cwd(), 'public', 'assets', 'maps');

if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

console.log(`Downloading ${maps.length} map illustrations...`);

const downloadMap = (mapName) => {
  return new Promise((resolve) => {
    const fileName = `${mapName.toLowerCase().replace(/\s+/g, '_')}.jpg`;
    const filePath = path.join(dir, fileName);
    
    // Using a placeholder service with ZOYD colors (Black background, Yellow text)
    // to ensure we have an image for EVERY map instantly without hotlinking issues.
    const url = `https://placehold.co/800x450/000000/FFD700/jpeg?text=${encodeURIComponent(mapName)}&font=montserrat`;

    https.get(url, (res) => {
      if (res.statusCode === 200) {
        const fileStream = fs.createWriteStream(filePath);
        res.pipe(fileStream);
        fileStream.on('finish', () => {
          fileStream.close();
          console.log(`✅ Downloaded: ${fileName}`);
          resolve();
        });
      } else {
        console.error(`❌ Failed to download ${fileName}: ${res.statusCode}`);
        resolve();
      }
    }).on('error', (err) => {
      console.error(`❌ Error on ${fileName}: ${err.message}`);
      resolve();
    });
  });
};

async function run() {
  for (const map of maps) {
    await downloadMap(map);
  }
  console.log('🎉 All maps downloaded successfully!');
}

run();
