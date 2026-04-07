(() => {
    const LAMPORTS_PER_SOL = 1_000_000_000;
    const MEMO_PROGRAM_ID = new solanaWeb3.PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

    const state = {
        connection: null,
        wallet: null,
        publicKey: null,
        cluster: 'devnet',
        treasury: null,
        rpcUrl: 'https://api.devnet.solana.com'
    };

    const WALLET_REGISTRY = [
        { name: 'Phantom',        icon: 'https://raw.githubusercontent.com/solana-labs/wallet-adapter/master/packages/wallets/phantom/src/icon.png',   url: 'https://phantom.app',           detect: () => window.phantom?.solana ?? (window.solana?.isPhantom ? window.solana : null) },
        { name: 'Solflare',       icon: 'https://raw.githubusercontent.com/solana-labs/wallet-adapter/master/packages/wallets/solflare/src/icon.png',  url: 'https://solflare.com',          detect: () => window.solflare?.isSolflare ? window.solflare : null },
        { name: 'Backpack',       icon: 'https://raw.githubusercontent.com/solana-labs/wallet-adapter/master/packages/wallets/backpack/src/icon.png',  url: 'https://backpack.app',          detect: () => window.backpack?.isBackpack ? window.backpack : null },
        { name: 'Glow',           icon: 'https://raw.githubusercontent.com/solana-labs/wallet-adapter/master/packages/wallets/glow/src/icon.png',      url: 'https://glow.app',              detect: () => window.glowSolana ?? window.glow?.solana ?? null },
        { name: 'Coinbase Wallet',icon: 'https://raw.githubusercontent.com/solana-labs/wallet-adapter/master/packages/wallets/coinbase/src/icon.png',  url: 'https://www.coinbase.com/wallet',detect: () => window.coinbaseSolana ?? null },
        { name: 'Trust Wallet',   icon: 'https://raw.githubusercontent.com/solana-labs/wallet-adapter/master/packages/wallets/trust/src/icon.png',    url: 'https://trustwallet.com',       detect: () => window.trustwallet?.solana ?? null },
        { name: 'Brave Wallet',   icon: 'https://raw.githubusercontent.com/solana-labs/wallet-adapter/master/packages/wallets/brave/src/icon.png',    url: 'https://brave.com/wallet',      detect: () => window.braveSolana ?? null },
        { name: 'Exodus',         icon: 'https://raw.githubusercontent.com/solana-labs/wallet-adapter/master/packages/wallets/exodus/src/icon.png',   url: 'https://exodus.com',            detect: () => window.exodus?.solana ?? null }
    ];

    function _getDetected() { return WALLET_REGISTRY.filter(w => w.detect() !== null); }

    async function loadConfig() {
        try {
            const res = await fetch('/api/config');
            const cfg = await res.json();
            if (cfg.cluster) state.cluster = cfg.cluster;
            if (cfg.rpcUrl)  state.rpcUrl  = cfg.rpcUrl;
            if (cfg.treasury) state.treasury = new solanaWeb3.PublicKey(cfg.treasury);
        } catch (_) {}
    }

    async function initSolana() {
        await loadConfig();
        // Try multiple public RPCs for tx sending — wallet provider handles signing
        const rpcs = state.cluster === 'mainnet-beta'
            ? [
                'https://rpc.ankr.com/solana',
                'https://mainnet.helius-rpc.com/?api-key=15319bf2-6d8c-4e58-a8e5-f95f0e650b3e',
                'https://api.mainnet-beta.solana.com'
              ]
            : ['https://api.devnet.solana.com'];
        for (const rpc of rpcs) {
            try {
                const conn = new solanaWeb3.Connection(rpc, 'confirmed');
                await conn.getLatestBlockhash('finalized');
                state.connection = conn;
                console.log('Using RPC:', rpc);
                break;
            } catch (_) {}
        }
        if (!state.connection) state.connection = new solanaWeb3.Connection(rpcs[rpcs.length - 1], 'confirmed');
        await _tryAutoConnect();
    }

    async function _tryAutoConnect() {
        const savedName = localStorage.getItem('fd_wallet');
        if (!savedName) return;
        const entry = WALLET_REGISTRY.find(w => w.name === savedName);
        if (!entry) return;
        const provider = entry.detect();
        if (!provider) return;
        try {
            const resp = await provider.connect({ onlyIfTrusted: true });
            if (!resp?.publicKey) return;
            state.wallet    = provider;
            state.publicKey = resp.publicKey;
            localStorage.setItem('fd_pubkey', state.publicKey.toBase58());
        } catch (_) {
            const saved = localStorage.getItem('fd_pubkey');
            if (saved) try { state.publicKey = new solanaWeb3.PublicKey(saved); } catch (_) {}
        }
    }

    // ── Wallet modal ──────────────────────────────────────────────────────────
    function _injectStyles() {
        if (document.getElementById('wam-styles')) return;
        const s = document.createElement('style');
        s.id = 'wam-styles';
        s.textContent = `
            #wam-overlay{position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:99999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);}
            #wam-modal{background:#13161f;border:1px solid #2a2f3e;border-radius:20px;width:380px;max-width:94vw;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.7);}
            #wam-header{padding:20px 24px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #1e2330;}
            #wam-header h2{color:#fff;font-size:17px;font-weight:700;font-family:Inter,sans-serif;margin:0;}
            #wam-close{background:none;border:none;color:#8b949e;font-size:22px;cursor:pointer;line-height:1;padding:0;}
            #wam-close:hover{color:#fff;}
            #wam-list{padding:12px;}
            .wam-item{display:flex;align-items:center;gap:14px;padding:12px 14px;border-radius:12px;cursor:pointer;transition:background .12s;}
            .wam-item:hover{background:#1e2330;}
            .wam-item img{width:36px;height:36px;border-radius:8px;object-fit:contain;background:#fff;padding:2px;flex-shrink:0;}
            .wam-item-name{color:#fff;font-size:15px;font-weight:600;font-family:Inter,sans-serif;}
            .wam-item-badge{margin-left:auto;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;}
            .wam-detected{background:rgba(99,102,241,.18);color:#818cf8;}
            .wam-install{background:#1e2330;color:#8b949e;}
            #wam-footer{padding:14px 24px;border-top:1px solid #1e2330;text-align:center;font-size:12px;color:#8b949e;font-family:Inter,sans-serif;}
            #wam-footer a{color:#818cf8;text-decoration:none;}
        `;
        document.head.appendChild(s);
    }

    function _showModal() {
        return new Promise((resolve, reject) => {
            _injectStyles();
            const detected   = _getDetected();
            const undetected = WALLET_REGISTRY.filter(w => w.detect() === null);
            const overlay = document.createElement('div');
            overlay.id = 'wam-overlay';
            overlay.innerHTML = `
                <div id="wam-modal">
                    <div id="wam-header"><h2>Connect Wallet</h2><button id="wam-close">✕</button></div>
                    <div id="wam-list">
                        ${detected.map(w => `<div class="wam-item" data-wallet="${w.name}"><img src="${w.icon}" alt="${w.name}"><span class="wam-item-name">${w.name}</span><span class="wam-item-badge wam-detected">Detected</span></div>`).join('')}
                        ${undetected.map(w => `<div class="wam-item" data-wallet="${w.name}" data-url="${w.url}"><img src="${w.icon}" alt="${w.name}"><span class="wam-item-name">${w.name}</span><span class="wam-item-badge wam-install">Install</span></div>`).join('')}
                    </div>
                    <div id="wam-footer">New to Solana? <a href="https://phantom.app" target="_blank">Get Phantom →</a></div>
                </div>`;
            document.body.appendChild(overlay);
            overlay.querySelectorAll('.wam-item').forEach(el => {
                el.addEventListener('click', () => {
                    const entry    = WALLET_REGISTRY.find(w => w.name === el.dataset.wallet);
                    const provider = entry?.detect();
                    if (!provider) { window.open(el.dataset.url, '_blank'); return; }
                    overlay.remove();
                    resolve({ provider, name: el.dataset.wallet });
                });
            });
            document.getElementById('wam-close').addEventListener('click', () => { overlay.remove(); reject(new Error('Cancelled')); });
            overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); reject(new Error('Cancelled')); } });
        });
    }

    // ── Public API ────────────────────────────────────────────────────────────

    async function connectWallet() {
        const detected = _getDetected();
        let provider, name;
        if (detected.length === 1) { provider = detected[0].detect(); name = detected[0].name; }
        else { const r = await _showModal(); provider = r.provider; name = r.name; }
        localStorage.setItem('fd_wallet', name);
        state.wallet = provider;
        const resp = await provider.connect();
        state.publicKey = resp.publicKey;
        const addr = state.publicKey.toBase58();
        localStorage.setItem('fd_pubkey', addr);
        return addr;
    }

    async function ensureWallet() {
        if (state.wallet && state.publicKey) return;
        // Try silent reconnect first
        const savedName = localStorage.getItem('fd_wallet');
        const entry     = savedName ? WALLET_REGISTRY.find(w => w.name === savedName) : null;
        const provider  = entry?.detect();
        if (provider) {
            try {
                const resp = await provider.connect({ onlyIfTrusted: true });
                if (resp?.publicKey) { state.wallet = provider; state.publicKey = resp.publicKey; return; }
            } catch (_) {}
            // Not pre-approved — show popup
            const resp = await provider.connect();
            state.wallet    = provider;
            state.publicKey = resp.publicKey;
            localStorage.setItem('fd_pubkey', state.publicKey.toBase58());
            return;
        }
        // No saved wallet — show picker modal
        const r = await _showModal();
        localStorage.setItem('fd_wallet', r.name);
        state.wallet = r.provider;
        const resp2 = await r.provider.connect();
        state.publicKey = resp2.publicKey;
        localStorage.setItem('fd_pubkey', state.publicKey.toBase58());
    }

    function getPublicKey() { return state.publicKey ? state.publicKey.toBase58() : null; }
    function isConnected()  { return !!state.publicKey; }

    async function getSolBalance() {
        if (!state.publicKey) return 0;
        try {
            const res  = await fetch(`/api/sol-balance/${state.publicKey.toBase58()}`);
            const json = await res.json();
            if (json?.sol !== undefined) return json.sol;
        } catch (_) {}
        return 0;
    }

    async function _sendTx(instructions) {
        await ensureWallet();
        const tx = new solanaWeb3.Transaction();
        instructions.forEach(ix => tx.add(ix));
        tx.feePayer = state.publicKey;
        // Get blockhash via server proxy to avoid CORS 403
        const bh = await fetch('/api/blockhash').then(r => r.json());
        if (bh.error) throw new Error(bh.error);
        tx.recentBlockhash = bh.blockhash;
        const signed = await state.wallet.signTransaction(tx);
        const txBase64 = Buffer.from(signed.serialize()).toString('base64');
        // Send via server proxy
        const sent = await fetch('/api/send-tx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tx: txBase64 })
        }).then(r => r.json());
        if (sent.error) throw new Error(sent.error);
        // Confirm via server proxy
        const confirmed = await fetch('/api/confirm-tx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sig: sent.sig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight })
        }).then(r => r.json());
        if (confirmed.error) throw new Error(confirmed.error);
        return sent.sig;
    }

    function _memoIx(obj) {
        return new solanaWeb3.TransactionInstruction({
            keys: [], programId: MEMO_PROGRAM_ID,
            data: new TextEncoder().encode(JSON.stringify({ app: 'freedice', ...obj, ts: Date.now() }))
        });
    }

    async function placeBetOnChain(gameName, amountSol) {
        await ensureWallet();
        if (!state.treasury) throw new Error('Treasury not configured.');
        const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
        const ixs = [];
        if (lamports > 0) {
            ixs.push(solanaWeb3.SystemProgram.transfer({ fromPubkey: state.publicKey, toPubkey: state.treasury, lamports }));
        }
        ixs.push(_memoIx({ game: gameName, type: 'bet', amountSol }));
        const sig = await _sendTx(ixs);
        if (lamports > 0) {
            const r = await fetch('/api/deposit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallet: state.publicKey.toBase58(), sig }) });
            const d = await r.json();
            if (d.error) throw new Error(d.error);
        }
        return { sig, lamports };
    }

    window.FreeDiceSolana = { initSolana, connectWallet, ensureWallet, isConnected, getPublicKey, placeBetOnChain, getSolBalance };
})();
