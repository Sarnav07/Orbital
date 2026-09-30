//! Orbital on Solana: one reserve book behind every pair of four stablecoins.
//!
//! The maths is `orbital-math`, a line-for-line port of the Solidity engine checked
//! against the same test vectors. Swaps are planned off-chain
//! (`orbital_math::segmented::plan_swap`) and settled here by
//! `orbital_math::settle::settle_swap`, because solving the invariant on-chain does not
//! fit Solana's compute limit. v1 supports the classic SPL Token program.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};
use orbital_math::U256;
use orbital_math::fee_book::PositionFees;
use orbital_math::segmented::{Segment, Tick, aggregate};
use orbital_math::settle::MAX_SEGMENTS;
use orbital_math::{token_units, torus};

pub mod book;
pub mod error;
pub mod state;

use error::{OrbitalError, math};
use state::{MAX_RANGES, Pool, Position, put_u128, u128_of};

declare_id!("3tXo8oWf1LzpyUTd9bTQV84XLMw8LepMWjewy9VkKWsF");

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct RangeArg {
    pub radius: u128,
    pub k: u128,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct SegmentArg {
    pub amount_in: u128,
    pub amount_out: u128,
}

#[event]
pub struct SwapEvent {
    pub pool: Pubkey,
    pub input: u8,
    pub output: u8,
    pub amount_in: u64,
    pub amount_out: u64,
    pub fee: u64,
    pub crossings: u32,
}

#[program]
pub mod orbital {
    use super::*;

    /// Creates the pool for four mints (strictly increasing addresses) with its ranges
    /// and starting book coordinates, which must lie on the invariant.
    pub fn initialize_pool(ctx: Context<InitializePool>, ranges: Vec<RangeArg>, reserves: [u128; 4], fee_ppm: u32) -> Result<()> {
        require!(fee_ppm < book::FEE_DENOMINATOR, OrbitalError::InvalidFee);
        require!(!ranges.is_empty() && ranges.len() <= MAX_RANGES, OrbitalError::InvalidRangeSet);
        let mints = [&ctx.accounts.mint0, &ctx.accounts.mint1, &ctx.accounts.mint2, &ctx.accounts.mint3];
        for pair in mints.windows(2) {
            require!(pair[0].key() < pair[1].key(), OrbitalError::InvalidMintSet);
        }
        let mut decimals = [0u8; 4];
        for (slot, mint) in decimals.iter_mut().zip(mints) {
            token_units::scale(mint.decimals).map_err(math)?;
            *slot = mint.decimals;
        }

        let ticks: Vec<Tick> = ranges
            .iter()
            .map(|r| Tick { radius: U256::new(r.radius), k: U256::new(r.k), is_interior: true })
            .collect();
        let state = aggregate(&ticks).map_err(math)?;
        let book = reserves.map(U256::new);
        require!(torus::is_invariant(&state, &book).map_err(math)?, OrbitalError::InvalidInitialState);
        let virtual_sum = book::virtual_offsets(&ticks)?;
        book::require_inventory(&book, virtual_sum)?;

        let pool = &mut ctx.accounts.pool.load_init()?;
        pool.authority = ctx.accounts.authority.key();
        pool.mints = mints.map(|m| m.key());
        pool.decimals = decimals;
        pool.fee_ppm = fee_ppm.to_le_bytes();
        pool.range_count = ranges.len() as u8;
        pool.set_ticks(&ticks)?;
        pool.set_reserves(&book)?;
        pool.virtual_sum = put_u128(virtual_sum)?;
        pool.bump = ctx.bumps.pool;
        Ok(())
    }

    /// Creates the pool-owned token account for one of the four mints.
    pub fn create_vault(ctx: Context<CreateVault>, index: u8) -> Result<()> {
        let pool = &mut ctx.accounts.pool.load_mut()?;
        require!(index < 4, OrbitalError::InvalidAsset);
        require!(pool.mints[usize::from(index)] == ctx.accounts.mint.key(), OrbitalError::WrongAccount);
        pool.vaults[usize::from(index)] = ctx.accounts.vault.key();
        pool.vault_bumps[usize::from(index)] = ctx.bumps.vault;
        Ok(())
    }

    /// Opens an empty LP position in one range for the signer.
    pub fn open_position(ctx: Context<OpenPosition>, range_id: u8) -> Result<()> {
        let pool = ctx.accounts.pool.load()?;
        require!(range_id < pool.range_count, OrbitalError::InvalidRange);
        let position = &mut ctx.accounts.position;
        position.pool = ctx.accounts.pool.key();
        position.owner = ctx.accounts.owner.key();
        position.range_id = range_id;
        position.bump = ctx.bumps.position;
        Ok(())
    }

    /// Funds every range's real inventory once. Each range mints one share per WAD of
    /// radius; `MIN_LOCKED_SHARES` of each is locked forever. Remaining accounts: the
    /// authority's open position for each range, in range order.
    pub fn seed<'info>(ctx: Context<'info, Seed<'info>>) -> Result<()> {
        let amounts;
        {
            let pool = &mut ctx.accounts.pool.load_mut()?;
            require!(pool.seeded == 0, OrbitalError::AlreadySeeded);
            ctx.accounts.basket.check(pool, &ctx.accounts.authority.key())?;
            require!(ctx.remaining_accounts.len() == usize::from(pool.range_count), OrbitalError::WrongAccount);
            pool.seeded = 1;
            amounts = book::seed_amounts(pool)?;
            let pool_key = ctx.accounts.pool.key();
            for (range, info) in ctx.remaining_accounts.iter().enumerate() {
                let mut position: Account<Position> = Account::try_from(info)?;
                require!(
                    position.pool == pool_key
                        && position.owner == ctx.accounts.authority.key()
                        && usize::from(position.range_id) == range,
                    OrbitalError::WrongAccount
                );
                let shares = u128_of(&pool.radius[range]);
                require!(shares > book::MIN_LOCKED_SHARES, OrbitalError::InvalidInitialState);
                let mut locked = PositionFees::default();
                book::mint_shares(pool, range, &mut locked, book::MIN_LOCKED_SHARES)?;
                let mut fees = position.fees();
                book::mint_shares(pool, range, &mut fees, shares - book::MIN_LOCKED_SHARES)?;
                position.set_fees(&fees)?;
                position.exit(&crate::ID)?;
            }
        }
        let authority = ctx.accounts.authority.to_account_info();
        ctx.accounts.basket.pull(&ctx.accounts.token_program, &authority, &amounts)
    }

    /// Exact-input swap. `segments` come from `orbital_math::segmented::plan_swap` on the
    /// pool's current state and must sum to the input after the fee, in WAD.
    pub fn swap(
        ctx: Context<Swap>,
        input: u8,
        output: u8,
        amount_in: u64,
        min_amount_out: u64,
        deadline: i64,
        segments: Vec<SegmentArg>,
    ) -> Result<()> {
        check_deadline(deadline)?;
        require!(!segments.is_empty() && segments.len() <= MAX_SEGMENTS, OrbitalError::InvalidRangeSet);
        let segments: Vec<Segment> = segments
            .iter()
            .map(|s| Segment { amount_in: U256::new(s.amount_in), amount_out: U256::new(s.amount_out) })
            .collect();
        let (outcome, decimals_in, decimals_out, signer) = {
            let pool = &mut ctx.accounts.pool.load_mut()?;
            require!(input < 4 && output < 4 && input != output, OrbitalError::InvalidAsset);
            let (i, o) = (usize::from(input), usize::from(output));
            require!(ctx.accounts.vault_in.key() == pool.vaults[i], OrbitalError::WrongAccount);
            require!(ctx.accounts.vault_out.key() == pool.vaults[o], OrbitalError::WrongAccount);
            require!(ctx.accounts.mint_in.key() == pool.mints[i], OrbitalError::WrongAccount);
            require!(ctx.accounts.mint_out.key() == pool.mints[o], OrbitalError::WrongAccount);
            let outcome = book::swap(pool, input, output, amount_in, &segments)?;
            require!(outcome.amount_out >= min_amount_out, OrbitalError::SlippageExceeded);
            (outcome, pool.decimals[i], pool.decimals[o], PoolSigner::of(pool))
        };
        let program = ctx.accounts.token_program.key();
        token::transfer_checked(
            CpiContext::new(
                program,
                TransferChecked {
                    from: ctx.accounts.user_source.to_account_info(),
                    mint: ctx.accounts.mint_in.to_account_info(),
                    to: ctx.accounts.vault_in.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount_in,
            decimals_in,
        )?;
        if outcome.amount_out > 0 {
            token::transfer_checked(
                CpiContext::new_with_signer(
                    program,
                    TransferChecked {
                        from: ctx.accounts.vault_out.to_account_info(),
                        mint: ctx.accounts.mint_out.to_account_info(),
                        to: ctx.accounts.user_destination.to_account_info(),
                        authority: ctx.accounts.pool.to_account_info(),
                    },
                    &[&signer.seeds()],
                ),
                outcome.amount_out,
                decimals_out,
            )?;
        }
        emit!(SwapEvent {
            pool: ctx.accounts.pool.key(),
            input,
            output,
            amount_in,
            amount_out: outcome.amount_out,
            fee: outcome.fee,
            crossings: outcome.crossings,
        });
        Ok(())
    }

    /// Mints `shares` of one range by depositing that range's current basket.
    pub fn add_liquidity(ctx: Context<Liquidity>, shares: u128, max_amounts_in: [u64; 4], deadline: i64) -> Result<()> {
        check_deadline(deadline)?;
        let amounts = {
            let pool = &mut ctx.accounts.pool.load_mut()?;
            ctx.accounts.basket.check(pool, &ctx.accounts.owner.key())?;
            let range = usize::from(ctx.accounts.position.range_id);
            let shares = U256::new(shares);
            let change = book::preview_range_change(pool, range, shares, true)?;
            for (amount, max) in change.amounts.iter().zip(max_amounts_in) {
                require!(*amount <= U256::new(u128::from(max)), OrbitalError::SlippageExceeded);
            }
            book::apply_range_change(pool, range, &change)?;
            let mut fees = ctx.accounts.position.fees();
            book::mint_shares(pool, range, &mut fees, shares)?;
            ctx.accounts.position.set_fees(&fees)?;
            change.amounts
        };
        let owner = ctx.accounts.owner.to_account_info();
        ctx.accounts.basket.pull(&ctx.accounts.token_program, &owner, &amounts)
    }

    /// Burns `shares` of one range and withdraws that range's real inventory.
    pub fn remove_liquidity(ctx: Context<Liquidity>, shares: u128, min_amounts_out: [u64; 4], deadline: i64) -> Result<()> {
        check_deadline(deadline)?;
        let (amounts, signer) = {
            let pool = &mut ctx.accounts.pool.load_mut()?;
            ctx.accounts.basket.check(pool, &ctx.accounts.owner.key())?;
            require!(shares <= ctx.accounts.position.shares, OrbitalError::InsufficientShares);
            let range = usize::from(ctx.accounts.position.range_id);
            let shares = U256::new(shares);
            let change = book::preview_range_change(pool, range, shares, false)?;
            for (amount, min) in change.amounts.iter().zip(min_amounts_out) {
                require!(*amount >= U256::new(u128::from(min)), OrbitalError::SlippageExceeded);
            }
            book::apply_range_change(pool, range, &change)?;
            let mut fees = ctx.accounts.position.fees();
            book::burn_shares(pool, range, &mut fees, shares)?;
            ctx.accounts.position.set_fees(&fees)?;
            (change.amounts, PoolSigner::of(pool))
        };
        ctx.accounts.basket.push(&ctx.accounts.token_program, &ctx.accounts.pool.to_account_info(), &signer, &amounts)
    }

    /// Pays the position's accrued swap fees to the owner's token accounts.
    pub fn collect_fees(ctx: Context<Liquidity>) -> Result<()> {
        let (amounts, signer) = {
            let pool = &mut ctx.accounts.pool.load_mut()?;
            ctx.accounts.basket.check(pool, &ctx.accounts.owner.key())?;
            let range = usize::from(ctx.accounts.position.range_id);
            let mut fees = ctx.accounts.position.fees();
            let amounts = book::collect(pool, range, &mut fees)?;
            ctx.accounts.position.set_fees(&fees)?;
            (amounts, PoolSigner::of(pool))
        };
        ctx.accounts.basket.push(&ctx.accounts.token_program, &ctx.accounts.pool.to_account_info(), &signer, &amounts)
    }
}

fn check_deadline(deadline: i64) -> Result<()> {
    if deadline != 0 {
        require!(Clock::get()?.unix_timestamp <= deadline, OrbitalError::Expired);
    }
    Ok(())
}

/// The pool PDA's signer seeds, copied out so the pool borrow can end before a CPI.
pub struct PoolSigner {
    mints: [Pubkey; 4],
    bump: [u8; 1],
}

impl PoolSigner {
    fn of(pool: &Pool) -> Self {
        Self { mints: pool.mints, bump: [pool.bump] }
    }

    fn seeds(&self) -> [&[u8]; 6] {
        [
            Pool::SEED,
            self.mints[0].as_ref(),
            self.mints[1].as_ref(),
            self.mints[2].as_ref(),
            self.mints[3].as_ref(),
            &self.bump,
        ]
    }
}

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + core::mem::size_of::<Pool>(),
        seeds = [Pool::SEED, mint0.key().as_ref(), mint1.key().as_ref(), mint2.key().as_ref(), mint3.key().as_ref()],
        bump,
    )]
    pub pool: AccountLoader<'info, Pool>,
    pub mint0: Box<Account<'info, Mint>>,
    pub mint1: Box<Account<'info, Mint>>,
    pub mint2: Box<Account<'info, Mint>>,
    pub mint3: Box<Account<'info, Mint>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(index: u8)]
