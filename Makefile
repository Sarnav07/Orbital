.PHONY: check contracts-check reference-check

PYTHON ?= python3

check: contracts-check reference-check

contracts-check:
	cd contracts && forge fmt --check
	cd contracts && forge build --sizes
	cd contracts && forge test -vv

reference-check:
	$(PYTHON) -m unittest discover -s reference/tests -v
