# Dev-only guard, require explicit opt-in
ifndef DEV
$(error Set DEV=1 to run these, eg: "DEV=1 make nutshell-up" or "export DEV=1")
endif

DOCKER ?= docker
PORT ?= 3338
BIND_ADDR ?= 127.0.0.1
INPUT_FEE_PPK ?= 100
FAKE_DELAY ?= 1
RATE_LIMIT_PM ?= 200

# ------------------------
# Pin versions
# ------------------------
CDK_IMAGE_RC ?= cashubtc/mintd:0.14.3
CDK_IMAGE ?= cashubtc/mintd:0.15.1
CDK_NAME ?= cashu-dev-cdk

NUT_IMAGE_RC ?= cashubtc/nutshell:0.18.2
NUT_IMAGE ?= cashubtc/nutshell:0.19.2
NUT_NAME ?= cashu-dev-nutshell

# ------------------------
# Docker envs per dependency
# ------------------------
CDK_ENVS = \
	-e CDK_MINTD_DATABASE=sqlite \
	-e CDK_MINTD_LN_BACKEND=fakewallet \
	-e CDK_MINTD_INPUT_FEE_PPK=$(INPUT_FEE_PPK) \
	-e CDK_MINTD_LISTEN_HOST=0.0.0.0 \
	-e CDK_MINTD_LISTEN_PORT=3338 \
	-e CDK_MINTD_FAKE_WALLET_MIN_DELAY=$(FAKE_DELAY) \
	-e CDK_MINTD_FAKE_WALLET_MAX_DELAY=$(FAKE_DELAY) \
	-e CDK_MINTD_MNEMONIC='abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

NUT_ENVS = \
	-e MINT_LIGHTNING_BACKEND=FakeWallet \
	-e MINT_INPUT_FEE_PPK=$(INPUT_FEE_PPK) \
	-e MINT_LISTEN_HOST=0.0.0.0 \
	-e MINT_LISTEN_PORT=3338 \
	-e MINT_PRIVATE_KEY=TEST_PRIVATE_KEY \
	-e FAKEWALLET_DELAY_PAYMENT=TRUE \
	-e FAKEWALLET_DELAY_OUTGOING_PAYMENT=$(FAKE_DELAY) \
	-e FAKEWALLET_DELAY_INCOMING_PAYMENT=$(FAKE_DELAY) \
	-e MINT_TRANSACTION_RATE_LIMIT_PER_MINUTE=$(RATE_LIMIT_PM)

# ------------------------
# Platform flag
# ------------------------
UNAME_M := $(shell uname -m)
ifeq ($(filter arm64 aarch64,$(UNAME_M)),$(UNAME_M))
  PLATFORM ?= linux/amd64
endif
PLATFORM_FLAG := $(if $(PLATFORM),--platform=$(PLATFORM),)

# ------------------------
# CDK Targets
# ------------------------
.PHONY: cdk-up cdk-down cdk-stable-up cdk-rc-up cdk-stable-down cdk-rc-down print-mint-images

cdk-up:
	-$(DOCKER) rm -f -v $(CDK_NAME) >/dev/null 2>&1 || true
	$(DOCKER) run --pull=always -d --name $(CDK_NAME) $(PLATFORM_FLAG) \
		-p $(BIND_ADDR):$(PORT):3338 \
		$(CDK_ENVS) \
		$(CDK_IMAGE)

cdk-down:
	-$(DOCKER) rm -f -v $(CDK_NAME)

cdk-stable-up:
	$(MAKE) cdk-up CDK_NAME=cashu-dev-cdk CDK_IMAGE=$(CDK_IMAGE)

cdk-rc-up:
	$(MAKE) cdk-up CDK_NAME=cashu-dev-cdk-rc CDK_IMAGE=$(CDK_IMAGE_RC)

cdk-stable-down:
	$(MAKE) cdk-down CDK_NAME=cashu-dev-cdk

cdk-rc-down:
	$(MAKE) cdk-down CDK_NAME=cashu-dev-cdk-rc

print-mint-images:
	@echo "CDK_IMAGE=$(CDK_IMAGE)"
	@echo "CDK_IMAGE_RC=$(CDK_IMAGE_RC)"
	@echo "NUT_IMAGE=$(NUT_IMAGE)"
	@echo "NUT_IMAGE_RC=$(NUT_IMAGE_RC)"

# ------------------------
# Nutshell Targets
# ------------------------
.PHONY: nutshell-up nutshell-down nutshell-stable-up nutshell-rc-up nutshell-stable-down nutshell-rc-down

nutshell-up:
	-$(DOCKER) rm -f -v $(NUT_NAME) >/dev/null 2>&1 || true
	$(DOCKER) run --pull=always -d --name $(NUT_NAME) $(PLATFORM_FLAG) \
		-p $(BIND_ADDR):$(PORT):3338 \
		$(NUT_ENVS) \
		$(NUT_IMAGE) poetry run mint

nutshell-down:
	-$(DOCKER) rm -f -v $(NUT_NAME)

nutshell-stable-up:
	$(MAKE) nutshell-up NUT_NAME=cashu-dev-nutshell NUT_IMAGE=$(NUT_IMAGE)

nutshell-rc-up:
	$(MAKE) nutshell-up NUT_NAME=cashu-dev-nutshell-rc NUT_IMAGE=$(NUT_IMAGE_RC)

nutshell-stable-down:
	$(MAKE) nutshell-down NUT_NAME=cashu-dev-nutshell

nutshell-rc-down:
	$(MAKE) nutshell-down NUT_NAME=cashu-dev-nutshell-rc