pub struct CreateVault<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority)]
    pub pool: AccountLoader<'info, Pool>,
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        payer = authority,
        seeds = [Pool::VAULT_SEED, pool.key().as_ref(), &[index]],
        bump,
        token::mint = mint,
        token::authority = pool,
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(range_id: u8)]
pub struct OpenPosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    pub pool: AccountLoader<'info, Pool>,
    #[account(
        init,
        payer = owner,
        space = 8 + Position::INIT_SPACE,
        seeds = [Position::SEED, pool.key().as_ref(), &[range_id], owner.key().as_ref()],
        bump,
    )]
    pub position: Account<'info, Position>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Seed<'info> {
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority)]
    pub pool: AccountLoader<'info, Pool>,
    pub basket: Basket<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Swap<'info> {
    pub user: Signer<'info>,
    #[account(mut)]
    pub pool: AccountLoader<'info, Pool>,
    #[account(mut, token::mint = mint_in, token::authority = user)]
    pub user_source: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint_out)]
    pub user_destination: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub vault_in: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub vault_out: Box<Account<'info, TokenAccount>>,
    pub mint_in: Box<Account<'info, Mint>>,
    pub mint_out: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Liquidity<'info> {
    pub owner: Signer<'info>,
    #[account(mut)]
    pub pool: AccountLoader<'info, Pool>,
    #[account(
        mut,
        has_one = owner,
        has_one = pool,
        seeds = [Position::SEED, pool.key().as_ref(), &[position.range_id], owner.key().as_ref()],
        bump = position.bump,
    )]
    pub position: Box<Account<'info, Position>>,
    pub basket: Basket<'info>,
    pub token_program: Program<'info, Token>,
}

