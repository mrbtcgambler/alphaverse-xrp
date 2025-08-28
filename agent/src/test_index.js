const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { exec } = require('child_process');
const os = require('os');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const appVersion = '2.0.1';

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
 * Performs a system integrity check for the proxy itself.
 */
async function performSystemCheck() {
    try {
        console.log(`[SYSTEM CHECK] Verifying proxy integrity for version ${appVersion}...`);
        const checksumUrl = `https://www.alphaverse.army/proxy-${appVersion}.json`;
        console.log(`[SYSTEM CHECK] Fetching checksums from: ${checksumUrl}`);
        
        const response = await fetch(checksumUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch checksums: ${response.statusText}`);
        }
        const officialChecksums = await response.json();
        
        if (!officialChecksums[appVersion]) {
            throw new Error(`No checksums found for version ${appVersion} in the official source.`);
        }

        // --- CRITICAL FIX: Use the correct key provided by the user ---
        const expectedChecksum = officialChecksums[appVersion]['proxy/index.js'];
        const actualChecksum = await calculateChecksum(__filename); // __filename refers to the current file

        console.log(`[DEBUG] Expected Proxy Checksum: ${expectedChecksum}`);
        console.log(`[DEBUG] Actual Proxy Checksum:   ${actualChecksum}`);

        if (actualChecksum === expectedChecksum) {
            console.log('[SYSTEM CHECK] \x1b[32m%s\x1b[0m', 'SUCCESS: Proxy application is genuine.');
        } else {
            console.error('\n\x1b[31m%s\x1b[0m', '******************************************************************');
            console.error('\x1b[31m%s\x1b[0m', '* DANGER: PROXY SECURITY CHECK FAILED!                         *');
            console.error('\x1b[31m%s\x1b[0m', '* This software may be a counterfeit or tampered version.      *');
            console.error('\x1b[31m%s\x1b[0m', '******************************************************************\n');
            app.quit(); // Use app.quit() for Electron
        }
    } catch (error) {
        console.error('[FATAL] Could not perform proxy integrity check:', error.message);
        console.error('[FATAL] Halting execution for security reasons.');
        app.quit();
    }
}


const agent = new https.Agent({
    rejectUnauthorized: false
});

if (require('electron-squirrel-startup')) {
    app.quit();
}


let mainWindow;
let server;

const createWindow = async () => {
    if (mainWindow) {
        mainWindow.destroy(); // Ensure previous windows are destroyed to prevent memory leaks
    }

    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            webSecurity: false,
        },
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    await mainWindow.loadFile(path.join(__dirname, 'index.html'));

    // Create HTTP server
    server = http.createServer(async (req, res) => {
        let body = [];
        req.on('data', (chunk) => {
            body.push(chunk);
        }).on('end', async () => {
            body = Buffer.concat(body).toString();
            const stakeMirror = await mainWindow.webContents.executeJavaScript(`localStorage.getItem('stakeMirror')`, true) || 'stake.com';

            const stakeCookies = await session.defaultSession.cookies.get({ url: `https://www.${stakeMirror}` }),
                cookieString = stakeCookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');

            const id = uuidv4();
            mainWindow.webContents.send('api-request', {
                id: id,
                apiKey: req.headers['x-access-token'],
                cookie: cookieString,
                body: body,
            });

            const listener = (event, response) => {
                res.write(JSON.stringify(response));
                res.end();
                ipcMain.removeListener(`api-response-${id}`, listener); // Clean up IPC listener
            };

            ipcMain.once(`api-response-${id}`, listener);

            // Auto-remove listener if no response after 10 seconds
            setTimeout(() => ipcMain.removeListener(`api-response-${id}`, listener), 10000);
        });
    }).listen(8080);

};

app.on('ready', async () => {
    // --- Perform the system check before creating the window ---
    await performSystemCheck();
    await createWindow();
});

app.on('window-all-closed', () => {

    if (server) {
        server.close(); // Close HTTP server
    }

    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        await createWindow();
    }
});
