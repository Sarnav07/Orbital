//! Account layouts. Numbers wider than 64 bits are stored as little-endian byte arrays
//! so the zero-copy layout has no padding and reads the same on-chain and off-chain.

use anchor_lang::prelude::*;
use orbital_math::U256;
use orbital_math::fee_book::{PositionFees, RangeFees};
use orbital_math::segmented::Tick;
use orbital_math::torus::State;

use crate::error::OrbitalError;

/// Most ranges one pool holds, as in the Solidity hook.
pub const MAX_RANGES: usize = 16;

#[account(zero_copy)]
pub struct Pool {
    pub authority: Pubkey,
    /// The four stablecoins, strictly increasing by address.
    pub mints: [Pubkey; 4],
    pub vaults: [Pubkey; 4],
    /// Book coordinates, 18-decimal WAD.
    pub reserves: [[u8; 16]; 4],
    /// Sum of every range's virtual offset (minimum reserve), WAD.
    pub virtual_sum: [u8; 16],
    /// Swap fees owed to LPs and not yet collected, raw token units.
    pub fee_liability: [[u8; 8]; 4],
    pub radius: [[u8; 16]; MAX_RANGES],
    pub k: [[u8; 16]; MAX_RANGES],
    pub total_shares: [[u8; 16]; MAX_RANGES],
    /// Per range and asset: fee growth per share, Q128.
    pub fee_growth: [[[u8; 32]; 4]; MAX_RANGES],
    /// Per range and asset: fee rounding dust, raw token units.
    pub fee_dust: [[[u8; 8]; 4]; MAX_RANGES],
    /// Swap fee in parts per million of the input.
    pub fee_ppm: [u8; 4],
    pub interior_bitmap: [u8; 2],
    pub decimals: [u8; 4],
    pub range_count: u8,
    pub seeded: u8,
    pub bump: u8,
    pub vault_bumps: [u8; 4],
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub pool: Pubkey,
    pub owner: Pubkey,
    pub range_id: u8,
    pub shares: u128,
    /// Fee checkpoint per asset (shares * growth / Q128 at the last update).
    pub fee_debt: [[u8; 32]; 4],
    /// Fees checkpointed but not yet paid, raw token units.
    pub claimable: [u64; 4],
    pub bump: u8,
}

pub fn u128_of(bytes: &[u8; 16]) -> U256 {
    U256::new(u128::from_le_bytes(*bytes))
}

pub fn put_u128(value: U256) -> Result<[u8; 16]> {
    if value > U256::new(u128::MAX) {
        return err!(OrbitalError::ValueTooLarge);
    }
    Ok(value.as_u128().to_le_bytes())
}

pub fn u64_of(bytes: &[u8; 8]) -> U256 {
    U256::new(u128::from(u64::from_le_bytes(*bytes)))
}

pub fn put_u64(value: U256) -> Result<[u8; 8]> {
    if value > U256::new(u128::from(u64::MAX)) {
        return err!(OrbitalError::ValueTooLarge);
    }
    Ok((value.as_u128() as u64).to_le_bytes())
}

pub fn to_u64(value: U256) -> Result<u64> {
    Ok(u64::from_le_bytes(put_u64(value)?))
}

impl Pool {
    pub const SEED: &'static [u8] = b"pool";
    pub const VAULT_SEED: &'static [u8] = b"vault";

    pub fn reserves(&self) -> [U256; 4] {
        self.reserves.map(|r| u128_of(&r))
    }

    pub fn set_reserves(&mut self, reserves: &[U256; 4]) -> Result<()> {
        for (slot, value) in self.reserves.iter_mut().zip(reserves) {
            *slot = put_u128(*value)?;
        }
        Ok(())
    }

    pub fn ticks(&self) -> Vec<Tick> {
        let bitmap = u16::from_le_bytes(self.interior_bitmap);
        (0..usize::from(self.range_count))
            .map(|i| Tick { radius: u128_of(&self.radius[i]), k: u128_of(&self.k[i]), is_interior: bitmap & (1 << i) != 0 })
            .collect()
    }

    pub fn set_ticks(&mut self, ticks: &[Tick]) -> Result<()> {
        let mut bitmap = 0u16;
        for (i, tick) in ticks.iter().enumerate() {
            self.radius[i] = put_u128(tick.radius)?;
            self.k[i] = put_u128(tick.k)?;
            if tick.is_interior {
                bitmap |= 1 << i;
            }
        }
        self.interior_bitmap = bitmap.to_le_bytes();
        Ok(())
    }

    pub fn state(&self) -> Result<State> {
        orbital_math::segmented::aggregate(&self.ticks()).map_err(crate::error::math)
    }

    pub fn range_fees(&self, range: usize) -> RangeFees {
        RangeFees {
            total_shares: u128_of(&self.total_shares[range]),
            growth: self.fee_growth[range].map(U256::from_le_bytes),
            dust: self.fee_dust[range].map(|d| u64_of(&d)),
        }
    }

    pub fn set_range_fees(&mut self, range: usize, fees: &RangeFees) -> Result<()> {
        self.total_shares[range] = put_u128(fees.total_shares)?;
        self.fee_growth[range] = fees.growth.map(|g| g.to_le_bytes());
        for (slot, value) in self.fee_dust[range].iter_mut().zip(fees.dust) {
            *slot = put_u64(value)?;
        }
        Ok(())
    }

    pub fn fee_liability(&self, asset: usize) -> U256 {
        u64_of(&self.fee_liability[asset])
    }

    pub fn set_fee_liability(&mut self, asset: usize, value: U256) -> Result<()> {
        self.fee_liability[asset] = put_u64(value)?;
        Ok(())
    }

    pub fn fee_ppm(&self) -> u32 {
        u32::from_le_bytes(self.fee_ppm)
    }
}

impl Position {
    pub const SEED: &'static [u8] = b"position";

    pub fn fees(&self) -> PositionFees {
        PositionFees {
            shares: U256::new(self.shares),
            debt: self.fee_debt.map(U256::from_le_bytes),
            claimable: self.claimable.map(|c| U256::new(u128::from(c))),
        }
    }

    pub fn set_fees(&mut self, fees: &PositionFees) -> Result<()> {
        self.shares = put_u128_value(fees.shares)?;
        self.fee_debt = fees.debt.map(|d| d.to_le_bytes());
        for (slot, value) in self.claimable.iter_mut().zip(fees.claimable) {
            *slot = to_u64(value)?;
        }
        Ok(())
    }
}

fn put_u128_value(value: U256) -> Result<u128> {
    Ok(u128::from_le_bytes(put_u128(value)?))
}
