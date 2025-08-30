import { existsSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import StakeApi from './StakeApi.mjs';

const exec = promisify(execCallback);

/**
 * =================================================================================
 * THE JANUS STRATEGY V5.3
 * =================================================================================
 * * This bot employs a multi-stage, dual-strategy system named "Janus," after the
 * Roman god of transitions and duality. The strategy is designed to be aggressive
 * when profitable and conservative when recovering losses, adapting its behavior
 * based on performance.
 * * --- STAGE 1: PROFIT MAXIMIZATION (The Aggressive Face) ---
 * - TRIGGER: Activates when the session profit exceeds 50% of the starting play balance.
 * - BEHAVIOR: Places a consistent flat bet at 10x the base bet.
 * - GAMEPLAY: Utilizes a "perfect" Blackjack strategy, including doubling down and
 * splitting pairs to maximize the value of each hand.
 * * --- STAGE 2: RECOVERY (The Conservative Face) ---
 * - TRIGGER: The default starting stage for the bot.
 * - BEHAVIOR: Employs a "delayed Martingale" system. It flat bets for the base amount
 * for the first four consecutive losses. On the fifth loss, it escalates the bet
 * to 11x the base bet and begins a standard Martingale progression (doubling
 * the bet on each subsequent loss) until a win is achieved.
 * - FEATURES: A stop-loss is triggered if the losing streak reaches 16.
 * - GAMEPLAY: Uses a more conservative version of the Blackjack strategy that
 * disables doubling down AND splitting pairs to protect the bankroll.
 * * --- STAGE 3: COOLDOWN (Stop-Loss) ---
 * - TRIGGER: Activates if the session profit drops below a critical stop-loss threshold
 * OR if the losing streak in Stage 2 hits the limit.
 * - BEHAVIOR: Bets zero and observes the outcome of rounds without wagering.
 * - GAMEPLAY: After a conceptual "win" is observed, the bot transitions back to
 * Stage 2 to begin a new recovery cycle.
 * */

/**
 * =================================================================================
 * CONFIGURATION & INITIALIZATION
 * =================================================================================
 */

// Load configurations from JSON files.
const clientConfig = JSON.parse(
  await readFile(new URL('../client_config.json', import.meta.url))
);
const serverConfig = JSON.parse(
  await readFile(new URL('../server_config.json', import.meta.url))
);

// Consolidate configuration, allowing environment variables to override JSON values.
const config = {
  apiKey: process.env.CLIENT_API_KEY || clientConfig.apiKey,
  password: process.env.CLIENT_PASSWORD || clientConfig.password,
  currency: process.env.CLIENT_CURRENCY || clientConfig.currency,
  recoverThreshold: process.env.CLIENT_RECOVER_THRESHOLD || clientConfig.recoverThreshold,
};

const apiClient = new StakeApi(config.apiKey);
const stopLoss = -16; //set your stop loss limit!

const diceBotStatePath = new URL('/mnt/ramdrive/dicebot_state.json', import.meta.url);

let balance;

console.log('Initializing bot and fetching funds...');
let fundsFetched = false;
while (!fundsFetched) {
  try {
    const funds = await apiClient.getFunds(config.currency);
    if (funds && funds.available !== undefined) {
      balance = funds.available;
      config.funds = funds; // Store initial funds info
      console.log(`Funds fetched successfully: ${balance} ${config.currency}`);
      fundsFetched = true;
    } else {
      throw new Error('API returned null or invalid funds object.');
    }
  } catch (error) {
    console.log('Retrying in 3 seconds...');
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}

/**
 * =================================================================================
 * STATE MANAGEMENT
 * =================================================================================
 */
const state = {
  version: 5.3, // Corrected profit calculation and main loop syntax.
  baseBet: config.recoverThreshold / 1000,
  startingBalance: config.recoverThreshold, // This is the target *playing* balance
  initialBankroll: 0, // NEW: Will store the true starting total bankroll
  switch2Stage1Threshold: config.recoverThreshold * 0.5, // Profit target to switch to Stage 1
  switch2Stage3Threshold: (config.recoverThreshold * 0.0006) * -1,
  vaultThreshold: config.recoverThreshold * 1.2,
  IncreaseOnLoss: 2,
  currentBet: 0,
  profit: 0, // Will be calculated dynamically
  bets: 0,
  wager: 0,
  winCount: 0,
  currentStreak: 0,
  currentLosingStreak: 0,
  highestLosingStreak: 0,
  paused: false,
  pauseLogged: false,
  lastHourBets: [],
  stage: 2, // Default starting stage
  vaulted: config.funds.vault || 0,
};

// ** FIX: Calculate true starting bankroll BEFORE any initial adjustments **
state.initialBankroll = balance + (config.funds.vault || 0);
console.log(`True initial bankroll set to: ${state.initialBankroll.toFixed(8)}`);

// If the initial balance is above the threshold, move the excess to the vault.
if (balance > config.recoverThreshold) {
  const amountToVault = balance - config.recoverThreshold;
  console.log(`Initial balance is high. Vaulting ${amountToVault.toFixed(8)} ${config.currency}...`);
  await apiClient.depositToVault(config.currency, amountToVault);
  state.vaulted += amountToVault; // Update vaulted state for display
  balance -= amountToVault; // Adjust the live balance variable
}


// Initialize the starting bet based on the initial stage.
function initializeStage() {
    console.log(`\n#=========================================#`);
    console.log(`     Initializing in Stage ${state.stage}`);
    console.log(`#=========================================#\n`);
    switch (state.stage) {
        case 1:
            state.currentBet = state.baseBet * 10;
            break;
        case 2:
            state.currentBet = state.baseBet;
            break;
        case 3:
            state.currentBet = 0;
            break;
        default:
            console.error(`Unknown initial stage: ${state.stage}. Defaulting to Stage 2.`);
            state.stage = 2;
            state.currentBet = state.baseBet;
            break;
    }
}


console.log("***************************");
console.log("********GAME STATS*********");
console.log(`** Version: ${state.version}`);
console.log(`** Start Balance: ${state.startingBalance.toFixed(8)} ${config.currency}`);
console.log(`** Base Bet: ${state.baseBet.toFixed(8)} ${config.currency}`);
console.log(`** Switch to Stage 1 Threshold (Profit >): ${state.switch2Stage1Threshold.toFixed(8)} ${config.currency}`);
console.log(`** Switch to Stage 3 Threshold (Profit <): ${state.switch2Stage3Threshold.toFixed(8)} ${config.currency}`);
console.log("***************************");
await new Promise(r => setTimeout(r, 3000));


/**
 * =================================================================================
 * BLACKJACK "PERFECT STRATEGY" TABLES
 * =================================================================================
 */
// H: Hit, S: Stand, D: Double, P: Split, Ds: Double if allowed, else Stand
const pairsTable = [
    // Dealer:       2, 3, 4, 5, 6, 7, 8, 9, 10, A
    /* 2-2 */   ['P', 'P', 'P', 'P', 'P', 'P', 'H', 'H', 'H', 'H'],
    /* 3-3 */   ['P', 'P', 'P', 'P', 'P', 'P', 'H', 'H', 'H', 'H'],
    /* 4-4 */   ['H', 'H', 'H', 'P', 'P', 'H', 'H', 'H', 'H', 'H'],
    /* 5-5 */   ['D', 'D', 'D', 'D', 'D', 'D', 'D', 'D', 'H', 'H'],
    /* 6-6 */   ['P', 'P', 'P', 'P', 'P', 'H', 'H', 'H', 'H', 'H'],
    /* 7-7 */   ['P', 'P', 'P', 'P', 'P', 'P', 'H', 'H', 'H', 'H'],
    /* 8-8 */   ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
    /* 9-9 */   ['P', 'P', 'P', 'P', 'P', 'S', 'P', 'P', 'S', 'S'],
    /* 10-10 */ ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'],
    /* A-A */   ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P', 'P', 'P']
];
const softTable = [
    // Dealer:                 2,    3,    4,    5,    6,    7,    8,    9,   10,    A
    /* A,2 (Soft 13) */ ['H',  'H',  'D',  'D',  'D',  'H',  'H',  'H',  'H',  'H'],
    /* A,3 (Soft 14) */ ['H',  'H',  'D',  'D',  'D',  'H',  'H',  'H',  'H',  'H'],
    /* A,4 (Soft 15) */ ['H',  'D',  'D',  'D',  'D',  'H',  'H',  'H',  'H',  'H'],
    /* A,5 (Soft 16) */ ['H',  'D',  'D',  'D',  'D',  'H',  'H',  'H',  'H',  'H'],
    /* A,6 (Soft 17) */ ['D',  'D',  'D', 'D',  'D',  'H',  'H',  'H',  'H', 'H'],
    /* A,7 (Soft 18) */ ['S', 'Ds', 'Ds', 'Ds', 'Ds',  'S',  'S',  'H',  'H',  'H'],
    /* A,8 (Soft 19) */ ['S',  'S',  'S',  'S',  'S',  'S',  'S',  'S',  'S',  'S'],
    /* A,9 (Soft 20) */ ['S',  'S',  'S',  'S',  'S',  'S',  'S',  'S',  'S',  'S']
];
const hardTable = [
    // Dealer:                 2,   3,   4,   5,   6,   7,   8,   9,    10,   A
    /* 8 or less */ ['H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H'],
    /* 9 */         ['H', 'D', 'D', 'D', 'D', 'H', 'H', 'H', 'H', 'H'],
    /* 10 */        ['D', 'D', 'D', 'D', 'D', 'D', 'D', 'D', 'H', 'H'],
    /* 11 */        ['D', 'D', 'D', 'D', 'D', 'D', 'D', 'D', 'D', 'H'],
    /* 12 */        ['H', 'H', 'S', 'S', 'S', 'H', 'H', 'H', 'H', 'H'],
    /* 13 */        ['S', 'S', 'S', 'S', 'S', 'H', 'H', 'H', 'H', 'H'],
    /* 14 */        ['S', 'S', 'S', 'S', 'S', 'H', 'H', 'H', 'H', 'H'],
    /* 15 */        ['S', 'S', 'S', 'S', 'S', 'H', 'H', 'H', 'H', 'H'],
    /* 16 */        ['S', 'S', 'S', 'S', 'S', 'H', 'H', 'H', 'H', 'H'],
    /* 17+ */       ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S']
];
const actionMapping = { H: 'hit', S: 'stand', D: 'double', P: 'split', Ds: 'double' };

/**
 * =================================================================================
 * HELPER FUNCTIONS
 * =================================================================================
 */

// Absolute pause file path used by an external process to pause the bot.
const pausePath = '/mnt/alphaverse-xrp/client/pause';

function setStage(stageNumber) {
  if (state.stage === stageNumber) return; // No change
  console.log(`\n#=========================================#`);
  console.log(`        Switching to Stage ${stageNumber}`);
  console.log(`#=========================================#\n`);
  state.stage = stageNumber;
  state.currentStreak = 0; // Reset streak when changing stage
}

async function writeStatsFile(currentBalance) {
  const stats = {
    balance: currentBalance,
    bets: state.bets,
    stage: state.stage,
    wager: state.wager,
    vaulted: state.vaulted,
    profit: state.profit,
    betSize: state.currentBet,
    currentStreak: state.currentStreak,
    highestLosingStreak: state.highestLosingStreak,
    betsPerHour: getBetsPerHour(),
    lastBet: new Date().toISOString(),
    wins: state.winCount,
    losses: (state.bets - state.winCount),
    version: state.version,
    paused: state.paused,
  };
  try {
    // Writes state to a RAM disk for performance and to reduce wear on physical drives.
    await writeFile(diceBotStatePath, JSON.stringify(stats));
  } catch (e) {
    console.error('Failed to write stats file:', e);
  }
}

function getCardValue(rank) {
  if (rank === 'A') return 1; // Ace is initially 1
  if (['K', 'Q', 'J'].includes(rank)) return 10;
  return +rank;
}

function getTotal(cards) {
  let total = 0, aces = 0;
  for (const c of cards) {
    total += getCardValue(c.rank);
    if (c.rank === 'A') aces++;
  }
  // Elevate Ace value from 1 to 11 if it doesn't cause a bust.
  while (aces > 0 && total + 10 <= 21) {
    total += 10;
    aces--;
  }
  return total;
}

function isSoft(cards) {
    const hasAce = cards.some(c => c.rank === 'A');
    if (!hasAce) return false;
    let totalWithoutFlexibleAce = 0;
    for (const c of cards) {
        totalWithoutFlexibleAce += getCardValue(c.rank);
    }
    return totalWithoutFlexibleAce + 10 <= 21;
}

function formatCards(cards) {
  return cards.map(c => c.rank).join(', ');
}

function getBetsPerHour() {
    const now = Date.now();
    const oneHourAgo = now - 3600000; // 1 hour in milliseconds
    
    const recentBets = state.lastHourBets.filter(timestamp => timestamp >= oneHourAgo);
    
    const twoHoursAgo = now - 7200000;
    state.lastHourBets = state.lastHourBets.filter(timestamp => timestamp >= twoHoursAgo);
    
    return recentBets.length;
}

function determineBestAction(player, dealerUp, hasSplit = false) {
  const playerValue = getTotal(player);
  const dealerValueRaw = getCardValue(dealerUp.rank);
  const dealerValue = dealerValueRaw === 1 ? 11 : dealerValueRaw; // Treat dealer Ace as 11 for lookup
  const dealerIndex = Math.max(0, Math.min(dealerValue === 11 ? 9 : dealerValue - 2, 9));

  let strategicActionCode = 'S'; // Default to Stand

  if (player.length === 2 && player[0].rank === player[1].rank && !hasSplit) {
    const pairIndex = Math.max(0, Math.min(getCardValue(player[0].rank) - 2, 9));
    strategicActionCode = pairsTable[pairIndex][dealerIndex];
  } else if (isSoft(player)) {
    const softIndex = Math.max(0, Math.min(playerValue - 13, softTable.length - 1));
    strategicActionCode = softTable[softIndex][dealerIndex];
  } else { // Hard hand
    const hardIndex = playerValue <= 8 ? 0 : Math.max(0, Math.min(playerValue - 8, hardTable.length - 1));
    strategicActionCode = hardTable[hardIndex][dealerIndex];
  }
  
  let preferredApiAction = actionMapping[strategicActionCode];
  
  if (preferredApiAction === 'double' && player.length !== 2) {
      if (strategicActionCode === 'Ds') {
          preferredApiAction = 'stand';
      } else {
          preferredApiAction = 'hit';
      }
  }
  
  if (state.stage === 2) {
      if (preferredApiAction === 'double') {
          if (strategicActionCode === 'Ds') {
              preferredApiAction = 'stand';
          } else {
              preferredApiAction = 'hit';
          }
      }
      if (preferredApiAction === 'split') {
          const hardIndex = playerValue <= 8 ? 0 : Math.max(0, Math.min(playerValue - 8, hardTable.length - 1));
          const newStrategicActionCode = hardTable[hardIndex][dealerIndex];
          preferredApiAction = actionMapping[newStrategicActionCode];
          if (preferredApiAction === 'double') {
                  preferredApiAction = 'hit';
          }
      }
  }

  return preferredApiAction;
}

// --- New helpers for deterministic profit calculation ---

function isNaturalBlackjack(cards) {
  return Array.isArray(cards) && cards.length === 2 && getTotal(cards) === 21;
}

function calculateRoundPnL(finalState, handStakes, initialPlayerCards, initialDealerCards, hadSplit) {
  if (!finalState || !finalState.dealer || !finalState.dealer[0] || !Array.isArray(finalState.dealer[0].cards)) {
    return 0; // Fail safe
  }

  const playerInitialBJ = isNaturalBlackjack(initialPlayerCards) && !hadSplit;
  const dealerInitialBJ = isNaturalBlackjack(initialDealerCards);

  if (playerInitialBJ || dealerInitialBJ) {
    if (playerInitialBJ && dealerInitialBJ) return 0; // Push
    if (playerInitialBJ && !dealerInitialBJ) return handStakes[0] * 1.5; // 3:2 Payout
    if (!playerInitialBJ && dealerInitialBJ) return -handStakes[0];
  }

  const dealerCards = finalState.dealer[0].cards;
  const dealerTotal = getTotal(dealerCards);
  const dealerBust = dealerTotal > 21;

  let pnl = 0;
  const hands = finalState.player || [];
  for (let i = 0; i < hands.length; i++) {
    const stake = handStakes[i] || 0;
    if (stake <= 0) continue;
    const pTotal = getTotal(hands[i].cards);
    const pBust = pTotal > 21;

    if (pBust) {
      pnl -= stake;
    } else if (dealerBust) {
      pnl += stake;
    } else if (pTotal > dealerTotal) {
      pnl += stake;
    } else if (pTotal < dealerTotal) {
      pnl -= stake;
    } // equal => push => 0
  }
  return pnl;
}


/**
 * =================================================================================
 * BETTING STRATEGY LOGIC
 * =================================================================================
 */

async function handleStage1Logic(isWin, isLoss, currentBalance) {
    state.currentBet = state.baseBet * 10;

    if (isWin) {
        if (state.currentStreak > 0) {
            state.currentStreak++;
        } else {
            state.currentStreak = 1;
        }
        // On a win, if balance is above the target, skim the excess to the vault.
        if (currentBalance > (state.startingBalance + state.profit + (state.baseBet * 11))) {
            const amountToVault = currentBalance - state.startingBalance;
            if (amountToVault > 0.00000001) {
                console.log(`[Stage 1] Vaulting excess profit: ${amountToVault.toFixed(8)}`);
                await apiClient.depositToVault(config.currency, amountToVault);
                state.vaulted += amountToVault;
            }
        }
    } else if (isLoss) {
        if (state.currentStreak < 0) {
            state.currentStreak--;
        } else {
            state.currentStreak = -1;
        }
    }

    if (state.profit < state.switch2Stage3Threshold) {
        console.log(`Switching to Stage 3 due to profit stop-loss: ${state.profit.toFixed(8)} < ${state.switch2Stage3Threshold.toFixed(8)}`);
        setStage(3);
        state.currentBet = 0;
    }

}

async function handleStage2Logic(isWin, isLoss, currentBalance) {
    if (state.profit >= state.switch2Stage1Threshold) {
        console.log(`Profit target reached! Switching to Stage 1. Profit: ${state.profit.toFixed(8)} >= ${state.switch2Stage1Threshold.toFixed(8)}`);
        setStage(1);
        state.currentBet = state.baseBet * 10;
        return;
    }

    if (isWin) {
        if (state.currentStreak > 0) {
            state.currentStreak++;
        } else {
            state.currentStreak = 1;
        }
        state.currentBet = state.baseBet;

        // On a win, if balance is above the target, skim the excess to the vault.
        if (currentBalance > (state.startingBalance + state.profit + (state.baseBet * 11))) {
            const amountToVault = currentBalance - state.startingBalance;
            if (amountToVault > 0.00000001) {
                console.log(`[Stage 2] Vaulting excess funds: ${amountToVault.toFixed(8)}`);
                await apiClient.depositToVault(config.currency, amountToVault);
                state.vaulted += amountToVault;
            }
        }
    } else if (isLoss) {
        if (state.currentStreak < 0) {
            state.currentStreak--;
        } else {
            state.currentStreak = -1;
        }

        if (state.currentStreak <= stopLoss) {
            console.log(`[STOP-LOSS] Losing streak reached ${state.currentStreak}. Switching to Stage 3 to cool down.`);
            setStage(3);
            state.currentBet = 0;
            return;
        }

        // ** FIX: Corrected Martingale Logic **
        let nextBet;
        if (state.currentStreak < -5) {
            // Martingale progression (after 5th loss)
            nextBet = state.currentBet * state.IncreaseOnLoss;
        } else if (state.currentStreak === -5) {
            // First escalated bet on 5th loss
            nextBet = state.baseBet * 11;
        } else {
            // Flat bet for losses 1-4
            nextBet = state.baseBet;
        }
        state.currentBet = nextBet;
    }
}

function handleStage3Logic(isWin, isLoss) {
    state.currentBet = 0; // Always bet 0 in cooldown
    
    // In Stage 3, any completed round (which will be a PUSH since bet is 0)
    // is enough to end the cooldown period. This acts as a 1-round pause.
    if (!isWin && !isLoss) {
        console.log("[COOLDOWN] Cooldown round observed. Switching back to Stage 2.");
        setStage(2);
        state.currentBet = state.baseBet; // Set next bet for Stage 2
    } else {
        // This case should not be hit, but as a safeguard, we stay in cooldown.
        if (state.currentStreak < 0) {
            state.currentStreak--;
        } else {
            state.currentStreak = -1;
        }
    }
}

/**
 * =================================================================================
 * GAME FLOW
 * =================================================================================
 */
async function playHand(betData) {
    if (typeof betData.amount !== 'number' || isNaN(betData.amount)) {
        console.error('[FATAL] betData.amount is not a valid number. Aborting hand.', betData);
        return { finalState: betData.state, wager: 0, roundPnL: 0 };
    }

    let gameState = betData.state;
    const gameId = betData.id;
    let hasSplit = false;

    let totalWagered = betData.amount;
    let handStakes = [betData.amount];

    // Snapshot initial cards for correct natural-BJ scoring
    const initialPlayerCards = (gameState?.player?.[0]?.cards || []).map(c => ({ rank: c.rank }));
    const initialDealerCards = (gameState?.dealer?.[0]?.cards || []).map(c => ({ rank: c.rank }));

    // Insurance handling (decline)
    if (gameState.dealer?.[0]?.cards?.[0]?.rank?.toUpperCase() === 'A' && gameState.player?.[0]?.cards.length === 2) {
        try {
            const insuranceResponse = await apiClient.BlackjackNextBet("noInsurance", gameId);
            const insuranceData = JSON.parse(insuranceResponse);
            if (insuranceData?.data?.blackjackNext?.state) {
                gameState = insuranceData.data.blackjackNext.state;
            }
        } catch (_) {}
    }

    // Handle initial natural Blackjacks
    if (isNaturalBlackjack(initialPlayerCards) || isNaturalBlackjack(initialDealerCards)) {
        const roundPnL = calculateRoundPnL(gameState, handStakes, initialPlayerCards, initialDealerCards, false);
        return { finalState: gameState, wager: totalWagered, roundPnL };
    }

    let handIndex = 0;
    while (gameState.player && handIndex < gameState.player.length) {
        let currentHand = gameState.player[handIndex];

        while (true) {
            if (getTotal(currentHand.cards) >= 21) break;

            let apiAction = determineBestAction(currentHand.cards, gameState.dealer[0].cards[0], hasSplit);

            try {
                const nextResponse = await apiClient.BlackjackNextBet(apiAction, gameId);
                const nextData = JSON.parse(nextResponse);
                if (!nextData?.data?.blackjackNext) break;

                gameState = nextData.data.blackjackNext.state;
                currentHand = gameState.player[handIndex];

                if (apiAction === 'double') {
                    totalWagered += handStakes[handIndex];
                    handStakes[handIndex] *= 2;
                    break;
                }

                if (apiAction === 'split') {
                    hasSplit = true;
                    totalWagered += handStakes[handIndex];
                    handStakes.push(handStakes[handIndex]);
                    handIndex = -1; // restart loop
                    break;
                }

                if (apiAction === 'stand') break;

            } catch (_) {
                break;
            }
        }
        handIndex++;
    }

    const roundPnL = calculateRoundPnL(gameState, handStakes, initialPlayerCards, initialDealerCards, hasSplit);
    return { finalState: gameState, wager: totalWagered, roundPnL };
}


/**
 * =================================================================================
 * MAIN EXECUTION LOOP
 * =================================================================================
 */
(async () => {
  initializeStage();
  console.log(`Blackjack Bot V${state.version} Initialized. Starting main loop...`);
  console.log('====================================================');
  
  let lastGameId = null;
  let staleGameCounter = 0; 

  while (true) {
    try {
        state.paused = existsSync(pausePath);
        if (state.paused) {
            if (!state.pauseLogged) { console.log('[INFO] Paused by external signal...'); state.pauseLogged = true; }
            await writeStatsFile(balance);
            await new Promise(r => setTimeout(r, 1000));
            continue;
        } else {
            if (state.pauseLogged) { console.log('[INFO] Resuming...'); }
            state.pauseLogged = false;
        }

        let activeGame = (JSON.parse(await apiClient.BlackjackActiveBet()))?.data?.user?.activeCasinoBet || null;
        
        if (activeGame && activeGame.id === lastGameId) {
            staleGameCounter++;
            if (staleGameCounter > 5) {
                console.log("Stale game detected. Forcing a logic restart.");
                lastGameId = null;
                staleGameCounter = 0;
            }
            await new Promise(r => setTimeout(r, 250)); 
            continue;
        }
        staleGameCounter = 0; 
        
        if (!activeGame) {
            let betAmount = state.currentBet;

            if (betAmount <= 0 && state.stage !== 3) {
                betAmount = state.baseBet;
                state.currentBet = state.baseBet;
            }

            if (state.stage === 3) {
                activeGame = { amount: 0, state: {} }; 
            } else {
                const betResponse = await apiClient.BlackjackBet(betAmount, config.currency);
                activeGame = JSON.parse(betResponse)?.data?.blackjackBet;
                if (!activeGame) {
                    console.error("Failed to place new bet. Retrying...");
                    await new Promise(r => setTimeout(r, 250));
                    continue;
                }
            }
        }
        
        // --- DERIVED PROFIT LOGIC ---
        const { finalState, wager, roundPnL } = await playHand(activeGame);

        // Keep balance and vault perfectly synced from the API
        const fundsAfterRound = await apiClient.getFunds(config.currency);
        balance = fundsAfterRound.available;
        state.vaulted = fundsAfterRound.vault || 0;

        // ** FIX: Profit is now derived from the initial bankroll for 100% accuracy **
        const currentTotalBankroll = balance + state.vaulted;
        state.profit = currentTotalBankroll - state.initialBankroll;

        const roundProfit = roundPnL; // Use PnL for round-specific logs

        state.wager += wager;
        state.bets++;
        state.lastHourBets.push(Date.now());

        if (!finalState || !finalState.dealer || !finalState.dealer[0] || !finalState.dealer[0].cards) {
            console.log('[INFO] Received invalid final state. Cannot display round summary. Moving to next hand.');
        } else {
            const isWinForLog = roundProfit > 0;
            const isLossForLog = roundProfit < 0;
            const outcomeText = isWinForLog ? 'WIN' : (isLossForLog ? 'LOSS' : 'PUSH');
            const colorFormat = isWinForLog ? '\x1b[32m%s\x1b[0m' : (isLossForLog ? '\x1b[31m%s\x1b[0m' : '\x1b[33m%s\x1b[0m');
            const summaryLines = [
                `\n--- Round Summary ---`,
                `Result: ${outcomeText} | PnL: ${roundProfit.toFixed(8)} | Total Profit: ${state.profit.toFixed(8)}`,
                `Dealer Hand: [${formatCards(finalState.dealer[0].cards)}] (Value: ${getTotal(finalState.dealer[0].cards)})`,
                `Next Bet: ${state.currentBet.toFixed(8)} | Stage: ${state.stage} | Streak: ${state.currentStreak}`,
                `----------------------------------------------------`
            ];
            summaryLines.forEach(line => {
                console.log(colorFormat, line);
            });
        }
        
        const isWin = roundProfit > 0;
        const isLoss = roundProfit < 0;
        
        if (isWin) state.winCount++;
        
        if (isLoss) {
            state.currentLosingStreak++;
            if(state.currentLosingStreak > state.highestLosingStreak) {
                state.highestLosingStreak = state.currentLosingStreak;
            }
        } else {
            state.currentLosingStreak = 0;
        }

        switch (state.stage) {
            case 1: await handleStage1Logic(isWin, isLoss, balance); break;
            case 2: await handleStage2Logic(isWin, isLoss, balance); break;
            case 3: handleStage3Logic(isWin, isLoss); break;
        }

    } catch (e) {
        console.error("An unexpected error occurred in the main loop:", e);
        console.log("Restarting loop after 1 second...");
        await new Promise(r => setTimeout(r, 1000));
    }
    await writeStatsFile(balance);
    await new Promise(r => setTimeout(r, 1));
  }
})();

