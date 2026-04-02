require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// ── Persistent state ─────────────────────────────────────────────────────────
const STATE_FILE = path.join(__dirname, '.gamestate.json');

function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
            return {
                balances: new Map(Object.entries(raw.balances || {})),
                bjSessions: new Map(Object.entries(raw.bjSessions || {}))
            };
        }
    } catch (_) {}
    return { balances: new Map(), bjSessions: new Map() };
}

function saveState() {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify({
            balances: Object.fromEntries(balances),
            bjSessions: Object.fromEntries(bjSessions)
        }));
    } catch (_) {}
}

const { balances, bjSessions } = loadState();

// Treasury wallet — set TREASURY_WALLET env var in production
const TREASURY = process.env.TREASURY_WALLET || '11111111111111111111111111111111';

function getBalance(wallet) { return balances.get(wallet) ?? 0; }
function setBalance(wallet, v) { balances.set(wallet, Math.max(0, parseFloat(v.toFixed(6)))); saveState(); }

// ── Helpers ──────────────────────────────────────────────────────────────────
const SUITS = ['♠','♥','♦','♣'];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];

function buildDeck() {
    const d = [];
    for (const s of SUITS) for (const r of RANKS) d.push({ r, s });
    for (let i = d.length - 1; i > 0; i--) {
        const j = crypto.randomInt(0, i + 1);
        [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
}

function cardValue(c) {
    if (['J','Q','K'].includes(c.r)) return 10;
    if (c.r === 'A') return 11;
    return parseInt(c.r);
}

function handTotal(hand) {
    let total = 0, aces = 0;
    for (const c of hand) { total += cardValue(c); if (c.r === 'A') aces++; }
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return total;
}

function secureRoll() {
    return crypto.randomInt(0, 10_000_000) / 100_000;
}

// ── WebSocket Chat + Active Users ────────────────────────────────────────────
const chatClients = new Map(); // ws -> { wallet, name }
const chatHistory = []; // last 50 messages

function broadcast(data) {
    const msg = JSON.stringify(data);
    for (const [ws] of chatClients) {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
}

function broadcastUserCount() {
    broadcast({ type: 'users', count: chatClients.size });
}

wss.on('connection', (ws) => {
    chatClients.set(ws, { wallet: null, name: 'Guest#' + Math.floor(Math.random() * 9000 + 1000) });
    broadcastUserCount();

    // Send history to new client
    ws.send(JSON.stringify({ type: 'history', messages: chatHistory }));
    ws.send(JSON.stringify({ type: 'users', count: chatClients.size }));

    ws.on('message', (raw) => {
        try {
            const data = JSON.parse(raw);
            const client = chatClients.get(ws);

            if (data.type === 'identify') {
                client.wallet = data.wallet || null;
                client.name = data.wallet
                    ? data.wallet.slice(0, 4) + '...' + data.wallet.slice(-4)
                    : 'Guest#' + Math.floor(Math.random() * 9000 + 1000);
                broadcastUserCount();
                return;
            }

            if (data.type === 'chat') {
                const text = String(data.text || '').trim().slice(0, 200);
                if (!text) return;
                const msg = {
                    type: 'chat',
                    name: client.name,
                    text,
                    ts: Date.now()
                };
                chatHistory.push(msg);
                if (chatHistory.length > 50) chatHistory.shift();
                broadcast(msg);
            }
        } catch (_) {}
    });

    ws.on('close', () => {
        chatClients.delete(ws);
        broadcastUserCount();
    });
});

// ── Balance API ──────────────────────────────────────────────────────────────
app.get('/api/balance/:wallet', (req, res) => {
    res.json({ balance: getBalance(req.params.wallet) });
});

// ── Config ───────────────────────────────────────────────────────────────────
app.get('/api/config', (req, res) => {
    res.json({
        cluster: process.env.SOLANA_CLUSTER || 'devnet',
        treasury: TREASURY
    });
});

// ── Recent bets feed ─────────────────────────────────────────────────────────
const recentBets = [];
function addBet(game, wallet, won, amount, multiplier) {
    recentBets.unshift({ game, wallet: wallet.slice(0,4)+'...'+wallet.slice(-4), won, amount: parseFloat(amount.toFixed(4)), multiplier: parseFloat(multiplier.toFixed(2)), ts: Date.now() });
    if (recentBets.length > 50) recentBets.pop();
    broadcast({ type: 'bet', bet: recentBets[0] });
}

app.get('/api/bets', (req, res) => res.json(recentBets.slice(0, 50)));

// ── Dice (98% RTP) ───────────────────────────────────────────────────────────
app.post('/api/dice/roll', (req, res) => {
    const { wallet, bet, target, mode } = req.body;
    if (!wallet) return res.status(400).json({ error: 'wallet required' });

    const betAmt = parseFloat(bet) || 0;
    const bal = getBalance(wallet);

    if (betAmt < 0 || betAmt > bal) return res.status(400).json({ error: 'Insufficient balance' });

    const result = secureRoll();
    const winChance = mode === 'under' ? target : 100 - target;
    const multiplier = 98 / winChance; // 98% RTP
    const won = mode === 'under' ? result < target : result > target;
    const profit = betAmt * (multiplier - 1);
    const delta = won ? profit : -betAmt;

    setBalance(wallet, bal + delta);
    addBet('Dice', wallet, won, betAmt, multiplier);

    res.json({
        result: parseFloat(result.toFixed(2)),
        won,
        multiplier: parseFloat(multiplier.toFixed(4)),
        profit: parseFloat(profit.toFixed(6)),
        delta: parseFloat(delta.toFixed(6)),
        balance: getBalance(wallet)
    });
});

// ── Blackjack (98% RTP via house edge on dealer rules) ───────────────────────
// House edge achieved by: dealer hits soft 17, BJ pays 6:5 (not 3:2)
// This brings theoretical RTP to ~98%

app.post('/api/blackjack/deal', (req, res) => {
    const { wallet, bet } = req.body;
    if (!wallet) return res.status(400).json({ error: 'wallet required' });

    const betAmt = parseFloat(bet) || 0;
    const bal = getBalance(wallet);
    if (betAmt < 0 || betAmt > bal) return res.status(400).json({ error: 'Insufficient balance' });

    const deck = buildDeck();
    const playerHand = [deck.pop(), deck.pop()];
    const dealerHand = [deck.pop(), deck.pop()];

    bjSessions.set(wallet, {
        bet: betAmt,
        deck,
        playerHand,
        dealerHand,
        splitHands: null,
        splitIndex: 0,
        insuranceBet: 0,
        insuranceTaken: false,
        done: false
    });
    saveState();

    setBalance(wallet, bal - betAmt);

    const playerTotal = handTotal(playerHand);
    const offerInsurance = dealerHand[0].r === 'A';

    res.json({
        playerHand,
        dealerUp: dealerHand[0],
        playerTotal,
        dealerVisible: cardValue(dealerHand[0]),
        offerInsurance,
        naturalBJ: playerTotal === 21,
        balance: getBalance(wallet)
    });
});

app.post('/api/blackjack/insurance', (req, res) => {
    const { wallet } = req.body;
    const session = bjSessions.get(wallet);
    if (!session || session.done) return res.status(400).json({ error: 'No active session' });
    if (session.dealerHand[0].r !== 'A') return res.status(400).json({ error: 'Insurance not available' });
    if (session.insuranceTaken) return res.status(400).json({ error: 'Already taken' });

    const insuranceBet = session.bet / 2;
    const bal = getBalance(wallet);
    if (insuranceBet > bal) return res.status(400).json({ error: 'Insufficient balance' });

    setBalance(wallet, bal - insuranceBet);
    session.insuranceBet = insuranceBet;
    session.insuranceTaken = true;
    res.json({ insuranceBet, balance: getBalance(wallet) });
});

app.post('/api/blackjack/hit', (req, res) => {
    const { wallet } = req.body;
    const session = bjSessions.get(wallet);
    if (!session || session.done) return res.status(400).json({ error: 'No active session' });

    const hand = session.splitHands ? session.splitHands[session.splitIndex] : session.playerHand;
    hand.push(session.deck.pop());
    const total = handTotal(hand);

    if (total > 21 && session.splitHands && session.splitIndex === 0) {
        session.splitIndex = 1;
        return res.json({ hand: session.splitHands[0], total, bust: true, nextSplit: true, currentHand: session.splitHands[1], currentTotal: handTotal(session.splitHands[1]) });
    }

    res.json({ hand: session.splitHands ? session.splitHands[session.splitIndex] : session.playerHand, total, bust: total > 21, autoStand: total === 21 });
});

app.post('/api/blackjack/stand', (req, res) => {
    const { wallet } = req.body;
    const session = bjSessions.get(wallet);
    if (!session || session.done) return res.status(400).json({ error: 'No active session' });

    if (session.splitHands && session.splitIndex === 0) {
        session.splitIndex = 1;
        return res.json({ nextSplit: true, currentHand: session.splitHands[1], currentTotal: handTotal(session.splitHands[1]) });
    }
    return resolveRound(wallet, session, res);
});

app.post('/api/blackjack/double', (req, res) => {
    const { wallet } = req.body;
    const session = bjSessions.get(wallet);
    if (!session || session.done) return res.status(400).json({ error: 'No active session' });

    const bal = getBalance(wallet);
    if (bal < session.bet) return res.status(400).json({ error: 'Insufficient balance to double' });

    setBalance(wallet, bal - session.bet);
    session.bet *= 2;

    const hand = session.splitHands ? session.splitHands[session.splitIndex] : session.playerHand;
    hand.push(session.deck.pop());
    return resolveRound(wallet, session, res);
});

app.post('/api/blackjack/split', (req, res) => {
    const { wallet } = req.body;
    const session = bjSessions.get(wallet);
    if (!session || session.done) return res.status(400).json({ error: 'No active session' });

    const bal = getBalance(wallet);
    if (bal < session.bet) return res.status(400).json({ error: 'Insufficient balance to split' });
    if (session.playerHand[0].r !== session.playerHand[1].r) return res.status(400).json({ error: 'Cannot split' });

    setBalance(wallet, bal - session.bet);
    session.splitHands = [
        [session.playerHand[0], session.deck.pop()],
        [session.playerHand[1], session.deck.pop()]
    ];
    session.splitIndex = 0;

    res.json({ splitHands: session.splitHands, totals: session.splitHands.map(handTotal), balance: getBalance(wallet) });
});

function resolveRound(wallet, session, res) {
    // Dealer hits soft 17 (house edge for ~98% RTP)
    while (handTotal(session.dealerHand) < 17 ||
           (handTotal(session.dealerHand) === 17 && session.dealerHand.some(c => c.r === 'A') && handTotal(session.dealerHand) <= 17)) {
        session.dealerHand.push(session.deck.pop());
        if (handTotal(session.dealerHand) > 21) break;
    }

    const dealerTotal = handTotal(session.dealerHand);
    const dealerBJ = session.dealerHand.length === 2 && dealerTotal === 21;
    const hands = session.splitHands || [session.playerHand];
    const isSplit = !!session.splitHands;
    let totalDelta = 0;
    let wins = 0, losses = 0, pushes = 0;

    for (const hand of hands) {
        const p = handTotal(hand);
        const bj = hand.length === 2 && p === 21 && !isSplit;
        if (p > 21) {
            losses++;
        } else if (dealerTotal > 21 || p > dealerTotal) {
            // BJ pays 6:5 (not 3:2) — this is the primary house edge source for 98% RTP
            const payout = bj ? session.bet * 1.2 : session.bet;
            totalDelta += session.bet + payout;
            wins++;
        } else if (p === dealerTotal) {
            totalDelta += session.bet; // push
            pushes++;
        } else {
            losses++;
        }
    }

    if (session.insuranceTaken) {
        if (dealerBJ) {
            totalDelta += session.insuranceBet * 3;
        }
    }

    const bal = getBalance(wallet);
    setBalance(wallet, bal + totalDelta);
    session.done = true;
    saveState();

    // record each hand as a bet
    hands.forEach(hand => {
        const p = handTotal(hand);
        const didWin = p <= 21 && (dealerTotal > 21 || p > dealerTotal);
        addBet('Blackjack', wallet, didWin, session.bet / hands.length, didWin ? 2 : 0);
    });

    let outcome;
    if (wins > 0 && losses === 0) outcome = 'win';
    else if (losses > 0 && wins === 0) outcome = 'lose';
    else if (pushes === hands.length) outcome = 'push';
    else outcome = wins > losses ? 'win' : 'lose';

    res.json({
        dealerHand: session.dealerHand,
        dealerTotal,
        playerHands: hands,
        playerTotals: hands.map(handTotal),
        outcome,
        totalDelta: parseFloat(totalDelta.toFixed(6)),
        balance: getBalance(wallet)
    });
}

// ── Session restore ──────────────────────────────────────────────────────────
app.get('/api/blackjack/session/:wallet', (req, res) => {
    const session = bjSessions.get(req.params.wallet);
    if (!session || session.done) return res.json({ active: false });
    res.json({
        active: true,
        bet: session.bet,
        playerHand: session.playerHand,
        dealerUp: session.dealerHand[0],
        splitHands: session.splitHands,
        splitIndex: session.splitIndex,
        isSplit: !!session.splitHands,
        balance: getBalance(req.params.wallet)
    });
});

// ── Coin Flip (98% RTP) ─────────────────────────────────────────────────────────
app.post('/api/flip', (req, res) => {
    const { wallet, bet, side } = req.body;
    if (!wallet) return res.status(400).json({ error: 'wallet required' });
    if (side !== 'heads' && side !== 'tails') return res.status(400).json({ error: 'side must be heads or tails' });

    const betAmt = parseFloat(bet) || 0;
    const bal = getBalance(wallet);
    if (betAmt < 0 || betAmt > bal) return res.status(400).json({ error: 'Insufficient balance' });

    const roll = crypto.randomInt(0, 10000);
    const result = roll < 5000 ? 'heads' : 'tails';
    const won = result === side;
    const multiplier = 1.98;
    const delta = won ? betAmt * (multiplier - 1) : -betAmt;

    setBalance(wallet, bal + delta);
    addBet('Flip', wallet, won, betAmt, won ? multiplier : 0);

    res.json({ result, won, multiplier, delta: parseFloat(delta.toFixed(6)), balance: getBalance(wallet) });
});

// ── Plinko ───────────────────────────────────────────────────────────────────
const PLINKO_MULTIPLIERS = {
    low:    { 8:[5.6,2.1,1.1,1,0.5,1,1.1,2.1,5.6], 12:[8.9,3,1.4,1.1,1,0.5,1,1.1,1.4,3,8.9], 16:[15,8,3,1.5,1.1,1,0.5,0.3,0.5,1,1.1,1.5,3,8,15] },
    medium: { 8:[13,3,1.3,0.7,0.4,0.7,1.3,3,13], 12:[24,6,2,1.4,0.6,0.4,0.6,1.4,2,6,24], 16:[110,41,10,5,3,1.5,1,0.5,0.3,0.5,1,1.5,3,5,10,41,110] },
    high:   { 8:[29,4,1.5,0.3,0.2,0.3,1.5,4,29], 12:[170,24,8.1,2,0.7,0.2,0.7,2,8.1,24,170], 16:[1000,130,26,9,4,2,0.2,0.2,0.2,0.2,0.2,2,4,9,26,130,1000] }
};

app.post('/api/plinko', (req, res) => {
    const { wallet, bet, rows, risk } = req.body;
    if (!wallet) return res.status(400).json({ error: 'wallet required' });
    const betAmt = parseFloat(bet) || 0;
    const bal = getBalance(wallet);
    if (betAmt < 0 || betAmt > bal) return res.status(400).json({ error: 'Insufficient balance' });

    // Simulate ball path through pegs
    let pos = 0;
    const numRows = parseInt(rows) || 16;
    for (let i = 0; i < numRows; i++) {
        pos += crypto.randomInt(0, 2); // 0 = left, 1 = right
    }
    const mults = PLINKO_MULTIPLIERS[risk]?.[numRows] || PLINKO_MULTIPLIERS.high[16];
    const multiplier = mults[Math.min(pos, mults.length - 1)];
    const payout = parseFloat((betAmt * multiplier).toFixed(6));
    const delta = payout - betAmt;

    setBalance(wallet, bal + delta);
    addBet('Plinko', wallet, payout >= betAmt, betAmt, multiplier);

    res.json({ multiplier, payout, delta: parseFloat(delta.toFixed(6)), balance: getBalance(wallet) });
});


app.post('/api/settle', (req, res) => {
    const { player, game, betSig, won, multiplier, amountSol } = req.body;
    console.log(`SETTLE: ${game} player=${player?.slice(0,8)} won=${won} mult=${multiplier} bet=${amountSol}`);
    // In production: house keypair signs a payout transaction here
    res.json({ settleSig: null, treasury: TREASURY });
});

// ── Pages ────────────────────────────────────────────────────────────────────
app.get('/',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/dice',      (req, res) => res.sendFile(path.join(__dirname, 'public', 'dice.html')));
app.get('/blackjack', (req, res) => res.sendFile(path.join(__dirname, 'public', 'blackjack.html')));
app.get('/plinko',    (req, res) => res.sendFile(path.join(__dirname, 'public', 'plinko.html')));


server.listen(PORT, () => console.log(`FreeDice running on http://localhost:${PORT}`));
