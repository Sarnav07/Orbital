//! Cross-language differential: the BigInt simulator generated these vectors
//! (packages/simulator/scripts/generate-vectors.mjs). Solidity asserts them in
//! contracts/test/QuoteVectors.t.sol; the Rust port must match them exactly too.

use std::fs;
use std::path::PathBuf;

use orbital_math::U256;
use orbital_math::range_liquidity::attribute;
use orbital_math::segmented::{Tick, aggregate, swap_exact_in};
use serde_json::Value;

fn fixture(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../packages/fixtures").join(name);
    serde_json::from_str(&fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))).unwrap()
}

fn u(value: &Value) -> U256 {
    U256::from_str_radix(value.as_str().expect("decimal string"), 10).expect("valid U256")
}

fn four(value: &Value) -> [U256; 4] {
    let items = value.as_array().expect("array");
    assert_eq!(items.len(), 4, "need four values");
    [u(&items[0]), u(&items[1]), u(&items[2]), u(&items[3])]
}

fn ticks_from(value: &Value, bitmap: u32) -> Vec<Tick> {
    value
        .as_array()
        .expect("ticks")
        .iter()
        .enumerate()
        .map(|(i, t)| Tick { radius: u(&t["radius"]), k: u(&t["k"]), is_interior: bitmap & (1 << i) != 0 })
        .collect()
}

#[test]
fn rust_matches_bigint_quote_vectors_exactly() {
    let json = fixture("quote-vectors-v1.json");
    assert_eq!(json["version"], 1);

    let tick_count = json["ticks"].as_array().unwrap().len();
    let mut ticks = ticks_from(&json["ticks"], (1u32 << tick_count) - 1);
    let mut reserves = four(&json["initialReserves"]);
    let mut state = aggregate(&ticks).unwrap();

    let actions = json["actions"].as_array().unwrap();
    assert!(!actions.is_empty());
    for (a, action) in actions.iter().enumerate() {
        let input = action["input"].as_u64().unwrap() as u8;
        let output = action["output"].as_u64().unwrap() as u8;
        let amount_in = u(&action["amountIn"]);

        let result = swap_exact_in(&state, &mut ticks, &reserves, input, output, amount_in)
            .unwrap_or_else(|e| panic!("action {a}: {e:?}"));

        assert_eq!(result.amount_out, u(&action["amountOut"]), "action {a}: amountOut");
        assert_eq!(u64::from(result.crossings), action["crossings"].as_u64().unwrap(), "action {a}: crossings");
        assert_eq!(U256::new(u128::from(result.interior_bitmap)), u(&action["interiorBitmap"]), "action {a}: bitmap");
        assert_eq!(result.reserves, four(&action["reserves"]), "action {a}: reserves");

        reserves = result.reserves;
        state = result.state;
        for (i, tick) in ticks.iter_mut().enumerate() {
            tick.is_interior = result.interior_bitmap & (1 << i) != 0;
        }

        // The per-range attribution must agree to the wei after every step.
        let ranges = attribute(&state, &ticks, &reserves).unwrap_or_else(|e| panic!("action {a}: {e:?}"));
        let expected = action["attribution"].as_array().unwrap();
        assert_eq!(ranges.len(), expected.len(), "action {a}: range count");
        for (r, (range, want)) in ranges.iter().zip(expected).enumerate() {
            assert_eq!(range.virtual_offset, u(&want["virtualOffset"]), "action {a} range {r}: virtualOffset");
            assert_eq!(range.coordinates, four(&want["coordinates"]), "action {a} range {r}: coordinates");
            assert_eq!(range.real_inventory, four(&want["realInventory"]), "action {a} range {r}: realInventory");
        }
    }
}

