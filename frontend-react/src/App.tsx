import "./App.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Model } from "survey-core";
import { Survey } from "survey-react-ui";

const DEFAULT_DEPARTMENT = 18600;
const DEFAULT_N8N_BASE = "http://localhost:5678";

export type StepItem = { id: string; name: string; stepName?: string };

const FALLBACK_STEPS: StepItem[] = [
  "Onboarding Team Review",
  "DocuSign - Customer Signature",
  "Compliance Review",
  "Core Setup",
  "iBanking Setup",
  "Schedule Training",
  "Profile Activation",
  "User SMS",
  "Training Session",
].map((name) => ({ id: name, name, stepName: name }));

function App() {
  const [activeTab, setActiveTab] = useState<"start" | string>("start");
  const [steps, setSteps] = useState<StepItem[]>([]);
  const [stepsLoading, setStepsLoading] = useState(false);
  const [stepsError, setStepsError] = useState<string | null>(null);
  const [n8nBase, setN8nBase] = useState<string>(
    import.meta.env.VITE_N8N_BASE ?? DEFAULT_N8N_BASE,
  );
  const [startResponse, setStartResponse] = useState<unknown>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<
    Record<string, { type: "success" | "error"; msg: string }>
  >({});

  const [pendingExecutions, setPendingExecutions] = useState<
    Array<{
      id: string;
      workflowName: string;
      stepName?: string;
      waitUrl: string;
    }>
  >([]);
  const [loadingPending, setLoadingPending] = useState(false);
  const [pendingError, setPendingError] = useState<string | null>(null);

  const effectiveSteps = steps.length > 0 ? steps : FALLBACK_STEPS;

  // Rótulos únicos para abas: evita duplicata quando a API devolve mesmo stepName em nós diferentes
  const stepsWithDisplayLabel = effectiveSteps.map((step, i) => {
    const stepName = step.stepName ?? step.name;
    const alreadyUsed = effectiveSteps
      .slice(0, i)
      .some((s) => (s.stepName ?? s.name) === stepName);
    return {
      ...step,
      displayLabel: alreadyUsed ? step.name : stepName,
    };
  });

  useEffect(() => {
    let cancelled = false;
    setStepsError(null);
    setStepsLoading(true);
    const base = n8nBase.replace(/\/$/, "") || DEFAULT_N8N_BASE;
    fetch(`${base}/webhook/marias-steps`)
      .then((res) =>
        res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)),
      )
      .then((data: { steps?: StepItem[]; error?: string }) => {
        if (cancelled) return;
        const list = Array.isArray(data?.steps) ? data.steps : [];
        setSteps(list);
        if (data?.error) setStepsError(data.error);
        setActiveTab((current) => {
          if (current === "start") return "start";
          const ids =
            list.length > 0
              ? list.map((s) => s.id)
              : FALLBACK_STEPS.map((s) => s.id);
          return ids.includes(current) ? current : (ids[0] ?? "start");
        });
      })
      .catch((e) => {
        if (!cancelled) {
          setSteps([]);
          setStepsError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setStepsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [n8nBase]);

  const n8nHost = n8nBase.replace(/\/$/, "") || "http://localhost:5678";

  const fetchPendingExecutions = useCallback(async () => {
    setLoadingPending(true);
    setPendingExecutions([]);
    setPendingError(null);
    try {
      const base = n8nHost.replace(/\/$/, "") || window.location.origin;
      const res = await fetch(`${base}/webhook/approval-queue`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        items?: Array<{
          id: string;
          workflowName: string;
          stepName?: string | null;
          waitUrl: string;
        }>;
        error?: string;
      };
      const items = Array.isArray(json?.items) ? json.items : [];
      if (json?.error) setPendingError(json.error);

      const results = items.map((e) => ({
        id: e.id,
        workflowName: e.workflowName ?? "?",
        stepName: e.workflowName ?? "?",
        waitUrl: e.waitUrl,
      }));

      setPendingExecutions(results);
    } catch (e) {
      setPendingError(e instanceof Error ? e.message : String(e));
      setPendingExecutions([
        { id: "erro", workflowName: String(e), waitUrl: "" },
      ]);
    } finally {
      setLoadingPending(false);
    }
  }, [n8nHost]);

  useEffect(() => {
    if (activeTab !== "start") {
      fetchPendingExecutions();
    }
  }, [activeTab, fetchPendingExecutions]);

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
          },
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

  const currentStep =
    activeTab !== "start"
      ? (effectiveSteps.find((s) => s.id === activeTab) ?? null)
      : null;
  const currentStepDisplayLabel = currentStep
    ? (stepsWithDisplayLabel.find((s) => s.id === currentStep.id)
        ?.displayLabel ?? currentStep.name)
    : "";
  async function sendApproval(
    item: { id: string; waitUrl: string },
    action: "approve" | "reject" | "return",
  ) {
    const url = item.waitUrl?.trim();
    if (!url) {
      setActionFeedback((prev) => ({
        ...prev,
        [item.id]: { type: "error", msg: "URL do Wait inválida." },
      }));
      return;
    }

    setBusy(true);
    setBusyItemId(item.id);
    setActionFeedback((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
    try {
      const resp = await postJson<unknown>(url, {
        action,
        department: DEFAULT_DEPARTMENT,
      });
      console.log({ resp });
      if (resp.ok) {
        setActionFeedback((prev) => ({
          ...prev,
          [item.id]: {
            type: "success",
            msg: `Ação "${action}" enviada. Atualize a lista.`,
          },
        }));
        fetchPendingExecutions();
      } else {
        setActionFeedback((prev) => ({
          ...prev,
          [item.id]: { type: "error", msg: `Falha (HTTP ${resp.status}).` },
        }));
      }
    } catch (e) {
      setActionFeedback((prev) => ({
        ...prev,
        [item.id]: {
          type: "error",
          msg: e instanceof Error ? e.message : String(e),
        },
      }));
    } finally {
      setBusy(false);
      setBusyItemId(null);
    }
  }

  const resumeUrl =
    typeof startResponse === "object" &&
    startResponse !== null &&
    "resumeUrl" in (startResponse as Record<string, unknown>)
      ? String((startResponse as Record<string, unknown>).resumeUrl)
      : null;

  console.log({ pendingExecutions });
  console.log({ currentStep });

  console.log({
    filter: pendingExecutions.filter(
      (e) => e.workflowName === currentStep?.name,
    ),
  });
  return (
    <div className="page">
      <header className="header">
        <h1>n8n + SurveyJS – Fluxo Treasury</h1>
        <p>Inicie o fluxo e aprove cada etapa. Use as abas para organizar.</p>
      </header>

      {stepsLoading && steps.length === 0 && (
        <div className="msg">Carregando etapas...</div>
      )}
      {stepsError && steps.length === 0 && (
        <div className="hint">Etapas (fallback): {stepsError}</div>
      )}
      <div className="tabs">
        <button
          type="button"
          className={`tab ${activeTab === "start" ? "active" : ""}`}
          onClick={() => setActiveTab("start")}
        >
          Iniciar fluxo
        </button>
        {stepsWithDisplayLabel.map((step) => (
          <button
            key={step.id}
            type="button"
            className={`tab ${activeTab === step.id ? "active" : ""}`}
            onClick={() => setActiveTab(step.id)}
          >
            {step.displayLabel}
          </button>
        ))}
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
                Resposta do webhook. Para aprovar, use a aba da etapa desejada.
              </div>
              <div className="monoBox">
                {resumeUrl ?? safeJsonStringify(startResponse)}
              </div>
            </>
          )}
        </section>
      )}

      {activeTab !== "start" && currentStep && (
        <section className="card">
          <h2>{currentStepDisplayLabel}</h2>

          <div className="pendingSection">
            <h3>Itens pendentes nesta etapa</h3>
            <div className="hint" style={{ marginBottom: 8 }}>
              A fila é buscada dinamicamente da API /webhook/approval-queue
              (etapa do Maria + waitUrl).
            </div>
            <button
              type="button"
              className="btn"
              onClick={fetchPendingExecutions}
              disabled={loadingPending}
            >
              {loadingPending ? "Carregando..." : "Buscar pendentes"}
            </button>
            {pendingError && (
              <div className="msg error" style={{ marginTop: 8 }}>
                {pendingError}
              </div>
            )}
            {pendingExecutions.filter(
              (e) => e.workflowName === currentStep.name,
            ).length > 0 ? (
              <div className="pendingList" style={{ marginTop: 8 }}>
                {pendingExecutions
                  .filter((e) => e.workflowName === currentStep.name)
                  .map((e) => (
                    <div key={e.id} className="pendingItem">
                      <div>
                        <strong>{e.stepName ?? e.workflowName}</strong>
                        <span className="hint"> – Execução #{e.id}</span>
                      </div>
                      <div className="actions" style={{ marginTop: 8 }}>
                        <button
                          type="button"
                          className="btn approve"
                          onClick={() => sendApproval(e, "approve")}
                          disabled={busy && busyItemId === e.id}
                        >
                          Aprovar
                        </button>
                        <button
                          type="button"
                          className="btn reject"
                          onClick={() => sendApproval(e, "reject")}
                          disabled={busy && busyItemId === e.id}
                        >
                          Rejeitar
                        </button>
                        <button
                          type="button"
                          className="btn return"
                          onClick={() => sendApproval(e, "return")}
                          disabled={busy && busyItemId === e.id}
                        >
                          Devolver
                        </button>
                      </div>
                      {actionFeedback[e.id] && (
                        <div
                          className={`msg ${
                            actionFeedback[e.id].type === "success"
                              ? "success"
                              : "error"
                          }`}
                          style={{ marginTop: 8 }}
                        >
                          {actionFeedback[e.id].msg}
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            ) : (
              pendingExecutions.length <= 0 && (
                <div className="hint" style={{ marginTop: 8 }}>
                  Nenhum item pendente nesta etapa.
                </div>
              )
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
  body: unknown,
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
