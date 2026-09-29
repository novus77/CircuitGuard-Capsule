.PHONY: test test-circuit test-contracts test-web test-manifest build-web

test: test-circuit test-contracts test-web test-manifest

test-circuit:
	node --test circuits/test/policy.test.mjs

test-contracts:
	forge test --root contracts -vv

test-web:
	cd web && npm test -- --run

test-manifest:
	node --test scripts/build-deployment-manifest.test.mjs

build-web:
	cd web && npm run build
