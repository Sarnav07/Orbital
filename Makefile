.PHONY: check contracts-check

check: contracts-check

contracts-check:
	cd contracts && forge fmt --check
	cd contracts && forge build --sizes
	cd contracts && forge test -vv
