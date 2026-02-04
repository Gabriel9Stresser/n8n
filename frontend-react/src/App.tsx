import "./App.css";
import { useMemo, useState } from "react";
import { Model } from "survey-core";
import { Survey } from "survey-react-ui";

const DEFAULT_DEPARTMENT = 18600;
const DEFAULT_N8N_BASE = "http://localhost:5678";

const APPROVAL_STEPS = [
  "Onboarding Team Review",
  "DocuSign - Customer Signature",
  "Compliance Review",
  "Core Setup",
  "iBanking Setup",
  "Schedule Training",
  "Profile Activation",
  "User SMS",
  "Training Session",
] as const;

function App() {
  const [activeTab, setActiveTab] = useState<"start" | "approve">("start");
  const [selectedStep, setSelectedStep] = useState<string>(APPROVAL_STEPS[0]);
  const [n8nBase, setN8nBase] = useState<string>(
    import.meta.env.VITE_N8N_BASE ?? DEFAULT_N8N_BASE
  );
  const [startResponse, setStartResponse] = useState<unknown>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const [waitUrls, setWaitUrls] = useState<Record<string, string>>({});
  const [approvalResponse, setApprovalResponse] = useState<unknown>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [n8nApiKey, setN8nApiKey] = useState("");
  const [pendingExecutions, setPendingExecutions] = useState<
    Array<{
      id: string;
      workflowName: string;
      stepName?: string;
      waitUrl: string;
    }>
  >([]);
  const [loadingPending, setLoadingPending] = useState(false);

  const surveyModel = useMemo(() => {
    const m = new Model({
      title: "Dados para iniciar o fluxo Treasury",
      description:
        "Ao concluir, enviaremos um POST para o webhook /treasury do n8n.",
      showQuestionNumbers: "off",
      elements: [
        { name: "name", title: "Nome", type: "text", isRequired: true },
        {
          name: "department",
          title: "Departamento",
          type: "text",
          inputType: "number",
          isRequired: true,
          defaultValue: DEFAULT_DEPARTMENT,
          placeholder: "Ex: 18600",
        },
      ],
    });

    m.onComplete.add(async (sender) => {
      setStartError(null);
      setStartResponse(null);
      setApprovalError(null);
      setApprovalResponse(null);

      const data = sender.data as {
        name?: string;
        department?: number | string;
      };
      const department =
        data.department != null ? Number(data.department) : DEFAULT_DEPARTMENT;

      setBusy(true);
      try {
        const resp = await postJson<{ resumeUrl?: string }>(
          `${n8nBase.replace(/\/$/, "")}/webhook/treasury`,
          {
            name: data.name,
            department,
          }
        );
        if (!resp.ok) {
          const hint =
            resp.status === 404 || resp.status === 500
              ? " Importe e ative o workflow Maria's no n8n (http://localhost:5678)."
              : "";
          setStartError(`Falha ao iniciar fluxo (HTTP ${resp.status}).${hint}`);
          setStartResponse(resp.json ?? resp.text ?? null);
          return;
        }
        setStartResponse(resp.json ?? resp.text ?? null);
      } catch (e) {
        setStartError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    });

    return m;
  }, [n8nBase]);

  const waitUrl = waitUrls[selectedStep] ?? "";

  async function sendApproval(action: "approve" | "reject" | "return") {
    setApprovalError(null);
    setApprovalResponse(null);

    const url = waitUrl.trim();
    if (!url) {
      setApprovalError(
        "Informe o URL do nó Wait (copie do n8n via View sub-execution)."
      );
      return;
    }

    setBusy(true);
    try {
      const resp = await postJson<unknown>(url, {
        action,
        department: DEFAULT_DEPARTMENT,
      });
      if (!resp.ok) {
        setApprovalError(`Falha ao enviar ação (HTTP ${resp.status}).`);
      }
      setApprovalResponse(resp.json ?? resp.text ?? null);
    } catch (e) {
      setApprovalError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const resumeUrl =
    typeof startResponse === "object" &&
    startResponse !== null &&
    "resumeUrl" in (startResponse as Record<string, unknown>)
      ? String((startResponse as Record<string, unknown>).resumeUrl)
      : null;

  const n8nHost = n8nBase.replace(/\/$/, "") || "http://localhost:5678";

  async function fetchPendingExecutions() {
    if (!n8nApiKey.trim()) return;
    setLoadingPending(true);
    setPendingExecutions([]);
    try {
      const base = n8nHost.replace(/\/$/, "") || window.location.origin;
      const res = await fetch(
        `${base}/api/v1/executions?status=waiting&limit=20`,
        { headers: { "X-N8N-API-KEY": n8nApiKey } }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        data?: Array<{ id: string; workflowData?: { name?: string } }>;
      };
      const list = Array.isArray(json.data) ? json.data : [];
      const approvalOnly = list.filter((e) =>
        (e.workflowData?.name ?? "").includes("Approval")
      );

      const results: Array<{
        id: string;
        workflowName: string;
        stepName?: string;
        waitUrl: string;
      }> = [];

      for (const e of approvalOnly) {
        const waitUrl = `${n8nHost.replace(/\/$/, "")}/webhook-waiting/${e.id}`;
        let stepName: string | undefined;
        try {
          const detailRes = await fetch(
            `${base}/api/v1/executions/${e.id}?includeData=true`,
            { headers: { "X-N8N-API-KEY": n8nApiKey } }
          );
          if (detailRes.ok) {
            const detail = (await detailRes.json()) as Record<string, unknown>;
            const resultData =
              (detail?.data as Record<string, unknown>)?.resultData ??
              detail?.resultData;
            const runData = (resultData as Record<string, unknown>)?.runData as
              | Record<
                  string,
                  Array<{
                    data?: {
                      main?: Array<Array<{ json?: Record<string, unknown> }>>;
                    };
                  }>
                >
              | undefined;
            if (runData) {
              for (const nodeRuns of Object.values(runData)) {
                const firstRun = nodeRuns?.[0];
                const jsonData = firstRun?.data?.main?.[0]?.[0]?.json;
                if (jsonData && typeof jsonData.stepName === "string") {
                  stepName = jsonData.stepName;
                  break;
                }
              }
            }
          }
        } catch {
          // ignora erro ao buscar detalhes
        }
        results.push({
          id: e.id,
          workflowName: e.workflowData?.name ?? "?",
          stepName,
          waitUrl,
        });
      }

      setPendingExecutions(results);
    } catch (e) {
      setPendingExecutions([
        { id: "erro", workflowName: String(e), waitUrl: "" },
      ]);
    } finally {
      setLoadingPending(false);
    }
  }

  function updateWaitUrl(step: string, value: string) {
    setWaitUrls((prev) => ({ ...prev, [step]: value }));
  }

  function selectPendingItem(item: (typeof pendingExecutions)[0]) {
    const step =
      item.stepName &&
      APPROVAL_STEPS.includes(item.stepName as (typeof APPROVAL_STEPS)[number])
        ? item.stepName
        : APPROVAL_STEPS[0];
    setSelectedStep(step);
    updateWaitUrl(step, item.waitUrl);
  }

  return (
    <div className="page">
      <header className="header">
        <h1>n8n + SurveyJS – Fluxo Treasury</h1>
        <p>Inicie o fluxo e aprove cada etapa. Use as abas para organizar.</p>
      </header>

      <div className="tabs">
        <button
          type="button"
          className={`tab ${activeTab === "start" ? "active" : ""}`}
          onClick={() => setActiveTab("start")}
        >
          Iniciar fluxo
        </button>
        <button
          type="button"
          className={`tab ${activeTab === "approve" ? "active" : ""}`}
          onClick={() => setActiveTab("approve")}
        >
          Aprovar etapas
        </button>
      </div>

      {activeTab === "start" && (
        <section className="card">
          <div className="row" style={{ marginBottom: 12 }}>
            <label htmlFor="n8nBase">n8n base URL</label>
            <input
              id="n8nBase"
              type="text"
              value={n8nBase}
              onChange={(e) => setN8nBase(e.target.value)}
              placeholder="http://localhost:5678"
            />
          </div>

          <Survey model={surveyModel} />

          {busy && <div className="msg">Processando...</div>}
          {startError && <div className="msg error">Erro: {startError}</div>}
          {startResponse != null && (
            <>
              <div className="hint">
                Resposta do webhook. Para aprovar, vá na aba{" "}
                <strong>Aprovar etapas</strong>.
              </div>
              <div className="monoBox">
                {resumeUrl ?? safeJsonStringify(startResponse)}
              </div>
            </>
          )}
        </section>
      )}

      {activeTab === "approve" && (
        <section className="card">
          <h2>Etapas de aprovação</h2>

          <div className="pendingSection">
            <h3>Itens pendentes (opcional)</h3>
            <div className="row" style={{ marginBottom: 8 }}>
              <label>API Key n8n (para buscar execuções em espera)</label>
              <input
                type="password"
                value={n8nApiKey}
                onChange={(e) => setN8nApiKey(e.target.value)}
                placeholder="Cole sua API key do n8n"
              />
            </div>
            <button
              type="button"
              className="btn"
              onClick={fetchPendingExecutions}
              disabled={loadingPending || !n8nApiKey.trim()}
            >
              {loadingPending ? "Carregando..." : "Buscar pendentes"}
            </button>
            {pendingExecutions.length > 0 && (
              <div className="pendingList">
                {pendingExecutions.map((e) => (
                  <div key={e.id} className="pendingItem">
                    <div>
                      <strong>{e.stepName ?? e.workflowName}</strong>
                      <span className="hint"> – Execução #{e.id}</span>
                    </div>
                    <code className="pendingUrl">{e.waitUrl}</code>
                    <button
                      type="button"
                      className="btn approve"
                      onClick={() => selectPendingItem(e)}
                    >
                      Usar este
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="stepTabs">
            {APPROVAL_STEPS.map((step) => (
              <button
                key={step}
                type="button"
                className={`stepTab ${selectedStep === step ? "active" : ""}`}
                onClick={() => setSelectedStep(step)}
              >
                {step}
              </button>
            ))}
          </div>

          <div className="approvalPanel">
            <h3>{selectedStep}</h3>
            <div className="hint">
              No n8n: Maria's → View sub-execution → nó Wait → copie Production
              URL.
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <label>URL do Wait</label>
              <input
                type="text"
                value={waitUrls[selectedStep] ?? ""}
                onChange={(e) => updateWaitUrl(selectedStep, e.target.value)}
                placeholder="http://localhost:5678/webhook-waiting/..."
              />
            </div>
            <div className="actions">
              <button
                type="button"
                className="btn approve"
                onClick={() => sendApproval("approve")}
                disabled={busy}
              >
                Aprovar
              </button>
              <button
                type="button"
                className="btn reject"
                onClick={() => sendApproval("reject")}
                disabled={busy}
              >
                Rejeitar
              </button>
              <button
                type="button"
                className="btn return"
                onClick={() => sendApproval("return")}
                disabled={busy}
              >
                Devolver
              </button>
            </div>
            {approvalError && (
              <div className="msg error">Erro: {approvalError}</div>
            )}
            {approvalResponse != null && (
              <div className="msg success">
                Resposta: {safeJsonStringify(approvalResponse)}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

export default App;

function safeJsonStringify(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function postJson<T>(
  url: string,
  body: unknown
): Promise<{ ok: boolean; status: number; json?: T; text?: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const status = res.status;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const json = (await res.json()) as T;
    return { ok: res.ok, status, json };
  }
  const text = await res.text();
  return { ok: res.ok, status, text };
}