#[test]
fn rust_replays_segmented_wad_trace_exactly() {
    let json = fixture("segmented-wad-v1.json");
    let trace = &json["trace"];
    let expected = &json["expected"];
    assert_eq!(trace["version"], 1);
    assert_eq!(trace["assetCount"], 4);

    let mut bitmap = u(&trace["initialInteriorBitmap"]).as_u32();
    let mut reserves = four(&trace["initialReserves"]);
    let steps = expected["steps"].as_array().unwrap();
    let actions = trace["actions"].as_array().unwrap();
    assert_eq!(steps.len(), actions.len());

    for (a, (action, step)) in actions.iter().zip(steps).enumerate() {
        let mut ticks = ticks_from(&trace["ticks"], bitmap);
        let state = aggregate(&ticks).unwrap();
        let result = swap_exact_in(
            &state,
            &mut ticks,
            &reserves,
            action["input"].as_u64().unwrap() as u8,
            action["output"].as_u64().unwrap() as u8,
            u(&action["amountIn"]),
        )
        .unwrap_or_else(|e| panic!("action {a}: {e:?}"));

        assert_eq!(result.amount_out, u(&action["amountOut"]), "action {a}: amountOut");
        assert_eq!(result.amount_out, u(&step["amountOut"]), "step {a}: amountOut");
        assert_eq!(result.interior_bitmap, u(&step["interiorBitmap"]).as_u32(), "step {a}: bitmap");
        assert_eq!(result.reserves, four(&step["reserves"]), "step {a}: reserves");
        reserves = result.reserves;
        bitmap = result.interior_bitmap;
    }
    assert_eq!(reserves, four(&expected["reserves"]));
    assert_eq!(bitmap, u(&expected["interiorBitmap"]).as_u32());
}

/// `NO_PHYSICAL_ROOT` -> `NoPhysicalRoot`, matching the `MathError` variant names.
fn camel(code: &str) -> String {
    code.split('_').map(|w| w[..1].to_string() + &w[1..].to_lowercase()).collect()
}

/// Seeded random sequences from scripts/gen-random-vectors.mjs: every successful quote
/// must match exactly, and every rejected one must fail with the same error.
#[test]
fn rust_matches_random_bigint_sequences() {
    let json: Value = serde_json::from_str(
        &fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/random-v1.json")).unwrap(),
    )
    .unwrap();
    let mut checked = 0;
    for sequence in json["sequences"].as_array().unwrap() {
        let name = sequence["name"].as_str().unwrap();
        let tick_count = sequence["ticks"].as_array().unwrap().len();
        let mut ticks = ticks_from(&sequence["ticks"], (1u32 << tick_count) - 1);
        let mut reserves = four(&sequence["initialReserves"]);
        for (a, action) in sequence["actions"].as_array().unwrap().iter().enumerate() {
            let state = aggregate(&ticks).unwrap();
            let mut attempt = ticks.clone();
            let outcome = swap_exact_in(
                &state,
                &mut attempt,
                &reserves,
                action["input"].as_u64().unwrap() as u8,
                action["output"].as_u64().unwrap() as u8,
                u(&action["amountIn"]),
            );
            if let Some(code) = action["error"].as_str() {
                let err = outcome.expect_err(&format!("{name} #{a}: expected {code}"));
                assert_eq!(format!("{err:?}"), camel(code), "{name} #{a}: error");
                checked += 1;
                continue;
            }
            let result = outcome.unwrap_or_else(|e| panic!("{name} #{a}: {e:?}"));
            assert_eq!(result.amount_out, u(&action["amountOut"]), "{name} #{a}: amountOut");
            assert_eq!(u64::from(result.crossings), action["crossings"].as_u64().unwrap(), "{name} #{a}: crossings");
            assert_eq!(result.interior_bitmap, u(&action["interiorBitmap"]).as_u32(), "{name} #{a}: bitmap");
            assert_eq!(result.reserves, four(&action["reserves"]), "{name} #{a}: reserves");
            ticks = attempt;
            reserves = result.reserves;

            let ranges = attribute(&result.state, &ticks, &reserves).unwrap_or_else(|e| panic!("{name} #{a}: {e:?}"));
            for (r, (range, want)) in ranges.iter().zip(action["attribution"].as_array().unwrap()).enumerate() {
                assert_eq!(range.virtual_offset, u(&want["virtualOffset"]), "{name} #{a} range {r}");
                assert_eq!(range.coordinates, four(&want["coordinates"]), "{name} #{a} range {r}");
                assert_eq!(range.real_inventory, four(&want["realInventory"]), "{name} #{a} range {r}");
            }
            checked += 1;
        }
    }
    assert_eq!(checked, 240);
}