/// The four vaults, their mints and the user's four token accounts, in mint order.
#[derive(Accounts)]
pub struct Basket<'info> {
    #[account(mut)]
    pub user0: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub user1: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub user2: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub user3: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub vault0: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub vault1: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub vault2: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub vault3: Box<Account<'info, TokenAccount>>,
    pub mint0: Box<Account<'info, Mint>>,
    pub mint1: Box<Account<'info, Mint>>,
    pub mint2: Box<Account<'info, Mint>>,
    pub mint3: Box<Account<'info, Mint>>,
}

impl<'info> Basket<'info> {
    fn users(&self) -> [&Account<'info, TokenAccount>; 4] {
        [&self.user0, &self.user1, &self.user2, &self.user3]
    }

    fn vaults(&self) -> [&Account<'info, TokenAccount>; 4] {
        [&self.vault0, &self.vault1, &self.vault2, &self.vault3]
    }

    fn mints(&self) -> [&Account<'info, Mint>; 4] {
        [&self.mint0, &self.mint1, &self.mint2, &self.mint3]
    }

    /// Vaults and mints are the pool's, and the user accounts hold the right mints.
    /// Deposits must come from the signer's own accounts; payouts may go anywhere.
    fn check(&self, pool: &Pool, _signer: &Pubkey) -> Result<()> {
        for i in 0..4 {
            require!(self.vaults()[i].key() == pool.vaults[i], OrbitalError::WrongAccount);
            require!(self.mints()[i].key() == pool.mints[i], OrbitalError::WrongAccount);
            require!(self.users()[i].mint == pool.mints[i], OrbitalError::WrongAccount);
        }
        Ok(())
    }

