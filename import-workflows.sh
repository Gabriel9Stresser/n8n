#!/bin/bash
# Importa os workflows na ordem correta preservando os IDs
# Execute: ./import-workflows.sh  (após docker compose up -d)
# Se já tiver workflows antigos, apague-os no n8n antes de rodar

set -e
CONTAINER=${1:-n8n}
WORKFLOWS_DIR="/workflows"

echo "1. Importando Approval Sub-Workflow (preserva ID LXR1D2E3XpKlxQ9t)..."
docker exec -u node "$CONTAINER" n8n import:workflow --input="$WORKFLOWS_DIR/approval-sub-workflow.json"

echo "2. Importando Maria's..."
docker exec -u node "$CONTAINER" n8n import:workflow --input="$WORKFLOWS_DIR/marias.json"

echo "3. Importando API – Etapas do Maria..."
docker exec -u node "$CONTAINER" n8n import:workflow --input="$WORKFLOWS_DIR/api-marias-steps.json"

echo "4. Importando API – Fila de Aprovação..."
docker exec -u node "$CONTAINER" n8n import:workflow --input="$WORKFLOWS_DIR/api-approval-queue.json"

echo "Pronto! Abra http://localhost:5678 e ATIVE os workflows (toggle Active)."
