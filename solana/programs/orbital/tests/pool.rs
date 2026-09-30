//! End-to-end: the Orbital program in LiteSVM with four real SPL mints.
//! Build first: `cargo build-sbf --manifest-path programs/orbital/Cargo.toml`.

use std::path::PathBuf;

use anchor_lang::{InstructionData, ToAccountMetas};
use litesvm::LiteSVM;
use litesvm_token::spl_token::state::Account as SplAccount;
use litesvm_token::{CreateAccount, CreateMint, MintTo, TOKEN_ID, get_spl_account};
use orbital::state::{Pool, Position};
use orbital::{RangeArg, SegmentArg};
use orbital_math::segmented::plan_swap;
use orbital_math::{U256, token_units};
use solana_compute_budget_interface::ComputeBudgetInstruction;
use solana_keypair::Keypair;
use solana_signer::Signer;
use solana_transaction::Transaction;

type Address = anchor_lang::prelude::Pubkey;

const WAD: u128 = 1_000_000_000_000_000_000;
const RADIUS: u128 = 10_000_000 * WAD;
const FEE_PPM: u32 = 500;

struct Env {
    svm: LiteSVM,
    payer: Keypair,
    mints: [Address; 4],
    decimals: [u8; 4],
    pool: Address,
    vaults: [Address; 4],
}

fn program_id() -> Address {
    orbital::ID
}

fn send(env: &mut Env, ix: anchor_lang::solana_program::instruction::Instruction, signers: &[&Keypair]) -> Result<u64, String> {
    let budget = ComputeBudgetInstruction::set_compute_unit_limit(1_400_000);
    let heap = ComputeBudgetInstruction::request_heap_frame(256 * 1024);
    let payer = env.payer.pubkey();
    let mut all: Vec<&Keypair> = vec![&env.payer];
    all.extend(signers.iter().copied().filter(|k| k.pubkey() != payer));
    let tx = Transaction::new_signed_with_payer(&[budget, heap, ix], Some(&payer), &all, env.svm.latest_blockhash());
    let result = env.svm.send_transaction(tx);
    env.svm.expire_blockhash();
    match result {
        Ok(meta) => Ok(meta.compute_units_consumed),
        Err(fail) => Err(format!("{:?}\n{}", fail.err, fail.meta.logs.join("\n"))),
    }
}

fn pool_state(env: &Env) -> Pool {
    let data = env.svm.get_account(&env.pool).unwrap().data;
    *bytemuck::from_bytes::<Pool>(&data[8..8 + core::mem::size_of::<Pool>()])
}

fn balance(env: &Env, account: &Address) -> u64 {
    get_spl_account::<SplAccount>(&env.svm, account).unwrap().amount
}

fn token_account(env: &mut Env, mint: &Address, owner: &Address) -> Address {
    CreateAccount::new(&mut env.svm, &env.payer, mint).owner(owner).send().unwrap()
}

fn basket(env: &Env, users: &[Address; 4]) -> orbital::accounts::Basket {
    orbital::accounts::Basket {
        user0: users[0],
        user1: users[1],
        user2: users[2],
        user3: users[3],
        vault0: env.vaults[0],
        vault1: env.vaults[1],
        vault2: env.vaults[2],
        vault3: env.vaults[3],
        mint0: env.mints[0],
        mint1: env.mints[1],
        mint2: env.mints[2],
        mint3: env.mints[3],
    }
}

fn position_address(env: &Env, range: u8, owner: &Address) -> Address {
    Address::find_program_address(&[Position::SEED, env.pool.as_ref(), &[range], owner.as_ref()], &program_id()).0
}

/// Every vault must hold at least what the book owes: redeemable inventory rounded up plus unpaid fees.
fn assert_solvent(env: &Env) {
    let pool = pool_state(env);
    let virtual_sum = U256::new(u128::from_le_bytes(pool.virtual_sum));
    for i in 0..4 {
        let reserve = U256::new(u128::from_le_bytes(pool.reserves[i]));
        let required = token_units::from_wad_up(reserve - virtual_sum, pool.decimals[i]).unwrap()
            + U256::new(u128::from(u64::from_le_bytes(pool.fee_liability[i])));
        let custody = U256::new(u128::from(balance(env, &env.vaults[i])));
        assert!(custody >= required, "asset {i}: custody {custody} < required {required}");
    }
}

