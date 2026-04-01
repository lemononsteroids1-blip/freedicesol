# FreeDice Casino Upgrade

This version includes:

- A new homepage at `/`
- Dice game at `/dice`
- Blackjack game at `/blackjack`
- Plinko game at `/plinko`
- Crash game at `/crash`
- Mines game at `/mines`
- Solana Phantom wallet connect support
- Bet-sized on-chain Phantom transactions to a treasury wallet
- A starter Anchor smart contract at `contracts/freedice_solana_program.rs`
- Vercel deploy support with `vercel.json` + `api/config`

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Deploy on Vercel

Set these environment variables in Vercel:

- `SOLANA_CLUSTER` (example: `devnet` or `mainnet-beta`)
- `TREASURY_WALLET` (your treasury public key)

Then deploy normally with Vercel. Static game pages and `/api/config` are configured.

## Solana notes

- Bets are sent on-chain from player wallet to treasury using `SystemProgram.transfer`.
- A memo instruction is attached for game metadata/audit trail.
- For full trust-minimized payouts, deploy the Anchor program and connect game actions to PDAs and vault escrow logic.
- The provided contract is a secure starter for house config and immutable game records.
