import { useMemo, useState } from "react";
import { Model } from "survey-core";
import { Survey } from "survey-react-ui";
import { postJson, safeJsonStringify } from "../api";

const DEFAULT_DEPARTMENT = 18600;

export type StartFlowPageProps = {
  n8nBase: string;
  setN8nBase: (value: string) => void;
  goToApproval: () => void;
};

export function StartFlowPage({
  n8nBase,
  setN8nBase,
  goToApproval,
}: StartFlowPageProps) {
  const [startResponse, setStartResponse] = useState<unknown>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const resumeUrl =
    typeof startResponse === "object" &&
    startResponse !== null &&
    "resumeUrl" in (startResponse as Record<string, unknown>)
      ? String((startResponse as Record<string, unknown>).resumeUrl)
      : null;

  return (
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
            Fluxo iniciado com sucesso. Para aprovar itens, acesse a{" "}
            <strong>Área de aprovação</strong>.
          </div>
          <div className="monoBox">
            {resumeUrl ?? safeJsonStringify(startResponse)}
          </div>
          <div className="actions" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn approve"
              onClick={goToApproval}
            >
              Ir para área de aprovação
            </button>
          </div>
        </>
      )}
    </section>
  );
}