    fn pull(&self, token_program: &Program<'info, Token>, authority: &AccountInfo<'info>, amounts: &[U256; 4]) -> Result<()> {
        for i in 0..4 {
            let amount = state::to_u64(amounts[i])?;
            if amount == 0 {
                continue;
            }
            require!(self.users()[i].owner == authority.key(), OrbitalError::WrongAccount);
            token::transfer_checked(
                CpiContext::new(
                    token_program.key(),
                    TransferChecked {
                        from: self.users()[i].to_account_info(),
                        mint: self.mints()[i].to_account_info(),
                        to: self.vaults()[i].to_account_info(),
                        authority: authority.clone(),
                    },
                ),
                amount,
                self.mints()[i].decimals,
            )?;
        }
        Ok(())
    }

    fn push(
        &self,
        token_program: &Program<'info, Token>,
        pool: &AccountInfo<'info>,
        signer: &PoolSigner,
        amounts: &[U256; 4],
    ) -> Result<()> {
        let seeds = signer.seeds();
        for i in 0..4 {
            let amount = state::to_u64(amounts[i])?;
            if amount == 0 {
                continue;
            }
            token::transfer_checked(
                CpiContext::new_with_signer(
                    token_program.key(),
                    TransferChecked {
                        from: self.vaults()[i].to_account_info(),
                        mint: self.mints()[i].to_account_info(),
                        to: self.users()[i].to_account_info(),
                        authority: pool.clone(),
                    },
                    &[&seeds],
                ),
                amount,
                self.mints()[i].decimals,
            )?;
        }
        Ok(())
    }
}
