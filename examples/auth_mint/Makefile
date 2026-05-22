# One-liner setup / teardown for CDK Mint + Keycloak demo
#
# CDK targets (default compose):  up / down / demo / demo-ci / logs / clean
# Nutshell BLS targets:           nutshell-up / nutshell-down / nutshell-demo
#                                 nutshell-demo-ci / nutshell-logs / nutshell-clean
# Nutshell builds from $(NUT_BLS_PATH) (default ../../../nutshell).

COMPOSE = docker compose
COMPOSE_NUT = $(COMPOSE) -f docker-compose-nutshell.yml
DEMO_CMD = npx tsx auth_password_example.ts
DEMO_DEVA = npx tsx auth_device_example.ts
DEMO_PKCE = npx tsx auth_pkce_example.ts


# Default target
.PHONY: demo-ci
demo-ci:
	$(COMPOSE) up -d --force-recreate
	@sleep 20
	$(DEMO_CMD)
	$(COMPOSE) down -v

up:
	@echo "🚀 Starting Keycloak + Mint containers..."
	$(COMPOSE) up -d --force-recreate
	@echo "⌛ Waiting for Keycloak to be ready (approx 10s)..."
	@sleep 10
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

# ------------------------
# Nutshell BLS (v3) variant — Keycloak + locally-built Nutshell auth mint
# ------------------------
.PHONY: nutshell-up nutshell-down nutshell-demo nutshell-demo-device nutshell-demo-pkce nutshell-demo-ci nutshell-logs nutshell-clean

nutshell-demo-ci:
	$(COMPOSE_NUT) up -d --build --force-recreate
	@sleep 20
	$(DEMO_CMD)
	$(COMPOSE_NUT) down -v

nutshell-up:
	@echo "🚀 Starting Keycloak + Nutshell (BLS, built from $(or $(NUT_BLS_PATH),../../../nutshell))..."
	$(COMPOSE_NUT) up -d --build --force-recreate
	@echo "⌛ Waiting for Keycloak + mint to be ready (approx 20s)..."
	@sleep 20
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
