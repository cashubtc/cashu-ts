# One-liner setup / teardown for CDK Mint + Keycloak demo

COMPOSE = docker compose
DEMO_CMD = npx tsx auth_password_example.ts

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
	@echo "🧪 Running Auth BATs demo..."
	$(DEMO_CMD)

clean: down
	@echo "🧽 Removing any leftover volumes..."
	docker volume prune -f
