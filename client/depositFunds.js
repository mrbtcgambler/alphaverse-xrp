import { readFile } from 'fs/promises';
import StakeApi from './StakeApi.mjs';

// Load configuration from client_config.json
const jsonConfig = JSON.parse(
    await readFile(new URL('../client_config.json', import.meta.url))
);

// Updated config to read all necessary XRP deposit fields
const config = {
    apiKey: process.env.CLIENT_API_KEY || jsonConfig.apiKey,
    currency: process.env.CLIENT_CURRENCY || jsonConfig.currency,
    // FIX: Check for the correct spelling 'depositAddress' first, then fall back to the typo 'depositeAddress'
    depositAddress: process.env.DEPOSIT_ADDRESS || jsonConfig.depositAddress || jsonConfig.depositeAddress,
    depositDestinationTag: process.env.DEPOSIT_DESTINATION_TAG || jsonConfig.depositDestinationTag,
    walletSecret: process.env.WALLET_SECRET || jsonConfig.walletSecret, // Your personal wallet's secret key
};

// --- DEBUGGING STEP ---
// Log the exact configuration being used to identify any discrepancies.
console.log("Using configuration");
console.log("Currency: ", config.currency)
console.log("depositAddress: ", config.depositAddress)
console.log("depositDestinationTag: ", config.depositDestinationTag)
// --------------------

// Initialise StakeApi client
const apiClient = new StakeApi(config.apiKey);

// Helper function to delay for a given number of milliseconds
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Deposit function with retry logic, now for XRP
async function depositFunds(amount, maxRetries = 3) {
    if (config.currency.toLowerCase() !== 'xrp') {
        console.error("This script is configured for XRP deposits only. Please check your client_config.json");
        return;
    }

    if (!config.walletSecret || !config.depositAddress || !config.depositDestinationTag) {
        console.error("Missing required XRP deposit information (depositAddress, or depositDestinationTag) in your config.");
        return;
    }

    let attempt = 0;
    while (attempt < maxRetries) {
        try {
            console.log(`Attempt ${attempt + 1}: Depositing ${amount} ${config.currency} to ${config.depositAddress} with tag ${config.depositDestinationTag}...`);

            const transactionHash = await apiClient.depositXRP(
                config.walletSecret,
                amount,
                config.depositAddress,
                config.depositDestinationTag
            );

            if (transactionHash) {
                console.log(`Successfully initiated deposit of ${amount} ${config.currency}. Transaction hash: ${transactionHash}`);
                return; // Exit the function on success
            } else {
                throw new Error("Deposit failed. The transaction hash was not returned.");
            }

        } catch (error) {
            // Check for the specific "Account not found" error
            if (error.message.includes('Account not found') || (error.data && error.data.error === 'actNotFound')) {
                console.error("\n-------------------------------------------------------------");
                console.error("CRITICAL ERROR: Your source XRP wallet has not been activated.");
                console.error("To activate it, you must send at least 10 XRP TO this address:");
                console.error(`   ${error.data.account}`);
                console.error("This is a one-time requirement of the XRP Ledger.");
                console.error("-------------------------------------------------------------\n");
                return; // Stop retrying, as this error is not recoverable without manual intervention.
            }

            console.error("Error during deposit:", error.message);
            
            attempt++;

            if (attempt < maxRetries) {
                console.log(`Retrying in 10 seconds... (${attempt}/${maxRetries})`);
                await delay(10000); // Wait 10 seconds before the next attempt
            } else {
                console.error("Max retries reached. Deposit failed.");
            }
        }
    }
}

// Execute deposit with provided amount from command line
const depositAmount = parseFloat(process.argv[2]);
if (isNaN(depositAmount) || depositAmount <= 0) {
    console.error("Please provide a valid amount to deposit. Usage: node depositFunds.js <amount>");
    process.exit(1);
}

await depositFunds(depositAmount);
