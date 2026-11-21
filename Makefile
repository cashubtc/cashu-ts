# Dev-only guard, require explicit opt-in
ifndef DEV
$(error Set DEV=1 to run these, eg: "DEV=1 make nutshell-up" or "export DEV=1")
endif

DOCKER ?= docker
PORT ?= 3338
BIND_ADDR ?= 127.0.0.1
INPUT_FEE_PPK ?= 100
FAKE_DELAY ?= 1
RATE_LIMIT_PM ?= 300

# ------------------------
# Pin versions
# ------------------------
CDK_IMAGE_RC ?= cashubtc/mintd:0.18.0-rc.3
CDK_IMAGE ?= cashubtc/mintd:0.18.3
CDK_NAME ?= cashu-dev-cdk
CDK_PULL ?= always

NUT_IMAGE_RC ?= cashubtc/nutshell:0.18.2
NUT_IMAGE ?= cashubtc/nutshell:0.22.1
NUT_NAME ?= cashu-dev-nutshell

# BLS (v3) CDK: built from a local checkout that carries nutroot.
CDK_BLS_PATH ?= ../cdk
CDK_BLS_IMAGE ?= cashu-dev-cdk-bls:local
CDK_BLS_NAME ?= cashu-dev-cdk-bls
# Issuance version for the config document; empty leaves the mint's default.
CDK_KEYSET_VERSION ?=
# The BLS mint's issuance version: "v3", or "02" for a checkout that predates the named versions.
CDK_BLS_KEYSET_VERSION ?= v3
# NUT-06 identity key (the NUT-06 example's), set with the issuance version: a mint issuing v3
# keysets will not start without one.
CDK_MINT_PUBKEY ?= 0338596797cef0627f653cd6568387361b00314add55d9f1ea9c94f46ae421e3da

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

# mintd >= 0.18 boots from a config document seeded once with `config init`;
# CDK_MINTD_* env vars no longer configure startup (only `env:` secret refs
# are read). This document mirrors CDK_ENVS. Exported so the container can
# write it to disk; older images lack the `config` subcommand and keep using
# the env vars. From 0.18.0-rc.3 `config init` also demands --new-mint (the
# containers always start on an empty database), hence the un-flagged retry.
define CDK_MINT_INFO_TOML


[mint_info]
pubkey = "$(CDK_MINT_PUBKEY)"
endef

define CDK_CONFIG_TOML
[info]
listen_host = "0.0.0.0"
listen_port = 3338
mnemonic = "env:CDK_MINTD_MNEMONIC"
input_fee_ppk = $(INPUT_FEE_PPK)
$(if $(CDK_KEYSET_VERSION),keyset_version = "$(CDK_KEYSET_VERSION)")

[database]
engine = "sqlite"

[payment_backend]
backend = "fakewallet"
unit = "sat"

[fake_wallet]
min_delay_time = $(FAKE_DELAY)
max_delay_time = $(FAKE_DELAY)$(if $(CDK_KEYSET_VERSION),$(CDK_MINT_INFO_TOML))
endef
export CDK_CONFIG_TOML

NUT_ENVS = \
	-e MINT_LIGHTNING_BACKEND=FakeWallet \
	-e MINT_INPUT_FEE_PPK=$(INPUT_FEE_PPK) \
	-e MINT_LISTEN_HOST=0.0.0.0 \
	-e MINT_LISTEN_PORT=3338 \
	-e MINT_PRIVATE_KEY=TEST_PRIVATE_KEY \
	-e FAKEWALLET_DELAY_PAYMENT=TRUE \
	-e FAKEWALLET_DELAY_OUTGOING_PAYMENT=$(FAKE_DELAY) \
	-e FAKEWALLET_DELAY_INCOMING_PAYMENT=$(FAKE_DELAY) \
	-e FAKEWALLET_PAYMENT_STATE=PENDING \
	-e MINT_TRANSACTION_RATE_LIMIT_PER_MINUTE=$(RATE_LIMIT_PM) \
	-e MINT_GLOBAL_RATE_LIMIT_PER_MINUTE=$(RATE_LIMIT_PM)

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
	$(DOCKER) run --pull=$(CDK_PULL) -d --name $(CDK_NAME) $(PLATFORM_FLAG) \
		-p $(BIND_ADDR):$(PORT):3338 \
		$(CDK_ENVS) \
		-e CDK_CONFIG_TOML \
		$(CDK_IMAGE) \
		sh -c 'printf "%s\n" "$$CDK_CONFIG_TOML" > /tmp/mintd.toml; cdk-mintd config init --file /tmp/mintd.toml --new-mint || cdk-mintd config init --file /tmp/mintd.toml || true; exec cdk-mintd'

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
	@echo "CDK_BLS_IMAGE=$(CDK_BLS_IMAGE) (built from $(CDK_BLS_PATH))"

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

# ------------------------
# CDK BLS (v3) Targets
# ------------------------
# Built natively (no PLATFORM_FLAG): BLS keygen through Rosetta is unusably
# slow on arm64 hosts. CDK keeps one active keyset per unit, so this mint
# issues v3 only.
.PHONY: cdk-bls-build cdk-bls-up cdk-bls-down

# Upstream Dockerfile.arm predates the bindings workspace members and the lockfile.
cdk-bls-build:
	awk '1; /^COPY crates/ { print "COPY bindings ./bindings"; print "COPY Cargo.lock ./Cargo.lock" }' \
		$(CDK_BLS_PATH)/Dockerfile.arm | $(DOCKER) build -f - -t $(CDK_BLS_IMAGE) $(CDK_BLS_PATH)

cdk-bls-up: cdk-bls-build
	$(MAKE) cdk-up CDK_NAME=$(CDK_BLS_NAME) CDK_IMAGE=$(CDK_BLS_IMAGE) CDK_KEYSET_VERSION=$(CDK_BLS_KEYSET_VERSION) PLATFORM= CDK_PULL=never

cdk-bls-down:
	$(MAKE) cdk-down CDK_NAME=$(CDK_BLS_NAME)
