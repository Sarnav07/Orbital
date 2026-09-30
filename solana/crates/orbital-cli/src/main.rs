//! Orbital Solana demo client.
//!
//!   orbital-cli setup  --url <rpc> --keypair <path> --out <deployment.json>
//!   orbital-cli status --url <rpc> --deployment <deployment.json>
//!   orbital-cli swap   --url <rpc> --keypair <path> --deployment <deployment.json> <from> <to> <amount>
//!
//! `setup` creates four mock 6-decimal stablecoins, the pool with the demo ranges
//! (three 10M ranges at k/r 1.001, 1.004 and 1.05), its vaults, and seeds it.
//! `swap` plans the trade off-chain from the pool's current state with
//! `orbital_math::segmented::plan_swap` and sends the planned segments.

use std::collections::HashMap;
use std::str::FromStr;

use anchor_lang::{InstructionData, ToAccountMetas};
use orbital::state::{Pool, Position};
use orbital::{RangeArg, SegmentArg};
use orbital_math::segmented::plan_swap;
use orbital_math::{U256, token_units};
use serde::{Deserialize, Serialize};
use solana_commitment_config::CommitmentConfig;
use solana_compute_budget_interface::ComputeBudgetInstruction;
use solana_keypair::Keypair;
use solana_rpc_client::rpc_client::RpcClient;
use solana_signer::Signer;
use solana_transaction::Transaction;

type Pubkey = anchor_lang::prelude::Pubkey;
type Instruction = anchor_lang::solana_program::instruction::Instruction;

const WAD: u128 = 1_000_000_000_000_000_000;
const RADIUS: u128 = 10_000_000 * WAD;
const FEE_PPM: u32 = 500;
const DECIMALS: u8 = 6;
/// Size of an SPL Token mint account.
const MINT_LEN: usize = 82;
const LABELS: [&str; 4] = ["mUSDC", "mUSDT", "mPYUSD", "mUSDG"];