fn setup() -> (Env, Keypair) {
    let mut svm = LiteSVM::new();
    let so = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/deploy/orbital.so");
    svm.add_program(program_id(), &std::fs::read(&so).expect("build the program first")).unwrap();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 100_000_000_000).unwrap();

    // Mixed decimals (SPL amounts are u64, so no 18-decimal coins); address order.
    let mut minted: Vec<(Address, u8)> = [6u8, 9, 6, 8]
        .iter()
        .map(|&d| (CreateMint::new(&mut svm, &payer).decimals(d).send().unwrap(), d))
        .collect();
    minted.sort_by_key(|(m, _)| *m);
    let mints = [minted[0].0, minted[1].0, minted[2].0, minted[3].0];
    let decimals = [minted[0].1, minted[1].1, minted[2].1, minted[3].1];
    let pool = Address::find_program_address(
        &[Pool::SEED, mints[0].as_ref(), mints[1].as_ref(), mints[2].as_ref(), mints[3].as_ref()],
        &program_id(),
    )
    .0;
    let vaults = core::array::from_fn(|i| {
        Address::find_program_address(&[Pool::VAULT_SEED, pool.as_ref(), &[i as u8]], &program_id()).0
    });
    let authority = Keypair::new();
    svm.airdrop(&authority.pubkey(), 10_000_000_000).unwrap();
    (Env { svm, payer, mints, decimals, pool, vaults }, authority)
}

fn fund(env: &mut Env, owner: &Keypair, units: u64) -> [Address; 4] {
    let accounts: [Address; 4] = core::array::from_fn(|i| {
        let mint = env.mints[i];
        token_account(env, &mint, &owner.pubkey())
    });
    for i in 0..4 {
        let amount = raw(env, i, units);
        MintTo::new(&mut env.svm, &env.payer, &env.mints[i], &accounts[i], amount).send().unwrap();
    }
    accounts
}

fn create_pool(env: &mut Env, authority: &Keypair) -> [Address; 4] {
    let ranges = [1001u128, 1004, 1050].map(|p| RangeArg { radius: RADIUS, k: RADIUS * p / 1000 }).to_vec();
    let reserves = [RADIUS * 3 / 2; 4];
    let ix = anchor_lang::solana_program::instruction::Instruction {
        program_id: program_id(),
        accounts: orbital::accounts::InitializePool {
            authority: authority.pubkey(),
            pool: env.pool,
            mint0: env.mints[0],
            mint1: env.mints[1],
            mint2: env.mints[2],
            mint3: env.mints[3],
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: orbital::instruction::InitializePool { ranges, reserves, fee_ppm: FEE_PPM }.data(),
    };
    let cu = send(env, ix, &[authority]).unwrap();
    println!("initialize_pool: {cu} CU");

    for index in 0..4u8 {
        let ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: program_id(),
            accounts: orbital::accounts::CreateVault {
                authority: authority.pubkey(),
                pool: env.pool,
                mint: env.mints[usize::from(index)],
                vault: env.vaults[usize::from(index)],
                token_program: TOKEN_ID,
                system_program: anchor_lang::system_program::ID,
            }
            .to_account_metas(None),
            data: orbital::instruction::CreateVault { index }.data(),
        };
        send(env, ix, &[authority]).unwrap();
    }
    for range in 0..3u8 {
        open_position(env, authority, range);
    }

    // 15M of each coin covers the seed amounts (the coordinates minus virtual offsets).
    let tokens = fund(env, authority, 16_000_000);
    let mut metas = orbital::accounts::Seed {
        authority: authority.pubkey(),
        pool: env.pool,
        basket: basket(env, &tokens),
        token_program: TOKEN_ID,
    }
    .to_account_metas(None);
    for range in 0..3u8 {
        metas.push(anchor_lang::solana_program::instruction::AccountMeta::new(
            position_address(env, range, &authority.pubkey()),
            false,
        ));
    }
    let ix = anchor_lang::solana_program::instruction::Instruction {
        program_id: program_id(),
        accounts: metas,
        data: orbital::instruction::Seed {}.data(),
    };
    let cu = send(env, ix, &[authority]).unwrap();
    println!("seed: {cu} CU");
    tokens
}

