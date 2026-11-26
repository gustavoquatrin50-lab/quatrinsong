import type { Job } from "./types";

export type Health = {
  status: string;
  worker_online: boolean;
  separation_available: boolean;
  transcription_available: boolean;
  lyrics_available?: boolean;
  version?: string;
  build?: { version: string; revision: string; source: string };
  device: string;
};
export function serverBase(): string {
  return localStorage.getItem("riffsync-api") || "";
}
function workspaceKey() {
  let key = localStorage.getItem("riffsync-workspace");
  if (!key) {
    key = crypto.randomUUID() + crypto.randomUUID();
    localStorage.setItem("riffsync-workspace", key);
  }
  return key;
}
export async function request<T>(
  base: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${base.replace(/\/$/, "")}/api${path}`, {
    ...init,
    headers: { ...init.headers, "X-Workspace-Key": workspaceKey() },
    signal: init.signal || AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    let message = `Erro ${response.status}`;
    try {
      const body = await response.json();
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      /* use HTTP status */
    }
    throw new Error(message);
  }
  return response.json();
}
export const health = (base: string) =>
  request<Health>(base, "/health", { signal: AbortSignal.timeout(5000) });
export async function createJob(
  base: string,
  file: Blob,
  name: string,
  model: string,
  transcribe: boolean,
  lyrics = true,
  lyricsLanguage = "",
) {
  const body = new FormData();
  body.append("file", file, name);
  body.append("model", model);
  body.append("transcribe", String(transcribe));
  body.append("lyrics", String(lyrics));
  body.append("lyrics_language", lyricsLanguage);
  return request<Job>(base, "/jobs", {
    method: "POST",
    body,
    signal: AbortSignal.timeout(180000),
  });
}
export const getJob = (base: string, id: string) =>
  request<Job>(base, `/jobs/${id}`);
export const cancelJob = (base: string, id: string) =>
  request<Job>(base, `/jobs/${id}/cancel`, { method: "POST" });
export const retryJob = (base: string, id: string) =>
  request<Job>(base, `/jobs/${id}/retry`, { method: "POST" });
export const requestLyrics = (base: string, id: string, language = "") => {
  const body = new FormData();
  body.append("language", language);
  body.append("source", "original");
  return request<Job>(base, `/jobs/${id}/lyrics`, { method: "POST", body });
};
export const cancelLyrics = (base: string, id: string) =>
  request<Job>(base, `/jobs/${id}/lyrics/cancel`, { method: "POST" });
export const reviseJob = (
  base: string,
  id: string,
  operation: "chords" | "vocals_drums",
) => {
  const body = new FormData();
  body.append("operation", operation);
  return request<Job>(base, `/jobs/${id}/revise`, { method: "POST", body });
};
type PartialAudio = {
  parts: Blob[];
  received: number;
  total: number;
  etag: string;
  type: string;
};
const partialAudio = new Map<string, PartialAudio>();
const CHUNK_BYTES = 1024 * 1024;
class TransferError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

async function validateAudio(blob: Blob, playback: boolean) {
  const header = new TextDecoder("ascii").decode(
    await blob.slice(0, 12).arrayBuffer(),
  );
  const wav = blob.size >= 44 && /^(RIFF|RF64)[\s\S]{4}WAVE$/.test(header);
  const m4a = playback && blob.size >= 16 && header.slice(4, 8) === "ftyp";
  if (!wav && !m4a)
    throw new Error("O áudio recebido está incompleto ou tem formato inválido");
  return blob;
}

export async function artifact(
  base: string,
  id: string,
  file: string,
  signal?: AbortSignal,
  playback = false,
) {
  const url = `${base.replace(/\/$/, "")}/api/jobs/${id}/files/${encodeURIComponent(file)}${playback ? "?format=m4a" : ""}`;
  // Keep successful ranges across a failed transfer and its recovery button.
  // Compressed audio only; cap retained partial files at 128 MiB.
  while (
    [...partialAudio.values()].reduce(
      (size, entry) => size + entry.received,
      0,
    ) >
    128 * 1024 ** 2
  )
    partialAudio.delete(partialAudio.keys().next().value!);
  let partial = partialAudio.get(url) || {
    parts: [],
    received: 0,
    total: 0,
    etag: "",
    type: "",
  };
  partialAudio.set(url, partial);
  try {
    while (!partial.total || partial.received < partial.total) {
      let accepted = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        signal?.throwIfAborted();
        try {
          const timeout = AbortSignal.timeout(180000);
          const response = await fetch(url, {
            headers: {
              "X-Workspace-Key": workspaceKey(),
              Range: `bytes=${partial.received}-${partial.received + CHUNK_BYTES - 1}`,
              ...(partial.etag ? { "If-Range": partial.etag } : {}),
            },
            credentials: "same-origin",
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
          });
          if (!response.ok) {
            let detail = "";
            try {
              const body = await response.json();
              if (typeof body.detail === "string") detail = body.detail;
            } catch {
              /* proxy response */
            }
            if ([401, 403].includes(response.status))
              detail ||=
                "A sessão de acesso ao servidor expirou. Reabra a aba do aplicativo e recupere o resultado.";
            throw new TransferError(
              `HTTP ${response.status}${detail ? ` — ${detail}` : ""}`,
              response.status >= 500,
            );
          }
          const type = response.headers.get("content-type") || "";
          if (type.includes("text/html") || type.includes("application/json"))
            throw new TransferError(
              "o servidor retornou uma página em vez do áudio. Reabra a aba do aplicativo para conferir a sessão de acesso.",
            );
          const blob = await response.blob();
          const expected = Number(response.headers.get("content-length"));
          if (
            !response.headers.get("content-encoding") &&
            expected > 0 &&
            expected !== blob.size
          )
            throw new TransferError("Download incompleto", true);
          if (response.status === 200) {
            // Older servers may ignore Range, or If-Range detected a new file revision.
            partialAudio.delete(url);
            return await validateAudio(blob, playback);
          }
          const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
            response.headers.get("content-range") || "",
          );
          if (!match)
            throw new TransferError(
              "O servidor não informou o intervalo do áudio. Atualize o servidor para habilitar a recuperação por partes.",
            );
          const [, left, right, size] = match.map(Number);
          if (
            left !== partial.received ||
            right - left + 1 !== blob.size ||
            right >= size ||
            size > 2 * 1024 ** 3 ||
            right >= partial.received + CHUNK_BYTES ||
            (partial.total && partial.total !== size)
          )
            throw new TransferError(
              "Download incompleto: intervalo de áudio inválido",
              true,
            );
          partial.parts.push(blob);
          partial.received += blob.size;
          partial.total = size;
          partial.etag = response.headers.get("etag") || "";
          partial.type = type;
          accepted = true;
          break;
        } catch (error) {
          signal?.throwIfAborted();
          if (error instanceof TransferError && !error.retryable) throw error;
          if (attempt === 1)
            throw new Error(
              `${error instanceof Error ? error.message : error}. Transferência interrompida em ${Math.round(partial.received / 1024)} KB; Recuperar resultado retoma os trechos recebidos.`,
            );
        }
      }
      if (!accepted) throw new Error("Não foi possível receber o áudio");
    }
    partialAudio.delete(url);
    const blob = await validateAudio(
      new Blob(partial.parts, { type: partial.type }),
      playback,
    );
    return blob;
  } catch (error) {
    if (signal?.aborted || (error instanceof TransferError && !error.retryable))
      partialAudio.delete(url);
    throw new Error(
      `${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
