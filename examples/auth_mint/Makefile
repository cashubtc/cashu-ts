# One-liner setup / teardown for CDK Mint + Keycloak demo

COMPOSE = docker compose
DEMO_CMD = npx tsx auth_password_example.ts
DEMO_DEVA = npx tsx auth_device_example.ts
DEMO_PKCE = npx tsx auth_pkce_example.ts

MINT_URL ?= http://localhost:3338
OIDC_DISCOVERY ?= http://localhost:8080/realms/cashu/.well-known/openid-configuration
WAIT_TIMEOUT ?= 120

# Poll rather than sleep: the realm import and the mint's OIDC discovery take
# far longer on a cold CI runner than they do locally.
.PHONY: wait
wait:
	@echo "⌛ Waiting up to $(WAIT_TIMEOUT)s for Keycloak + mint..."
	@elapsed=0; \
	until curl -sf --max-time 5 "$(OIDC_DISCOVERY)" >/dev/null 2>&1 \
		&& curl -sf --max-time 5 "$(MINT_URL)/v1/info" >/dev/null 2>&1; do \
		if [ $$elapsed -ge $(WAIT_TIMEOUT) ]; then \
			echo "❌ Timed out. Last 200 lines of container logs:"; \
			$(COMPOSE) logs --tail 200 || true; \
			exit 1; \
		fi; \
		sleep 2; \
		elapsed=$$((elapsed + 2)); \
	done; \
	echo "✅ Keycloak + mint ready after $${elapsed}s"

# Default target
.PHONY: demo-ci
demo-ci:
	$(COMPOSE) up -d --force-recreate
	$(MAKE) wait
	$(DEMO_CMD)
	$(COMPOSE) down -v

up:
	@echo "🚀 Starting Keycloak + Mint containers..."
	$(COMPOSE) up -d --force-recreate
	$(MAKE) wait
	@echo "✅ Containers started. Run 'make demo' to execute the auth flow."

down:
	@echo "🧹 Stopping and removing containers..."
	$(COMPOSE) down -v

logs:
	$(COMPOSE) logs -f

demo:
	@echo "🧪 Running PASSWORD Auth demo..."
	$(DEMO_CMD)

demo-device:
	@echo "🧪 Running DEVICE Auth demo..."
	$(DEMO_DEVA)

demo-pkce:
	@echo "🧪 Running PKCE Auth demo..."
	$(DEMO_PKCE)

clean: down
	@echo "🧽 Removing any leftover volumes..."
	docker volume prune -f
<<<<<<< HEAD
=======

# ------------------------
# Nutshell BLS (v3) variant — Keycloak + locally-built Nutshell auth mint
# ------------------------
.PHONY: nutshell-up nutshell-down nutshell-demo nutshell-demo-device nutshell-demo-pkce nutshell-demo-ci nutshell-logs nutshell-clean

nutshell-demo-ci:
	$(COMPOSE_NUT) up -d --build --force-recreate
	$(MAKE) wait COMPOSE="$(COMPOSE_NUT)"
	$(DEMO_CMD)
	$(COMPOSE_NUT) down -v

nutshell-up:
	@echo "🚀 Starting Keycloak + Nutshell (BLS, built from $(or $(NUT_BLS_PATH),../../../nutshell))..."
	$(COMPOSE_NUT) up -d --build --force-recreate
	$(MAKE) wait COMPOSE="$(COMPOSE_NUT)"
	@echo "✅ Containers started. Run 'make nutshell-demo' to execute the auth flow."

nutshell-down:
	@echo "🧹 Stopping and removing Nutshell containers..."
	$(COMPOSE_NUT) down -v

nutshell-logs:
	$(COMPOSE_NUT) logs -f

nutshell-demo:
	@echo "🧪 Running PASSWORD Auth demo against Nutshell mint..."
	$(DEMO_CMD)

nutshell-demo-device:
	@echo "🧪 Running DEVICE Auth demo against Nutshell mint..."
	$(DEMO_DEVA)

nutshell-demo-pkce:
	@echo "🧪 Running PKCE Auth demo against Nutshell mint..."
	$(DEMO_PKCE)

nutshell-clean: nutshell-down
	@echo "🧽 Removing any leftover volumes..."
	docker volume prune -f
>>>>>>> 12ce8b2 (chore(ci): run the auth demo against a live mint (#1139))
