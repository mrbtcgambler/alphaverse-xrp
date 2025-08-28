import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import JavaScriptObfuscator from 'javascript-obfuscator';
import os from 'os';

// --- Configuration ---
// This section is now at the top, making it easy to update for new versions.

const appVersion = '2.0.1';
const homeDir = os.homedir();

// Define the files to be processed and where their checksums should be stored.
const targets = {
    client: {
        files: [
            path.join(homeDir, 'alphaverse-xrp', 'client', 'index.js'),
            path.join(homeDir, 'alphaverse-xrp', 'client', 'StakeApi.mjs')
        ],
        checksumFile: path.join(homeDir, 'alphaverse-xrp', `client-${appVersion}.json`)
    },
    server: {
        files: [
            path.join(homeDir, 'alphaverse-xrp', 'server', 'index.js')
        ],
        checksumFile: path.join(homeDir, 'alphaverse-xrp', `server-${appVersion}.json`)
    },
    proxy: {
        files: [
            path.join(homeDir, 'proxy', 'src', 'index.js')
        ],
        checksumFile: path.join(homeDir, 'alphaverse-xrp', `proxy-${appVersion}.json`)
    }
};

// --- Main Functions ---

/**
 * Calculates the SHA256 checksum of a file.
 * @param {string} filePath - The path to the file.
 * @returns {Promise<string>} A promise that resolves with the hex checksum.
 */
async function calculateChecksum(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', (data) => hash.update(data, 'utf8'));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', (err) => reject(err));
    });
}

/**
 * Main function to obfuscate files and update their corresponding checksums.
 */
async function buildAndSecure() {
    console.log(`Starting build process for version ${appVersion}...`);

    for (const [component, config] of Object.entries(targets)) {
        console.log(`\n--- Processing Component: ${component.toUpperCase()} ---`);
        
        const checksumsForComponent = {
            [appVersion]: {}
        };

        for (const filePath of config.files) {
            if (!fs.existsSync(filePath)) {
                console.error(`\x1b[31m%s\x1b[0m`, `[ERROR] File not found, skipping: ${filePath}`);
                continue;
            }

            console.log(`Processing: ${filePath}`);
            
            // 1. Obfuscate the file
            const fileContent = fs.readFileSync(filePath, 'utf8');
            const obfuscationResult = JavaScriptObfuscator.obfuscate(fileContent, {
                compact: true,
                controlFlowFlattening: true,
                controlFlowFlatteningThreshold: 1,
                deadCodeInjection: true,
                deadCodeInjectionThreshold: 1,
                numbersToExpressions: true,
                simplify: true,
                stringArrayShuffle: true,
                splitStrings: true,
                stringArrayThreshold: 1,
                stringArrayEncoding: ['base64'],
                transformObjectKeys: true,
                unicodeEscapeSequence: true
            });
            
            const obfuscatedContent = obfuscationResult.getObfuscatedCode();
            fs.writeFileSync(filePath, obfuscatedContent);
            console.log(`   \x1b[32m%s\x1b[0m`, `-> Obfuscation complete.`);

            // 2. Calculate the new checksum
            const newChecksum = await calculateChecksum(filePath);
            
            // 3. Store the checksum with a relative path key
            const relativePath = path.relative(path.join(homeDir, 'alphaverse-xrp'), filePath).replace(/\\/g, '/');
            checksumsForComponent[appVersion][relativePath] = newChecksum;
            console.log(`   \x1b[32m%s\x1b[0m`, `-> New checksum: ${newChecksum}`);
        }

        // 4. Write the component-specific checksum file
        if (Object.keys(checksumsForComponent[appVersion]).length > 0) {
            fs.writeFileSync(config.checksumFile, JSON.stringify(checksumsForComponent, null, 2));
            console.log(`\nSUCCESS: Updated checksum file for ${component}: ${config.checksumFile}`);
        } else {
            console.log(`\nWARN: No files processed for ${component}. Checksum file not updated.`);
        }
    }
    console.log('\nBuild and secure process finished!');
}

// --- Execute Script ---
buildAndSecure().catch(console.error);
