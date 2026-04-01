use anchor_lang::prelude::*;

declare_id!("FreeDice11111111111111111111111111111111111");

// Game codes
pub const GAME_DICE: u8 = 1;
pub const GAME_BLACKJACK: u8 = 2;
pub const GAME_MINES: u8 = 3;
pub const GAME_CRASH: u8 = 4;
pub const GAME_PLINKO: u8 = 5;

#[program]
pub mod freedice_solana_program {
    use super::*;

    /// One-time setup: create the house vault PDA and store config.
    pub fn initialize_house(ctx: Context<InitializeHouse>, house_edge_bps: u16) -> Result<()> {
        require!(house_edge_bps <= 1_000, FreeDiceError::InvalidHouseEdge);
        let house = &mut ctx.accounts.house;
        house.authority = ctx.accounts.authority.key();
        house.house_edge_bps = house_edge_bps;
        house.bump = ctx.bumps.house;
        house.vault_bump = ctx.bumps.vault;
        Ok(())
    }

    /// Player places a bet: SOL moves player → vault, a GameRecord PDA is created.
    pub fn place_bet(ctx: Context<PlaceBet>, game: u8, wager_lamports: u64) -> Result<()> {
        require!(
            [GAME_DICE, GAME_BLACKJACK, GAME_MINES, GAME_CRASH, GAME_PLINKO].contains(&game),
            FreeDiceError::InvalidGame
        );
        require!(wager_lamports > 0, FreeDiceError::ZeroWager);

        // Transfer wager from player to vault
        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.player.key(),
            &ctx.accounts.vault.key(),
            wager_lamports,
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.player.to_account_info(),
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        let record = &mut ctx.accounts.record;
        record.player = ctx.accounts.player.key();
        record.game = game;
        record.wager_lamports = wager_lamports;
        record.payout_lamports = 0;
        record.settled = false;
        record.won = false;
        record.ts = Clock::get()?.unix_timestamp;
        record.bump = ctx.bumps.record;
        Ok(())
    }

    /// House authority settles a round: marks won/lost and pays out from vault if player won.
    pub fn settle_game(
        ctx: Context<SettleGame>,
        won: bool,
        payout_lamports: u64,
    ) -> Result<()> {
        let record = &mut ctx.accounts.record;
        require!(!record.settled, FreeDiceError::AlreadySettled);

        record.settled = true;
        record.won = won;
        record.payout_lamports = payout_lamports;

        if won && payout_lamports > 0 {
            // Vault is a PDA — use invoke_signed
            let house_key = ctx.accounts.house.key();
            let seeds: &[&[u8]] = &[b"vault", house_key.as_ref(), &[ctx.accounts.house.vault_bump]];
            let signer_seeds = &[seeds];

            let ix = anchor_lang::solana_program::system_instruction::transfer(
                &ctx.accounts.vault.key(),
                &ctx.accounts.player.key(),
                payout_lamports,
            );
            anchor_lang::solana_program::program::invoke_signed(
                &ix,
                &[
                    ctx.accounts.vault.to_account_info(),
                    ctx.accounts.player.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                signer_seeds,
            )?;
        }
        Ok(())
    }

    /// Authority can withdraw excess vault funds.
    pub fn withdraw_vault(ctx: Context<WithdrawVault>, amount_lamports: u64) -> Result<()> {
        let house_key = ctx.accounts.house.key();
        let seeds: &[&[u8]] = &[b"vault", house_key.as_ref(), &[ctx.accounts.house.vault_bump]];
        let signer_seeds = &[seeds];

        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.vault.key(),
            &ctx.accounts.authority.key(),
            amount_lamports,
        );
        anchor_lang::solana_program::program::invoke_signed(
            &ix,
            &[
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.authority.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer_seeds,
        )?;
        Ok(())
    }
}

// ── Accounts ────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeHouse<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        seeds = [b"house"],
        bump,
        space = 8 + HouseConfig::INIT_SPACE
    )]
    pub house: Account<'info, HouseConfig>,
    /// CHECK: PDA vault that holds player wagers
    #[account(
        mut,
        seeds = [b"vault", house.key().as_ref()],
        bump
    )]
    pub vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(game: u8, wager_lamports: u64)]
pub struct PlaceBet<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(seeds = [b"house"], bump = house.bump)]
    pub house: Account<'info, HouseConfig>,
    /// CHECK: vault PDA
    #[account(
        mut,
        seeds = [b"vault", house.key().as_ref()],
        bump = house.vault_bump
    )]
    pub vault: UncheckedAccount<'info>,
    #[account(
        init,
        payer = player,
        seeds = [b"record", player.key().as_ref(), &Clock::get()?.slot.to_le_bytes()],
        bump,
        space = 8 + GameRecord::INIT_SPACE
    )]
    pub record: Account<'info, GameRecord>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleGame<'info> {
    /// House authority must sign settlements
    #[account(mut, address = house.authority)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"house"], bump = house.bump)]
    pub house: Account<'info, HouseConfig>,
    /// CHECK: vault PDA
    #[account(
        mut,
        seeds = [b"vault", house.key().as_ref()],
        bump = house.vault_bump
    )]
    pub vault: UncheckedAccount<'info>,
    #[account(mut, has_one = player)]
    pub record: Account<'info, GameRecord>,
    /// CHECK: player receiving payout
    #[account(mut)]
    pub player: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawVault<'info> {
    #[account(mut, address = house.authority)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"house"], bump = house.bump)]
    pub house: Account<'info, HouseConfig>,
    /// CHECK: vault PDA
    #[account(
        mut,
        seeds = [b"vault", house.key().as_ref()],
        bump = house.vault_bump
    )]
    pub vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

// ── State ────────────────────────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct HouseConfig {
    pub authority: Pubkey,   // 32
    pub house_edge_bps: u16, // 2
    pub bump: u8,            // 1
    pub vault_bump: u8,      // 1
}

#[account]
#[derive(InitSpace)]
pub struct GameRecord {
    pub player: Pubkey,         // 32
    pub game: u8,               // 1  (1=dice 2=blackjack 3=mines 4=crash 5=plinko)
    pub wager_lamports: u64,    // 8
    pub payout_lamports: u64,   // 8
    pub won: bool,              // 1
    pub settled: bool,          // 1
    pub ts: i64,                // 8
    pub bump: u8,               // 1
}

// ── Errors ───────────────────────────────────────────────────────────────────

#[error_code]
pub enum FreeDiceError {
    #[msg("Invalid house edge value")]
    InvalidHouseEdge,
    #[msg("Invalid game code")]
    InvalidGame,
    #[msg("Wager must be greater than zero")]
    ZeroWager,
    #[msg("Game record already settled")]
    AlreadySettled,
}
