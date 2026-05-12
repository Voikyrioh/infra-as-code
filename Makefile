VPS_HOST ?= $(error VPS_HOST is required — ex: make db-mysql VPS_HOST=1.2.3.4 VPS_PORT=22)
VPS_PORT ?= 22

.PHONY: db-mysql db-postgres

db-mysql:
	@echo "Tunnel MySQL actif → localhost:3306 (Ctrl+C pour fermer)"
	ssh -L 3306:shared_mysql:3306 -N deploy@$(VPS_HOST) -p $(VPS_PORT)

db-postgres:
	@echo "Tunnel PostgreSQL actif → localhost:5432 (Ctrl+C pour fermer)"
	ssh -L 5432:shared_postgres:5432 -N deploy@$(VPS_HOST) -p $(VPS_PORT)
