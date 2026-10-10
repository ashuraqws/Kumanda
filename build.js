// Tek dosyalık dist/Kumanda.exe üretir (Node SEA): npm run build
// shortcut: .exe, derlemeyi yapan Node'un kopyasıdır ve imzasızdır (SmartScreen uyarır); gerçek dağıtımda imzalayın.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const esbuild = require('esbuild');
const { inject } = require('postject');

const files = ['helper.ps1', ...fs.readdirSync('public').map((f) => 'public/' + f)];
const assets = { 'files.json': 'dist/files.json' };
for (const f of files) assets[f] = f;

fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/files.json', JSON.stringify(files));
esbuild.buildSync({
  entryPoints: ['server.js'], bundle: true, platform: 'node', target: 'node24', outfile: 'dist/server.cjs',
  external: ['bufferutil', 'utf-8-validate'], // ws'in isteğe bağlı hızlandırıcıları; yoksa kendi koduna döner
  logLevel: 'warning',
});
fs.writeFileSync('dist/sea-config.json', JSON.stringify({ main: 'dist/server.cjs', output: 'dist/sea.blob', disableExperimentalSEAWarning: true, assets }));
execFileSync(process.execPath, ['--experimental-sea-config', 'dist/sea-config.json'], { stdio: 'inherit' });
fs.copyFileSync(process.execPath, 'dist/Kumanda.exe');
inject('dist/Kumanda.exe', 'NODE_SEA_BLOB', fs.readFileSync('dist/sea.blob'), { sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2' })
  .then(() => {
    // PE alt sistemi konsol(3) -> GUI(2): çift tıklayınca siyah pencere açılmaz.
    const b = fs.readFileSync('dist/Kumanda.exe');
    b.writeUInt16LE(2, b.readUInt32LE(0x3c) + 24 + 68);
    fs.writeFileSync('dist/Kumanda.exe', b);
    console.log('Hazır: dist/Kumanda.exe');
  });
