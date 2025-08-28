import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import https from 'https';

// --- Configuration ---
const appVersion = '2.0.1';
const homeDir = os.homedir();

// Define the components, their files to verify, and their checksum URLs.
const targets = {
    client: {
        files: {
            'client/index.js': path.join(homeDir, 'alphaverse-xrp', 'client', 'index.js'),
            'client/StakeApi.mjs': path.join(homeDir, 'alphaverse-xrp', 'client', 'StakeApi.mjs')
        },
        checksumUrl: `https://www.alphaverse.army/client-${appVersion}.json`
    },
    server: {
        files: {
            'server/index.js': path.join(homeDir, 'alphaverse-xrp', 'server', 'index.js')
        },
        checksumUrl: `https://www.alphaverse.army/server-${appVersion}.json`
    },
    proxy: {
        files: {
            'proxy/src/index.js': path.join(homeDir, 'proxy', 'src', 'index.js')
        },
        checksumUrl: `https://www.alphaverse.army/proxy-${appVersion}.json`
    }
};

// --- Main Functions ---

/**
 * Calculates the SHA256 checksum of a file.
 * @param {string} filePath - The path to the file.
 * @returns {Promise<string>} A promise that resolves with the hex checksum.
 */
function calculateChecksum(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', (data) => hash.update(data, 'utf8'));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', (err) => reject(err));
    });
}

/**
 * Fetches the expected checksums from a URL, ignoring SSL certificate errors.
 * @param {string} url - The URL to fetch the checksums from.
 * @returns {Promise<object>} A promise that resolves with the parsed JSON data.
 */
async function getExpectedChecksums(url) {
    const agent = new https.Agent({
        rejectUnauthorized: false,
    });
    const response = await fetch(url, { agent });
    if (!response.ok) {
        throw new Error(`Failed to fetch checksums from ${url}: ${response.statusText}`);
    }
    return await response.json();
}

/**
 * Verifies the checksums for all defined components and their files.
 */
async function verifyChecksums() {
    console.log(`--- Verifying Checksums for Version ${appVersion} ---`);

    for (const [component, config] of Object.entries(targets)) {
        console.log(`\nVerifying ${component.toUpperCase()} component...`);
        try {
            const expectedChecksumsData = await getExpectedChecksums(config.checksumUrl);
            const expectedChecksums = expectedChecksumsData[appVersion];

            if (!expectedChecksums) {
                console.log(`\x1b[31m[ERROR] No checksums found for version ${appVersion} at ${config.checksumUrl}\x1b[0m`);
                continue;
            }

            for (const [relativePath, absolutePath] of Object.entries(config.files)) {
                if (fs.existsSync(absolutePath)) {
                    const actualChecksum = await calculateChecksum(absolutePath);
                    const expectedChecksum = expectedChecksums[relativePath];

                    if (expectedChecksum === actualChecksum) {
                        console.log(`  \x1b[32m✔ ${relativePath}: Checksum is valid.\x1b[0m`);
                    } else {
                        console.log(`  \x1b[31m✖ ${relativePath}: Checksum is INVALID.\x1b[0m`);
                        console.log(`    - Expected: ${expectedChecksum}`);
                        console.log(`    - Actual:   ${actualChecksum}`);
                    }
                } else {
                    console.log(`  \x1b[33m! ${absolutePath} does not exist. Skipping.\x1b[0m`);
                }
            }
        } catch (error) {
            console.error(`\x1b[31m[ERROR] Could not verify ${component}: ${error.message}\x1b[0m`);
        }
    }
}

// --- Execute Script ---
verifyChecksums().catch(console.error);
