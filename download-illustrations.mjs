import fs from 'fs';
import path from 'path';
import https from 'https';

const illustrations = [
  { file: 'operator_ghost.jpg', text: 'OPERATOR GHOST' },
  { file: 'wallet_vault.jpg', text: 'ZOYD VAULT' },
  { file: 'profile_banner.jpg', text: 'CODM PROFILE' },
  { file: 'ranked_arena.jpg', text: 'RANKED ARENA' },
  { file: 'tournament_cup.jpg', text: 'ZOYD CHAMPIONSHIP' },
];

const dir = path.join(process.cwd(), 'public', 'assets', 'illustrations');

if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

console.log(`Downloading ${illustrations.length} illustrations...`);

const downloadIllustration = ({ file, text }) => {
  return new Promise((resolve) => {
    const filePath = path.join(dir, file);
    // 16:9 ratio, dark theme, yellow text for ZOYD style
    const url = `https://placehold.co/1200x675/000000/FFD700/jpeg?text=${encodeURIComponent(text)}&font=montserrat`;

    https.get(url, (res) => {
      if (res.statusCode === 200) {
        const fileStream = fs.createWriteStream(filePath);
        res.pipe(fileStream);
        fileStream.on('finish', () => {
          fileStream.close();
          console.log(`✅ Downloaded: ${file}`);
          resolve();
        });
      } else {
        console.error(`❌ Failed to download ${file}: ${res.statusCode}`);
        resolve();
      }
    }).on('error', (err) => {
      console.error(`❌ Error on ${file}: ${err.message}`);
      resolve();
    });
  });
};

async function run() {
  for (const item of illustrations) {
    await downloadIllustration(item);
  }
  console.log('🎉 All illustrations downloaded successfully!');
}

run();
