.PHONY: test test-circuit test-contracts test-web build-web

test: test-circuit test-contracts test-web

test-circuit:
	node --test circuits/test/policy.test.mjs

test-contracts:
	forge test --root contracts -vv

test-web:
	cd web && npm test -- --run

build-web:
	cd web && npm run build