#[derive(Serialize, Deserialize)]
struct Deployment {
    program: String,
    pool: String,
    symbols: [String; 4],
    mints: [String; 4],
    vaults: [String; 4],
    decimals: [u8; 4],
    authority: String,
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (command, flags, rest) = parse(&args);
    let url = flags.get("url").cloned().unwrap_or_else(|| "http://127.0.0.1:8899".into());
    let rpc = RpcClient::new_with_commitment(url, CommitmentConfig::confirmed());
    let result = match command.as_str() {
        "setup" => setup(&rpc, &keypair(&flags), flags.get("out").expect("--out <deployment.json>")),
        "status" => status(&rpc, &deployment(&flags)),
        "swap" => {
            let [from, to, amount] = <[String; 3]>::try_from(rest).expect("swap <from> <to> <amount>");
            swap(&rpc, &keypair(&flags), &deployment(&flags), &from, &to, &amount)
        }
        _ => Err("commands: setup | status | swap".into()),
    };
    if let Err(error) = result {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}

fn parse(args: &[String]) -> (String, HashMap<String, String>, Vec<String>) {
    let mut flags = HashMap::new();
    let mut rest = Vec::new();
    let mut iter = args.iter();
    let command = iter.next().cloned().unwrap_or_default();
    while let Some(arg) = iter.next() {
        if let Some(name) = arg.strip_prefix("--") {
            flags.insert(name.to_string(), iter.next().cloned().unwrap_or_default());
        } else {
            rest.push(arg.clone());
        }
    }
    (command, flags, rest)
}

fn keypair(flags: &HashMap<String, String>) -> Keypair {
    let path = flags.get("keypair").expect("--keypair <path>");
    let bytes: Vec<u8> = serde_json::from_str(&std::fs::read_to_string(path).expect("read keypair")).expect("keypair json");
    Keypair::try_from(bytes.as_slice()).expect("valid keypair")
}

fn deployment(flags: &HashMap<String, String>) -> Deployment {
    let path = flags.get("deployment").expect("--deployment <path>");
    serde_json::from_str(&std::fs::read_to_string(path).expect("read deployment")).expect("deployment json")
}

fn key(s: &str) -> Pubkey {
    Pubkey::from_str(s).expect("pubkey")
}

type Res = Result<(), String>;

fn send(rpc: &RpcClient, payer: &Keypair, ixs: &[Instruction], extra: &[&Keypair]) -> Result<String, String> {
    let mut all = vec![
        ComputeBudgetInstruction::set_compute_unit_limit(1_400_000),
        ComputeBudgetInstruction::request_heap_frame(256 * 1024),
    ];
    all.extend_from_slice(ixs);
    let mut signers: Vec<&Keypair> = vec![payer];
    signers.extend(extra);
    let blockhash = rpc.get_latest_blockhash().map_err(|e| e.to_string())?;
    let tx = Transaction::new_signed_with_payer(&all, Some(&payer.pubkey()), &signers, blockhash);
    rpc.send_and_confirm_transaction(&tx).map(|s| s.to_string()).map_err(|e| e.to_string())
}

fn setup(rpc: &RpcClient, payer: &Keypair, out: &str) -> Res {
    let token = spl_token_interface::ID;
    let authority = payer.pubkey();

    // Four mock stablecoins; the pool wants them in address order.
    let mut mint_keys: Vec<Keypair> = (0..4).map(|_| Keypair::new()).collect();
    mint_keys.sort_by_key(|k| k.pubkey());
    let rent = rpc.get_minimum_balance_for_rent_exemption(MINT_LEN).map_err(|e| e.to_string())?;
    for mint in &mint_keys {
        let ixs = [
            solana_system_interface::instruction::create_account(
                &authority,
                &mint.pubkey(),
                rent,
                MINT_LEN as u64,
                &token,
            ),
            spl_token_interface::instruction::initialize_mint2(&token, &mint.pubkey(), &authority, None, DECIMALS)
                .map_err(|e| e.to_string())?,
        ];
        send(rpc, payer, &ixs, &[mint])?;
    }
    let mints: [Pubkey; 4] = core::array::from_fn(|i| mint_keys[i].pubkey());
    println!("mints: {}", mints.map(|m| m.to_string()).join(", "));

    let program = orbital::ID;
    let (pool, _) = Pubkey::find_program_address(
        &[Pool::SEED, mints[0].as_ref(), mints[1].as_ref(), mints[2].as_ref(), mints[3].as_ref()],
        &program,
    );
    let vaults: [Pubkey; 4] =
        core::array::from_fn(|i| Pubkey::find_program_address(&[Pool::VAULT_SEED, pool.as_ref(), &[i as u8]], &program).0);

    let ranges = [1001u128, 1004, 1050].map(|p| RangeArg { radius: RADIUS, k: RADIUS * p / 1000 }).to_vec();
    let init = Instruction {
        program_id: program,
        accounts: orbital::accounts::InitializePool {
            authority,
            pool,
            mint0: mints[0],
            mint1: mints[1],
            mint2: mints[2],
            mint3: mints[3],
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: orbital::instruction::InitializePool { ranges, reserves: [RADIUS * 3 / 2; 4], fee_ppm: FEE_PPM }.data(),
    };
    println!("initialize_pool: {}", send(rpc, payer, &[init], &[])?);

    for index in 0..4u8 {
        let ix = Instruction {
            program_id: program,
            accounts: orbital::accounts::CreateVault {
                authority,
                pool,
                mint: mints[usize::from(index)],
                vault: vaults[usize::from(index)],
                token_program: token,
                system_program: anchor_lang::system_program::ID,
            }
            .to_account_metas(None),
            data: orbital::instruction::CreateVault { index }.data(),
        };
        send(rpc, payer, &[ix], &[])?;
    }
    let positions: Vec<Pubkey> = (0..3u8)
        .map(|r| Pubkey::find_program_address(&[Position::SEED, pool.as_ref(), &[r], authority.as_ref()], &program).0)
        .collect();
    for (range, position) in positions.iter().enumerate() {
        let ix = Instruction {
            program_id: program,
            accounts: orbital::accounts::OpenPosition {
                owner: authority,
                pool,
                position: *position,
                system_program: anchor_lang::system_program::ID,
            }
            .to_account_metas(None),
            data: orbital::instruction::OpenPosition { range_id: range as u8 }.data(),
        };
        send(rpc, payer, &[ix], &[])?;
    }

    // Wallet accounts, funded with 20M of each coin (the seed needs about 15M).
    let wallet: [Pubkey; 4] = core::array::from_fn(|i| {
        spl_associated_token_account_interface::address::get_associated_token_address(&authority, &mints[i])
    });
    for i in 0..4 {
        let ixs = [
            spl_associated_token_account_interface::instruction::create_associated_token_account_idempotent(
                &authority, &authority, &mints[i], &token,
            ),
            spl_token_interface::instruction::mint_to(&token, &mints[i], &wallet[i], &authority, &[], 20_000_000 * 1_000_000)
                .map_err(|e| e.to_string())?,
        ];
        send(rpc, payer, &ixs, &[])?;
    }

    let mut metas = orbital::accounts::Seed {
        authority,
        pool,
        basket: basket(&wallet, &vaults, &mints),
        token_program: token,
    }
    .to_account_metas(None);
    metas.extend(positions.iter().map(|p| anchor_lang::solana_program::instruction::AccountMeta::new(*p, false)));
    let seed = Instruction { program_id: program, accounts: metas, data: orbital::instruction::Seed {}.data() };
    println!("seed: {}", send(rpc, payer, &[seed], &[])?);

    let deployment = Deployment {
        program: program.to_string(),
        pool: pool.to_string(),
        symbols: LABELS.map(String::from),
        mints: mints.map(|m| m.to_string()),
        vaults: vaults.map(|v| v.to_string()),
        decimals: [DECIMALS; 4],
        authority: authority.to_string(),
    };
    std::fs::write(out, serde_json::to_string_pretty(&deployment).unwrap() + "\n").map_err(|e| e.to_string())?;
    println!("wrote {out}");
    status(rpc, &deployment)
}

fn basket(users: &[Pubkey; 4], vaults: &[Pubkey; 4], mints: &[Pubkey; 4]) -> orbital::accounts::Basket {
    orbital::accounts::Basket {
        user0: users[0],
        user1: users[1],
        user2: users[2],
        user3: users[3],
        vault0: vaults[0],
        vault1: vaults[1],
        vault2: vaults[2],
        vault3: vaults[3],
        mint0: mints[0],
        mint1: mints[1],
        mint2: mints[2],
        mint3: mints[3],
    }
}

fn load_pool(rpc: &RpcClient, pool: &Pubkey) -> Result<Pool, String> {
    let data = rpc.get_account_data(pool).map_err(|e| e.to_string())?;
    Ok(*bytemuck::from_bytes::<Pool>(&data[8..8 + core::mem::size_of::<Pool>()]))
}

fn token_balance(rpc: &RpcClient, account: &Pubkey) -> Result<u64, String> {
    let amount = rpc.get_token_account_balance(account).map_err(|e| e.to_string())?.amount;
    amount.parse().map_err(|_| "bad balance".into())
}

fn human(wad: U256) -> String {
    let whole = wad / U256::new(WAD);
    let frac = (wad % U256::new(WAD)) / U256::new(1_000_000_000_000);
    format!("{whole}.{frac:06}")
}

fn status(rpc: &RpcClient, d: &Deployment) -> Res {
    let pool = load_pool(rpc, &key(&d.pool))?;
    let reserves = pool.reserves();
    let virtual_sum = U256::new(u128::from_le_bytes(pool.virtual_sum));
    let bitmap = u16::from_le_bytes(pool.interior_bitmap);
    println!("pool {}  ranges interior: {:03b} (bit i = range i)", d.pool, bitmap);
    println!("{:<8} {:>22} {:>20} {:>20}  solvent", "coin", "book reserve", "vault holds", "vault must hold");
    for i in 0..4 {
        let custody = token_balance(rpc, &key(&d.vaults[i]))?;
        let required = token_units::from_wad_up(reserves[i] - virtual_sum, pool.decimals[i]).map_err(|e| format!("{e:?}"))?
            + U256::new(u128::from(u64::from_le_bytes(pool.fee_liability[i])));
        let ok = U256::new(u128::from(custody)) >= required;
        println!("{:<8} {:>22} {:>20} {:>20}  {}", d.symbols[i], human(reserves[i]), custody, required, if ok { "yes" } else { "NO" });
    }
    Ok(())
}

fn index_of(d: &Deployment, name: &str) -> Result<u8, String> {
    d.symbols.iter().position(|s| s.eq_ignore_ascii_case(name)).map(|i| i as u8).ok_or(format!("unknown coin {name}"))
}

fn swap(rpc: &RpcClient, payer: &Keypair, d: &Deployment, from: &str, to: &str, amount: &str) -> Res {
    let (input, output) = (index_of(d, from)?, index_of(d, to)?);
    let (i, o) = (usize::from(input), usize::from(output));
    let units: f64 = amount.parse().map_err(|_| "amount must be a number")?;
    let amount_in = (units * 10f64.powi(i32::from(d.decimals[i]))).round() as u64;

    let pool = load_pool(rpc, &key(&d.pool))?;
    let fee = (u128::from(amount_in) * u128::from(pool.fee_ppm())).div_ceil(1_000_000);
    let wad_in = token_units::to_wad(U256::new(u128::from(amount_in) - fee), pool.decimals[i]).map_err(|e| format!("{e:?}"))?;
    let state = pool.state().map_err(|e| e.to_string())?;
    let (planned, segments) =
        plan_swap(&state, &mut pool.ticks(), &pool.reserves(), input, output, wad_in).map_err(|e| format!("plan: {e:?}"))?;
    let expected = token_units::from_wad_down(planned.amount_out, pool.decimals[o]).map_err(|e| format!("{e:?}"))?.as_u128() as u64;
    println!("plan: {amount} {} -> {} {} in {} segment(s), {} crossing(s)", d.symbols[i], expected as f64 / 1e6, d.symbols[o], segments.len(), planned.crossings);

    let owner = payer.pubkey();
    let ata = |m: &str| spl_associated_token_account_interface::address::get_associated_token_address(&owner, &key(m));
    let ix = Instruction {
        program_id: key(&d.program),
        accounts: orbital::accounts::Swap {
            user: owner,
            pool: key(&d.pool),
            user_source: ata(&d.mints[i]),
            user_destination: ata(&d.mints[o]),
            vault_in: key(&d.vaults[i]),
            vault_out: key(&d.vaults[o]),
            mint_in: key(&d.mints[i]),
            mint_out: key(&d.mints[o]),
            token_program: spl_token_interface::ID,
        }
        .to_account_metas(None),
        data: orbital::instruction::Swap {
            input,
            output,
            amount_in,
            min_amount_out: expected,
            deadline: 0,
            segments: segments
                .iter()
                .map(|s| SegmentArg { amount_in: s.amount_in.as_u128(), amount_out: s.amount_out.as_u128() })
                .collect(),
        }
        .data(),
    };
    let before = token_balance(rpc, &ata(&d.mints[o]))?;
    let signature = send(rpc, payer, &[ix], &[])?;
    let received = token_balance(rpc, &ata(&d.mints[o]))? - before;
    println!("swap: {signature}\nreceived {} {}", received as f64 / 1e6, d.symbols[o]);
    status(rpc, d)
}
