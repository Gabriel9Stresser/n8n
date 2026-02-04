# Projeto n8n + SurveyJS – Fluxos de aprovação (local)

Projeto para rodar os workflows **Approval Sub-Workflow** e **Maria's** no n8n localmente e testá-los com um frontend em SurveyJS.

## Estrutura

- **`docker-compose.yml`** – Serviço n8n na porta 5678.
- **`workflows/`** – JSON dos fluxos para importar no n8n:
  - `approval-sub-workflow.json` – Sub-workflow de aprovação (Wait + validação).
  - `marias.json` – Workflow principal (webhook `/treasury` + cadeia de etapas).
- **`frontend-react/`** – App React (Vite) com SurveyJS que inicia o fluxo e envia aprovação/rejeição/devolução.
- **`frontend/`** – Versão HTML estática (legado/alternativa).

## Pré-requisitos

- [Docker](https://docs.docker.com/get-docker/) e Docker Compose, **ou** Node.js 20+ (para `npx n8n`).
- Navegador atualizado.

## 1. Subir o n8n

### Com Docker (recomendado)

```bash
docker compose up -d
```

Acesse: **http://localhost:5678**

### Sem Docker

```bash
npx n8n
```

Acesse: **http://localhost:5678**

## 2. Importar os workflows

**Opção A – Via script (recomendado):** `./import-workflows.sh` após `docker compose up -d` e aguardar ~30s.

**Opção B – Via interface:**

1. Abra o n8n em **http://localhost:5678**.
2. **Importe primeiro** o sub-workflow:
   - Menu (três traços) → **Workflows** → **Import from File** (ou arraste o arquivo).
   - Selecione **`workflows/approval-sub-workflow.json`**.
   - Salve e anote o **ID** do workflow (ex.: na URL `/workflow/XXXX`).
3. **Depois** importe o workflow principal:
   - Importe **`workflows/marias.json`**.
   - O fluxo Maria's chama o **Approval Sub-Workflow** pelo ID `LXR1D2E3XpKlxQ9t`. Se o n8n gerar outro ID ao importar o sub-workflow:
     - Abra o workflow **Maria's**.
     - Em cada nó **Execute Workflow**, clique no nó e escolha de novo **Approval Sub-Workflow** na lista.
   - Salve.
4. **Ative os dois workflows** (toggle “Active” no canto superior).

## 3. Rodar o frontend (React)

Na raiz do projeto:

```bash
cd frontend-react
npm install
npm run dev
```

Abra a URL que o Vite mostrar no terminal (ex.: **http://127.0.0.1:3001**).

## 3b. Rodar o frontend (HTML estático – opcional)

O frontend estático deve ser servido por um servidor HTTP (evita CORS e `file://`).

```bash
cd frontend
npx serve .
```

Ou, da raiz do projeto:

```bash
npx serve frontend
```

Abra no navegador o endereço indicado (ex.: **http://localhost:3000**).

## 4. Testar

1. **Iniciar o fluxo**

   - Preencha o formulário SurveyJS (Nome e Departamento).
   - Clique em **Concluir** (ou botão de envio do survey).
   - A página fará um POST em `http://localhost:5678/webhook/treasury` e exibirá o **resumeUrl** retornado.

2. **Aprovar / Rejeitar / Devolver**

   - Cada etapa de aprovação (Onboarding Team Review, DocuSign, etc.) usa um nó **Wait** no sub-workflow, com um URL próprio para receber o POST.
   - O **resumeUrl** que a resposta do webhook exibe é o da execução principal; para aprovar, é necessário o URL do nó **Wait** do sub-workflow.
   - No n8n: **Executions** → abra a execução que está em **Waiting** (do tipo “Approval Sub-Workflow”) → clique no nó **Wait** → copie o **Production URL** (ou Test URL).
   - Cole esse URL no campo “URL de resume” no frontend e clique em **Aprovar**, **Rejeitar** ou **Devolver**.
   - Repita para cada nova etapa (cada etapa terá um novo Wait e um novo URL).

3. **Fluxo esperado**
   - O sub-workflow espera um POST no URL de resume com corpo: `{ "action": "approve" | "reject" | "return", "department": 18600 }`.
   - O departamento deve ser **18600** para passar na validação do sub-workflow.
   - Em **approve**, o fluxo Maria's segue para a próxima etapa; em **reject** ou **return**, a cadeia não segue.

## URLs importantes

| Uso              | URL (n8n local)                                   |
| ---------------- | ------------------------------------------------- |
| Interface n8n    | http://localhost:5678                             |
| Webhook Treasury | http://localhost:5678/webhook/treasury (POST)     |
| Frontend         | http://localhost:3000 (após `npx serve frontend`) |

## Observações

- **CORS:** Se o frontend estiver em outro host/porta, o navegador pode bloquear requisições ao n8n. Servir o frontend e o n8n no mesmo host (ex.: localhost) ou usar um proxy evita o problema em ambiente local.
- **IDs dos workflows:** Ao importar, o n8n pode atribuir novos IDs. Se o Maria's não encontrar o sub-workflow, reabra o Maria's e reassocie cada nó “Execute Workflow” ao **Approval Sub-Workflow**.
- **Webhook em produção:** Para uso fora da máquina local (ex.: tunnel ou servidor), configure `WEBHOOK_URL` no n8n conforme a [documentação](https://docs.n8n.io/hosting/configuration/environment-variables/endpoints).
