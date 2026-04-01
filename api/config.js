module.exports = (req, res) => {
    const cluster = process.env.SOLANA_CLUSTER || "devnet";
    const treasury = process.env.TREASURY_WALLET || "11111111111111111111111111111111";
    res.status(200).json({ cluster, treasury });
};
