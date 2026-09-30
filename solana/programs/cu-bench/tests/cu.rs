//! Measures compute units for the Orbital maths inside the Solana VM (LiteSVM).
//! Build the program first: `cargo build-sbf --manifest-path programs/cu-bench/Cargo.toml`.
//! Run with `--nocapture` to print the table.

use std::path::PathBuf;

use litesvm::LiteSVM;
use orbital_math::U256;
use orbital_math::segmented::{Tick, aggregate, plan_swap};
use solana_compute_budget_interface::ComputeBudgetInstruction;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use solana_transaction::Transaction;

const MAX_CU: u32 = 1_400_000;

fn u(v: &str) -> U256 {
    U256::from_str_radix(v, 10).unwrap()
}

struct Case {
    name: &'static str,
    op: u8,
    input: u8,
    output: u8,
    bitmap: u8,
    reserves: [&'static str; 4],
    amount_in: &'static str,
    expected_out: &'static str,
}

// Pre-trade states and results from packages/fixtures/quote-vectors-v1.json.
const INITIAL: [&str; 4] =
    ["15000000000000000000000000", "15000000000000000000000000", "15000000000000000000000000", "15000000000000000000000000"];

fn fixture_case(name: &'static str, op: u8, action: usize) -> Case {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../packages/fixtures/quote-vectors-v1.json");
    let json: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let actions = json["actions"].as_array().unwrap();
    let leak = |s: &str| -> &'static str { Box::leak(s.to_string().into_boxed_str()) };
    let (reserves, bitmap) = if action == 0 {
        (INITIAL, 7u8)
    } else {
        let prev = &actions[action - 1];
        let r = prev["reserves"].as_array().unwrap();
        (
            [leak(r[0].as_str().unwrap()), leak(r[1].as_str().unwrap()), leak(r[2].as_str().unwrap()), leak(r[3].as_str().unwrap())],
            prev["interiorBitmap"].as_str().unwrap().parse().unwrap(),
        )
    };
    let a = &actions[action];
    Case {
        name,
        op,
        input: a["input"].as_u64().unwrap() as u8,
        output: a["output"].as_u64().unwrap() as u8,
        bitmap,
        reserves,
        amount_in: leak(a["amountIn"].as_str().unwrap()),
        expected_out: leak(a["amountOut"].as_str().unwrap()),
    }
}

fn data(case: &Case) -> Vec<u8> {
    let mut out = vec![case.op, case.input, case.output, case.bitmap];
    for r in case.reserves {
        out.extend_from_slice(&u(r).to_le_bytes());
    }
    out.extend_from_slice(&u(case.amount_in).to_le_bytes());
    if case.op != 7 {
        out.extend_from_slice(&u(case.expected_out).to_le_bytes());
        return out;
    }
    // Settlement: plan off-chain exactly as a client would, and expect the planned output.
    let radius = u("10000000000000000000000000");
    let ticks: Vec<Tick> = [1001u128, 1004, 1050]
        .iter()
        .enumerate()
        .map(|(i, p)| Tick { radius, k: radius * *p / 1000, is_interior: case.bitmap & (1 << i) != 0 })
        .collect();
    let reserves = case.reserves.map(u);
    let (planned, segments) =
        plan_swap(&aggregate(&ticks).unwrap(), &mut ticks.clone(), &reserves, case.input, case.output, u(case.amount_in))
            .unwrap();
    out.extend_from_slice(&planned.amount_out.to_le_bytes());
    for segment in segments {
        out.extend_from_slice(&segment.amount_in.to_le_bytes());
        out.extend_from_slice(&segment.amount_out.to_le_bytes());
    }
    out
}

#[test]
fn measure_compute_units() {
    let so = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/deploy/cu_bench.so");
    let bytes = std::fs::read(&so).unwrap_or_else(|_| panic!("build first: {} missing", so.display()));
    let program_id = Pubkey::new_unique();
    let mut svm = LiteSVM::new();
    svm.add_program(program_id, &bytes).unwrap();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();

    let cases = [
        fixture_case("torus quote, no crossing (1k)", 0, 0),
        fixture_case("swap, no crossing (1k)", 1, 0),
        fixture_case("swap, no crossing (400k)", 1, 6),
        fixture_case("swap, 1 crossing (1.5M)", 1, 4),
        fixture_case("swap, 2 crossings (3M)", 1, 7),
        fixture_case("settle, no crossing (1k)", 7, 0),
        fixture_case("settle, no crossing (400k)", 7, 6),
        fixture_case("settle, 1 crossing (1.5M)", 7, 4),
        fixture_case("settle, 1 crossing back (1.8M)", 7, 5),
        fixture_case("settle, 2 crossings (3M)", 7, 7),
        fixture_case("attribute 3 ranges", 2, 1),
        Case { name: "one residual", op: 3, input: 0, output: 1, bitmap: 7, reserves: INITIAL, amount_in: "0", expected_out: "0" },
        Case { name: "sqrt_wad(1e40)", op: 4, input: 0, output: 1, bitmap: 7, reserves: INITIAL, amount_in: "10000000000000000000000000000000000000000", expected_out: "100000000000000000000000000000" },
        Case { name: "mul_wad_down(1e28,1e28)", op: 5, input: 0, output: 1, bitmap: 7, reserves: INITIAL, amount_in: "10000000000000000000000000000", expected_out: "100000000000000000000000000000000000000" },
    ];

    println!("\n{:<32} {:>10}  {}", "case", "CU", "result");
    let mut failures = Vec::new();
    let mut solved_on_chain = Vec::new();
    for (i, case) in cases.iter().enumerate() {
        let ix = Instruction { program_id, accounts: vec![], data: data(case) };
        let budget = ComputeBudgetInstruction::set_compute_unit_limit(MAX_CU);
        // A distinct heap request keeps each transaction's signature unique.
        let heap = ComputeBudgetInstruction::request_heap_frame(32 * 1024 * (1 + (i as u32 % 2)));
        let tx = Transaction::new_signed_with_payer(&[budget, heap, ix], Some(&payer.pubkey()), &[&payer], svm.latest_blockhash());
        match svm.send_transaction(tx) {
            Ok(meta) => {
                println!("{:<32} {:>10}  ok", case.name, meta.compute_units_consumed);
                if case.op <= 1 {
                    solved_on_chain.push(case.name);
                }
            }
            Err(fail) => {
                let over = fail.meta.compute_units_consumed >= u64::from(MAX_CU);
                println!("{:<32} {:>10}  {}", case.name, fail.meta.compute_units_consumed, if over { "over limit" } else { "FAILED" });
                // Solving on-chain (ops 0 and 1) is expected to exceed the limit; that is why
                // the program settles planned swaps instead.
                if !(case.op <= 1 && over) {
                    failures.push(case.name);
                }
            }
        }
        svm.expire_blockhash();
    }
    println!("limit: {MAX_CU} CU per transaction");
    assert!(failures.is_empty(), "failed cases: {failures:?}");
    // If on-chain solving ever fits, settlement by segments is no longer necessary.
    assert!(solved_on_chain.is_empty(), "on-chain solving now fits: {solved_on_chain:?}");
}