/// Solana path: every fixture swap planned off-chain must settle on-chain to the same
/// result, within a few wei of the Solidity engine and never above it; overpaying
/// segments must be rejected.
#[test]
fn planned_swaps_settle_and_overpayment_is_rejected() {
    use orbital_math::segmented::{Segment, plan_swap};
    use orbital_math::settle::settle_swap;

    let quote = fixture("quote-vectors-v1.json");
    let random: Value = serde_json::from_str(
        &fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/random-v1.json")).unwrap(),
    )
    .unwrap();
    let mut sequences = vec![(quote["ticks"].clone(), quote["initialReserves"].clone(), quote["actions"].clone())];
    for s in random["sequences"].as_array().unwrap() {
        sequences.push((s["ticks"].clone(), s["initialReserves"].clone(), s["actions"].clone()));
    }

    let (mut swaps, mut max_gap, mut rejected) = (0, U256::ZERO, 0);
    for (ticks_json, initial, actions) in &sequences {
        let n = ticks_json.as_array().unwrap().len();
        let mut ticks = ticks_from(ticks_json, (1u32 << n) - 1);
        let mut reserves = four(initial);
        for (a, action) in actions.as_array().unwrap().iter().enumerate() {
            if action.get("error").is_some() {
                continue;
            }
            let (input, output) = (action["input"].as_u64().unwrap() as u8, action["output"].as_u64().unwrap() as u8);
            let amount_in = u(&action["amountIn"]);
            let state = aggregate(&ticks).unwrap();

            let exact = swap_exact_in(&state, &mut ticks.clone(), &reserves, input, output, amount_in).unwrap();
            let (planned, segments) = plan_swap(&state, &mut ticks.clone(), &reserves, input, output, amount_in)
                .unwrap_or_else(|e| panic!("plan #{a}: {e:?}"));
            assert!(planned.amount_out <= exact.amount_out, "#{a}: planned pays more than Solidity");
            let gap = exact.amount_out - planned.amount_out;
            assert!(gap <= U256::new(4 * segments.len() as u128), "#{a}: gap {gap}");
            if gap > max_gap {
                max_gap = gap;
            }
            assert_eq!(planned.interior_bitmap, exact.interior_bitmap, "#{a}: bitmap");

            let mut settled_ticks = ticks.clone();
            let settled = settle_swap(&state, &mut settled_ticks, &reserves, input, output, amount_in, &segments)
                .unwrap_or_else(|e| panic!("settle #{a}: {e:?} segments {segments:?}"));
            assert_eq!(settled, planned, "#{a}: settled result");

            // Asking for more output on any segment (by a relative 1e-6, at least 1000 wei) must fail.
            for i in 0..segments.len() {
                let mut greedy: Vec<Segment> = segments.clone();
                let bump = (greedy[i].amount_out / 1_000_000).max(U256::new(1000));
                greedy[i].amount_out += bump;
                let outcome = settle_swap(&state, &mut ticks.clone(), &reserves, input, output, amount_in, &greedy);
                assert!(outcome.is_err(), "#{a}: segment {i} overpayment by {bump} accepted");
                rejected += 1;
            }
            // Skipping the crossing (one segment for the whole trade) must fail when there was one.
            if segments.len() > 1 {
                let merged = [Segment { amount_in, amount_out: planned.amount_out }];
                assert!(settle_swap(&state, &mut ticks.clone(), &reserves, input, output, amount_in, &merged).is_err());
                rejected += 1;
            }

            // Continue the sequence from the Solidity result, as the fixture does.
            let bitmap = u(&action["interiorBitmap"]).as_u32();
            for (i, t) in ticks.iter_mut().enumerate() {
                t.is_interior = bitmap & (1 << i) != 0;
            }
            reserves = four(&action["reserves"]);
            swaps += 1;
        }
    }
    println!("{swaps} swaps settled, largest shortfall vs Solidity {max_gap} wei, {rejected} bad plans rejected");
}
