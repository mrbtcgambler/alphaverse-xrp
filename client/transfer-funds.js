// This script provides a standalone method for testing direct XRP transfers from the central wallet.
// It reads the central wallet secret from the server configuration and uses command-line
// arguments to initiate a payment to a specified address and destination tag.
//
// Usage: node test_transfer.js <WALLET_ADDRESS> <DESTINATION_TAG> <AMOUNT>
// Example: node test_transfer.js razLtrbzXVXYvViLqUKLh8YenGLJid9ZTW 76631289 5

import { readFile } from 'fs/promises';
import * as xrpl from 'xrpl';

// --- Main Execution Function ---
(async () => {
    console.log('--- Direct XRP Transfer Test Script Initializing ---');

    try {
        // --- 1. Parse Command-Line Arguments ---
        const args = process.argv.slice(2);

        if (args.length < 3) {
            console.error('[ERROR] Missing arguments. Please provide the wallet address, destination tag, and amount.');
            console.log('[INFO] Usage: node test_transfer.js <WALLET_ADDRESS> <DESTINATION_TAG> <AMOUNT>');
            return;
        }

        const [walletAddress, destinationTag, amount] = args;
        const amountFloat = parseFloat(amount);

        // Validate the parsed arguments
        if (!walletAddress || !destinationTag || isNaN(amountFloat) || amountFloat <= 0) {
            console.error('[ERROR] Invalid arguments provided.');
            console.log(`[DEBUG] Received Address: ${walletAddress}, Tag: ${destinationTag}, Amount: ${amount}`);
            return;
        }

        console.log(`[INFO] Preparing to send ${amountFloat} XRP to ${walletAddress} with tag ${destinationTag}.`);

        // --- 2. Load Server Configuration ---
        console.log('[INFO] Loading server configuration...');
        const serverConfigJson = JSON.parse(
            await readFile(new URL('../server_config.json', import.meta.url))
        );
        
        const centralWalletSecret = process.env.CENTRAL_WALLET_SECRET || serverConfigJson.centralWalletSecret;

        if (!centralWalletSecret) {
            throw new Error('centralWalletSecret is missing from your server_config.json.');
        }

        // --- 3. Execute XRP Transfer ---
        console.log('[INFO] Connecting to XRP Ledger...');
        const xrplClient = new xrpl.Client('wss://xrplcluster.com/');
        await xrplClient.connect();

        // ALGORITHM FIX: Explicitly use 'secp256k1' to derive the correct wallet address from the secret.
        const centralWallet = xrpl.Wallet.fromSecret(centralWalletSecret, { algorithm: 'secp256k1' });
        console.log(`[INFO] Sending from wallet: ${centralWallet.address}`);

        const preparedTx = await xrplClient.autofill({
            "TransactionType": "Payment",
            "Account": centralWallet.address,
            "Amount": xrpl.xrpToDrops(amountFloat),
            "Destination": walletAddress,
            "DestinationTag": parseInt(destinationTag)
        });

        const signedTx = centralWallet.sign(preparedTx);
        const tx = await xrplClient.submitAndWait(signedTx.tx_blob);

        // --- 4. Log the Result ---
        if (tx.result.meta.TransactionResult === "tesSUCCESS") {
            console.log('\n--- [SUCCESS] ---');
            console.log('Transfer successful.');
            console.log('Transaction hash:', tx.result.hash);
        } else {
            console.log('\n--- [FAILURE] ---');
            console.log('Transfer failed. See transaction result below:');
            console.log(tx);
        }

        await xrplClient.disconnect();

    } catch (error) {
        console.error('\n[FATAL] An error occurred during the script execution:', error);
    } finally {
        console.log('\n--- Script Finished ---');
    }
})();
