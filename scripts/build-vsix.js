const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const readmePath = path.join(__dirname, '..', 'README.md');
const backupPath = path.join(__dirname, '..', 'README.md.bak');
const pkgPath = path.join(__dirname, '..', 'package.json');

// 1. Read the original README
if (!fs.existsSync(readmePath)) {
    console.error('README.md not found!');
    process.exit(1);
}

const originalReadme = fs.readFileSync(readmePath, 'utf8');
const originalPkg = fs.readFileSync(pkgPath, 'utf8');

// 2. Backup the README
fs.writeFileSync(backupPath, originalReadme);

try {
    console.log('Temporarily stripping SVG badges from README.md for VSCE packaging...');

    // 3. Strip lines containing SVG badges (specifically the pipeline and release ones)
    // VSCE will reject ANY image ending in .svg that isn't from a trusted domain.
    const strippedReadme = originalReadme.split('\n').filter(line => {
        return !line.includes('.svg') && !line.includes('pipeline status') && !line.includes('Latest Release');
    }).join('\n');

    fs.writeFileSync(readmePath, strippedReadme);

    // 3b. VSCE requires an unscoped extension name and rejects manifests that
    // contain both .vscodeignore and npm's "files" allowlist. These changes are
    // packaging-only; the original scoped npm manifest is restored in finally.
    const pkgJson = JSON.parse(originalPkg);
    const pkgCopy = Object.assign({}, pkgJson, { name: 'opengrok-mcp-server' });
    delete pkgCopy.files;
    fs.writeFileSync(pkgPath, JSON.stringify(pkgCopy, null, 2) + '\n');

    const repositoryUrl = typeof pkgJson.repository === 'string'
        ? pkgJson.repository
        : pkgJson.repository.url;
    const repositoryBase = repositoryUrl.replace(/^git\+/, '').replace(/\.git$/, '');
    const rawContentBase = repositoryBase.replace('https://github.com/', 'https://raw.githubusercontent.com/') + '/main';

    // 4. Run vsce package
    console.log('Running vsce package...');
    execFileSync('npx', [
        '@vscode/vsce',
        'package',
        '--baseContentUrl', rawContentBase,
        '--baseImagesUrl', rawContentBase,
    ], { stdio: 'inherit' });

    console.log('VSIX packaging completed successfully.');

} catch (error) {
    console.error('VSIX packaging failed:', error.message);
    process.exitCode = 1;
} finally {
    // 5. Restore README and package.json regardless of success or failure
    console.log('Restoring original README.md with SVG badges...');
    fs.writeFileSync(readmePath, originalReadme);
    fs.writeFileSync(pkgPath, originalPkg);

    if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
    }
}
