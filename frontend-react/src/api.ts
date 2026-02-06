export function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export async function postJson<T>(
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
