# Alphaverse-XRP Automation Suite v2.0.1

Welcome to the Alphaverse-XRP Automation Suite, a sophisticated, multi-component system designed for secure and efficient automated operations. This guide provides comprehensive instructions for setting up the server, client, and proxy components.

**🎥 Tutorial Video**

* **Watch the setup tutorial here:** [YouTube Video](https://www.youtube.com/watch?v=1jqk8QUGm5M)
* ** Join Discord here:** [Discord](https://discord.gg/ujbxY8jZS4)
---

## 🛡️ Critical Security Features

This version introduces a robust, multi-layered security system to protect against tampering and ensure the integrity of the application.

### 1. Startup Integrity Check
-   At launch, the **Client**, **Server**, and **Proxy** applications each perform a mandatory integrity check.
-   They fetch an official list of checksums from a secure server (`alphaverse.army`).
-   They then calculate the checksum of their own source code and compare it to the official version.
-   If a mismatch is found, it indicates the code has been altered. The application will display a **critical security warning** and immediately terminate to prevent the use of non-genuine software.

### 2. Secure Wallet Configuration (Server)
-   The server no longer stores wallet credentials in configuration files.
-   At launch, the operator is prompted to enter the central wallet **secret** and the corresponding public **address**.
-   The server derives the address from the secret and verifies it against the entered address.
-   If they do not match, the server will exit, preventing accidental use of the wrong wallet.

### 3. Periodic Client Verification (Server)
-   Every 30 minutes, the server automatically verifies the integrity of all connected clients.
-   It compares the `clientChecksum` reported by each client against the official checksum fetched at startup.
-   If any client reports a mismatched checksum, the server will log a **security breach warning**, identify the non-compliant client(s), and shut down to protect the network.

---

## 🖥️ Server Setup

 1. **Update the System** 🔄

    * `sudo apt update && sudo apt upgrade`

 2. **Install Dependencies** 📦

    * `sudo apt install net-tools nodejs sshpass jq openssh-server git screen`

 3. **Install NVM (Node Version Manager)** ⚙️

    * `wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash`

    * Log out and log back in.

 4. **Install Node.js** 📝

    * `nvm install node && nvm use node`

 5. **Clone Repository** 📂

    * `git clone https://github.com/mrbtcgambler/alphaverse-xrp.git`

    * `cd alphaverse-xrp/`

 6. **Prepare Server Package** 📝

    * `rm package.json`

    * `mv server.package.json package.json`

 7. **Make Scripts Executable** 🔧

    * `chmod +x bin/*.sh`

 8. **Install Node Packages** ⬆️

    * `npm install`

 9. **Run the Server** 🚀

    * `npm run server`

10. **Enter Wallet Credentials** 🔐

    * When prompted, enter your central wallet secret and address for verification.

---

## 📄 Client Template Setup

 1. **Update the System** 🔄

    * `sudo apt update && sudo apt upgrade`

 2. **Install Dependencies** 📦

    * `sudo apt install net-tools nodejs sshpass jq openssh-server git screen`

 3. **Install NVM (Node Version Manager)** ⚙️

    * `wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash`

    * Log out and log back in.

 4. **Install Node.js** 📝

    * `nvm install node && nvm use node`

 5. **Clone Repository** 📂

    * `git clone https://github.com/mrbtcgambler/alphaverse-xrp.git`

    * `cd alphaverse-xrp/`

 6. **Make Scripts Executable** 🔧

    * `chmod +x bin/*.sh`

 7. **Install Node Packages** ⬆️

    * `npm install`

 8. **Edit Client Config** 📝

    * `nano client_config.json`

    * Add your API server information and user credentials.

 9. **Build the Agent** 🛠️

    * `./bin/buildAgent.sh`

10. **Set Sandbox Permissions** 🔒

    * `sudo chown root ~/proxy/node_modules/electron/dist/chrome-sandbox`

    * `sudo chmod 4755 ~/proxy/node_modules/electron/dist/chrome-sandbox`

11. **Verify the Setup** ✅

    * This script now verifies the integrity of all core files against the official checksums.

    * `node client/verify.js`

