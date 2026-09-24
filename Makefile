.PHONY: check contracts-check reference-check simulator-check app-check

PYTHON ?= python3

check: contracts-check reference-check simulator-check app-check

contracts-check:
	cd contracts && forge fmt --check
	cd contracts && forge build --sizes
	cd contracts && forge test -vv

reference-check:
	$(PYTHON) -m unittest discover -s reference/tests -v

simulator-check:
	cd packages/simulator && npm test

app-check:
	cd app && npm ci --no-audit --no-fund
	cd app && npm test
	cd app && npm run typecheck
	cd app && npm run build
