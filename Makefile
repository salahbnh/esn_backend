# Convenience targets for the dev infrastructure (postgres + minio + keycloak).

.PHONY: up down logs reset ps

# Start all infra services in the background.
up:
	docker compose up -d

# Stop and remove containers (keeps volumes / data).
down:
	docker compose down

# Tail logs from all services.
logs:
	docker compose logs -f

# Show running services.
ps:
	docker compose ps

# Nuke everything including volumes (fresh DB, storage, realm re-import).
reset:
	docker compose down -v