fn open_position(env: &mut Env, owner: &Keypair, range: u8) {
    let ix = anchor_lang::solana_program::instruction::Instruction {
        program_id: program_id(),
        accounts: orbital::accounts::OpenPosition {
            owner: owner.pubkey(),
            pool: env.pool,
            position: position_address(env, range, &owner.pubkey()),
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: orbital::instruction::OpenPosition { range_id: range }.data(),
    };
    send(env, ix, &[owner]).unwrap();
}

/// Plans a swap from the pool's on-chain state, as a client would.
fn plan(env: &Env, input: u8, output: u8, amount_in: u64) -> (Vec<SegmentArg>, u64) {
    let pool = pool_state(env);
    let reserves = pool.reserves();
    let mut ticks = pool.ticks();
    let state = pool.state().unwrap();
    let fee = (u128::from(amount_in) * u128::from(FEE_PPM)).div_ceil(1_000_000);
    let wad_in = token_units::to_wad(U256::new(u128::from(amount_in) - fee), pool.decimals[usize::from(input)]).unwrap();
    let (result, segments) = plan_swap(&state, &mut ticks, &reserves, input, output, wad_in).unwrap();
    let out = token_units::from_wad_down(result.amount_out, pool.decimals[usize::from(output)]).unwrap();
    let args = segments.iter().map(|s| SegmentArg { amount_in: s.amount_in.as_u128(), amount_out: s.amount_out.as_u128() }).collect();
    (args, out.as_u128() as u64)
}

fn swap_ix(env: &Env, user: &Keypair, from: Address, to: Address, input: u8, output: u8, amount_in: u64, min_out: u64, segments: Vec<SegmentArg>) -> anchor_lang::solana_program::instruction::Instruction {
    anchor_lang::solana_program::instruction::Instruction {
        program_id: program_id(),
        accounts: orbital::accounts::Swap {
            user: user.pubkey(),
            pool: env.pool,
            user_source: from,
            user_destination: to,
            vault_in: env.vaults[usize::from(input)],
            vault_out: env.vaults[usize::from(output)],
            mint_in: env.mints[usize::from(input)],
            mint_out: env.mints[usize::from(output)],
            token_program: TOKEN_ID,
        }
        .to_account_metas(None),
        data: orbital::instruction::Swap { input, output, amount_in, min_amount_out: min_out, deadline: 0, segments }.data(),
    }
}

fn raw(env: &Env, asset: usize, units: u64) -> u64 {
    units * 10u64.pow(u32::from(env.decimals[asset]))
}

#[test]
fn pool_lifecycle_swaps_liquidity_and_fees() {
    let (mut env, authority) = setup();
    create_pool(&mut env, &authority);
    assert_solvent(&env);

    let trader = Keypair::new();
    env.svm.airdrop(&trader.pubkey(), 1_000_000_000).unwrap();
    let wallet = fund(&mut env, &trader, 5_000_000);

    // A spread of swaps, including trades that cross one and two range planes.
    let trades: [(u8, u8, u64); 6] = [(0, 1, 1_000), (1, 2, 25_000), (2, 3, 250_000), (0, 2, 1_500_000), (2, 0, 1_800_000), (0, 3, 3_000_000)];
    for (input, output, units) in trades {
        let amount_in = raw(&env, usize::from(input), units);
        let (segments, expected_out) = plan(&env, input, output, amount_in);
        let before = balance(&env, &wallet[usize::from(output)]);
        let crossings = segments.len() - 1;
        let ix = swap_ix(&env, &trader, wallet[usize::from(input)], wallet[usize::from(output)], input, output, amount_in, expected_out, segments);
        let cu = send(&mut env, ix, &[&trader]).unwrap_or_else(|e| panic!("swap {input}->{output} {units}: {e}"));
        let got = balance(&env, &wallet[usize::from(output)]) - before;
        assert_eq!(got, expected_out, "swap {input}->{output} pays the planned amount");
        println!("swap {input}->{output} {units:>9} units, {crossings} crossings: {cu} CU, out {got}");
        assert_solvent(&env);
    }

    // Asking for more than the plan must fail, whether through min_out or a greedy segment.
    let amount_in = raw(&env, 1, 10_000);
    let (mut segments, expected_out) = plan(&env, 1, 3, amount_in);
    let too_much = swap_ix(&env, &trader, wallet[1], wallet[3], 1, 3, amount_in, expected_out + 1, segments.clone());
    assert!(send(&mut env, too_much, &[&trader]).is_err(), "min_out above the plan must fail");
    segments.last_mut().unwrap().amount_out += 1_000_000_000_000; // 1e-6 of a coin, in WAD
    let greedy = swap_ix(&env, &trader, wallet[1], wallet[3], 1, 3, amount_in, 0, segments);
    assert!(send(&mut env, greedy, &[&trader]).is_err(), "overpaying segment must fail");

    // A new LP adds to a range that is still interior (the big trades trapped the narrow
    // ones, and boundary ranges earn no fees), earns from a swap, collects, and withdraws.
    let bitmap = u16::from_le_bytes(pool_state(&env).interior_bitmap);
    let lp_range = (0..3u8).find(|r| bitmap & (1 << r) != 0).expect("an interior range");
    println!("interior bitmap {bitmap:03b}, LP joins range {lp_range}");
    let lp = Keypair::new();
    env.svm.airdrop(&lp.pubkey(), 1_000_000_000).unwrap();
    let lp_wallet = fund(&mut env, &lp, 2_000_000);
    open_position(&mut env, &lp, lp_range);
    let liquidity = |env: &Env, data: Vec<u8>| anchor_lang::solana_program::instruction::Instruction {
        program_id: program_id(),
        accounts: orbital::accounts::Liquidity {
            owner: lp.pubkey(),
            pool: env.pool,
            position: position_address(env, lp_range, &lp.pubkey()),
            basket: basket(env, &lp_wallet),
            token_program: TOKEN_ID,
        }
        .to_account_metas(None),
        data,
    };
    let shares = RADIUS / 10;
    let before: Vec<u64> = lp_wallet.iter().map(|a| balance(&env, a)).collect();
    let add = liquidity(&env, orbital::instruction::AddLiquidity { shares, max_amounts_in: [u64::MAX; 4], deadline: 0 }.data());
    let cu = send(&mut env, add, &[&lp]).unwrap();
    let deposited: Vec<u64> = lp_wallet.iter().zip(&before).map(|(a, b)| b - balance(&env, a)).collect();
    println!("add_liquidity: {cu} CU, deposited {deposited:?}");
    assert!(deposited.iter().any(|&d| d > 0));
    assert_solvent(&env);

    let amount_in = raw(&env, 3, 200_000);
    let (segments, expected_out) = plan(&env, 3, 1, amount_in);
    let ix = swap_ix(&env, &trader, wallet[3], wallet[1], 3, 1, amount_in, expected_out, segments);
    send(&mut env, ix, &[&trader]).unwrap();

    let before_fees = balance(&env, &lp_wallet[3]);
    let collect = liquidity(&env, orbital::instruction::CollectFees {}.data());
    let cu = send(&mut env, collect, &[&lp]).unwrap();
    let earned = balance(&env, &lp_wallet[3]) - before_fees;
    println!("collect_fees: {cu} CU, earned {earned} raw units of the input coin");
    assert!(earned > 0, "an interior range earns fees on swaps through it");
    assert_solvent(&env);

    let remove = liquidity(&env, orbital::instruction::RemoveLiquidity { shares, min_amounts_out: [0; 4], deadline: 0 }.data());
    let cu = send(&mut env, remove, &[&lp]).unwrap();
    println!("remove_liquidity: {cu} CU");
    let position: Position = {
        let data = env.svm.get_account(&position_address(&env, lp_range, &lp.pubkey())).unwrap().data;
        anchor_lang::AccountDeserialize::try_deserialize(&mut data.as_slice()).unwrap()
    };
    assert_eq!(position.shares, 0);
    assert_solvent(&env);

    // Withdrawing shares you do not have fails.
    let again = liquidity(&env, orbital::instruction::RemoveLiquidity { shares: 1, min_amounts_out: [0; 4], deadline: 0 }.data());
    assert!(send(&mut env, again, &[&lp]).is_err());
}
