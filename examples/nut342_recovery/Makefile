# One-liner setup / teardown for the draft NUT-342 efficient recovery demo.
#
# Builds a Nutshell mint from the open reference-implementation PR branch
# (cashubtc/nutshell#1081); no published image carries NUT-342 while the
# spec (cashubtc/nuts#342) is a draft.
#
# Targets: up / demo / down / demo-ci / logs

DOCKER ?= docker
BIND_ADDR ?= 127.0.0.1
PORT ?= 3338

NUT_342_CTX ?= https://github.com/cashubtc/nutshell.git\#feat/efficient-recovery
NUT_342_IMAGE ?= cashu-dev-nutshell-342:local
NUT_342_NAME ?= cashu-dev-nutshell-342

DEMO_CMD = npx tsx nut342_recovery_demo.ts

NUT_ENVS = \
	-e MINT_LIGHTNING_BACKEND=FakeWallet \
	-e MINT_INPUT_FEE_PPK=100 \
	-e MINT_LISTEN_HOST=0.0.0.0 \
	-e MINT_LISTEN_PORT=3338 \
	-e MINT_PRIVATE_KEY=TEST_PRIVATE_KEY

.PHONY: build up down demo demo-ci logs

build:
	$(DOCKER) build -t $(NUT_342_IMAGE) $(NUT_342_CTX)

up: build
	-$(DOCKER) rm -f -v $(NUT_342_NAME) >/dev/null 2>&1 || true
	$(DOCKER) run -d --name $(NUT_342_NAME) \
		-p $(BIND_ADDR):$(PORT):3338 \
		$(NUT_ENVS) \
		$(NUT_342_IMAGE) poetry run mint
	@echo "✅ NUT-342 mint running on http://localhost:$(PORT). Run 'make demo'."

down:
	-$(DOCKER) rm -f -v $(NUT_342_NAME)

demo:
	@echo "🧪 Running NUT-342 efficient recovery demo..."
	$(DEMO_CMD)

demo-ci: up
	@sleep 5
	$(DEMO_CMD)
	$(MAKE) down

logs:
	$(DOCKER) logs -f $(NUT_342_NAME)
