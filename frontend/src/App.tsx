import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AudioLines,
  Check,
  ChevronDown,
  CircleHelp,
  Cloud,
  Download,
  FileMusic,
  FileText,
  FolderOpen,
  Guitar,
  Headphones,
  Keyboard,
  LoaderCircle,
  Repeat2 as Loop,
  Music2,
  Pause,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Save,
  Settings2,
  SkipBack,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  Wifi,
  X,
} from "lucide-react";
import { StudioAudio, preferMediaPlayback, renderMix } from "./audio";
import { mergeResult, receiveResult } from "./delivery";
import { createDemo } from "./demo";
import {
  artifact,
  cancelJob,
  retryJob,
  reviseJob,
  requestLyrics,
  cancelLyrics,
  createJob,
  getJob,
  health,
  serverBase,
} from "./api";
import type { Health } from "./api";
import { activeCue, formatTime, parseText, parseTime } from "./sync";
import {
  deleteSession,
  download,
  exportSession,
  importSession,
  listSessions,
  loadSession,
  saveSession,
} from "./storage";
import { makeTrack, PALETTE } from "./types";
import type { Cue, Job, Project, Session, Track } from "./types";
import { Timeline } from "./components/Timeline";
import { TrackRow } from "./components/TrackRow";
import { ArrangementView } from "./components/ArrangementView";
import { measureGrid, normalizeNote } from "./arrangement";
import { mergeLyrics } from "./lyrics";
import { LyricsView } from "./components/LyricsView";
import { CifraView } from "./components/CifraView";
import { projectChords } from "./chords";
import { APP_VERSION, APP_REVISION } from "./version";

type Panel = "none" | "settings" | "import" | "projects" | "help";

export default function App() {
  const engine = useRef(new StudioAudio());
  const [project, setProject] = useState<Project | null>(null);
  const [files, setFiles] = useState<Record<string, Blob>>({});
  const [score, setScore] = useState<Blob>();
  const [waveforms, setWaveforms] = useState<Record<string, number[]>>({});
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedTrack, setSelectedTrack] = useState("");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState("");
  const [saved, setSaved] = useState(false);
  const [panel, setPanel] = useState<Panel>("none");
  const [tab, setTab] = useState<"text" | "arrangement" | "chords">("chords");
  const [editing, setEditing] = useState(false);
  const [selectedCue, setSelectedCue] = useState("");
  const [text, setText] = useState("");
  const [textMode, setTextMode] = useState<"blocks" | "lines">("blocks");
  const [loop, setLoop] = useState<[number, number] | null>(null);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [loopStart, setLoopStart] = useState<number | null>(null);
  const [autoFollow, setAutoFollow] = useState(true);
  const [job, setJob] = useState<Job | null>(null);
  const [jobNotice, setJobNotice] = useState("");
  const [separationError, setSeparationError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [jobRevision, setJobRevision] = useState(0);
  const [receiving, setReceiving] = useState(false);
  const deliveryFlight = useRef<AbortController | null>(null);
  const [apiBase, setApiBase] = useState(serverBase);
  const [connection, setConnection] = useState<Health | null>(null);
  const [checking, setChecking] = useState(false);
  const [model, setModel] = useState("htdemucs_6s");
  const [transcribe, setTranscribe] = useState(true);
  const [recognizeLyrics, setRecognizeLyrics] = useState(true);
  const [lyricsLanguage, setLyricsLanguage] = useState("");
  const [manualText, setManualText] = useState(false);
  const [lyricsRequest, setLyricsRequest] = useState(false);
  const [toast, setToast] = useState("");
  const [dragging, setDragging] = useState(false);
  const [exportMenu, setExportMenu] = useState(false);
  const audioInput = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const projectRef = useRef(project);
  projectRef.current = project;
  const tracksRef = useRef(project?.tracks || []);
  tracksRef.current = project?.tracks || [];
  const filesRef = useRef(files);
  filesRef.current = files;
  const loopRef = useRef({ loop, loopEnabled });
  loopRef.current = { loop, loopEnabled };
  const op = useRef(0);
  const notify = useCallback((message: string) => setToast(message), []);
  const update = useCallback(
    (fn: (p: Project) => Project) =>
      setProject((p) => (p ? { ...fn(p), updated: Date.now() } : p)),
    [],
  );
  const jobActive = job?.status === "queued" || job?.status === "running";
  const canSeparate =
    !!project &&
    !project.demo &&
    project.tracks.some((track) => track.kind === "original");
  const active = project ? activeCue(project.cues, time) : null;

  useEffect(() => {
    void listSessions()
      .then(setProjects)
      .catch(() =>
        notify(
          "O armazenamento local não está disponível neste navegador. Exporte seu projeto para guardar as alterações.",
        ),
      );
    void health(serverBase())
      .then(setConnection)
      .catch(() => setConnection(null));
  }, [notify]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 6500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    let frame: number;
    const tick = () => {
      const audio = engine.current;
      if (audio.playing) {
        audio.synchronize();
        const { loop: range, loopEnabled: enabled } = loopRef.current;
        if (enabled && range && audio.time >= range[1])
          void audio.seek(range[0], tracksRef.current);
        else if (audio.time >= audio.duration - 0.015) {
          audio.pause();
          setPlaying(false);
        }
        setTime(Math.max(0, audio.time));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    engine.current.mix(project?.tracks || []);
  }, [project?.tracks]);
  useEffect(() => {
    if (!project || busy || !Object.keys(files).length) return;
    setSaved(false);
    const timer = setTimeout(() => {
      void saveSession({ project, files, score })
        .then(async () => {
          setSaved(true);
          setProjects(await listSessions());
        })
        .catch(() =>
          notify(
            "Não há espaço para salvar neste dispositivo. Use Exportar projeto.",
          ),
        );
    }, 650);
    return () => clearTimeout(timer);
  }, [project, files, score, busy, notify]);
  useEffect(() => {
    if (active && autoFollow && !editing && tab === "text")
      document
        .getElementById(`cue-${active}`)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [active, autoFollow, editing, tab]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPanel("none");
        setExportMenu(false);
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  const open = async (session: Session) => {
    deliveryFlight.current?.abort();
    deliveryFlight.current = null;
    setReceiving(false);
    const token = ++op.current;
    setBusy("Carregando o áudio…");
    engine.current.reset();
    setPlaying(false);
    setTime(0);
    setLoop(null);
    setLoopStart(null);
    setLoopEnabled(false);
    setJob(null);
    setJobNotice("");
    setSeparationError("");
    try {
      const waves: Record<string, number[]> = {};
      const tracks: Track[] = [];
      const stream = preferMediaPlayback(
        session.project.duration,
        session.project.jobId
          ? Math.max(7, session.project.tracks.length)
          : session.project.tracks.length,
      );
      for (const t of session.project.tracks) {
        const track = { ...t, notes: t.notes?.map(normalizeNote) };
        if (!session.files[t.id]) {
          if (!session.project.jobId)
            throw new Error(`Áudio ausente: ${t.name}`);
          tracks.push({ ...track, loadState: "pending", loadError: undefined });
          continue;
        }
        try {
          const samples = await engine.current.load(
            t.id,
            session.files[t.id],
            stream,
          );
          waves[t.id] = t.waveform?.length ? t.waveform : samples;
          tracks.push({ ...track, loadState: "ready", loadError: undefined });
        } catch (error) {
          if (!session.project.jobId) throw error;
          tracks.push({
            ...track,
            loadState: "error",
            loadError: message(error),
          });
        }
        if (op.current !== token) return;
      }
      setFiles(session.files);
      setScore(session.score);
      setWaveforms(waves);
      setProject({
        ...session.project,
        duration: Math.max(session.project.duration, engine.current.duration),
        tracks,
        jobApplied:
          session.project.jobApplied &&
          tracks.every((t) => t.loadState === "ready"),
      });
      setSelectedTrack(
        session.project.tracks.find((t) => t.kind === "guitar")?.id ||
          session.project.tracks[0]?.id ||
          "",
      );
      setSelectedCue(session.project.cues[0]?.id || "");
      setTab("chords");
      setPanel("none");
      setEditing(false);
    } catch (e) {
      engine.current.reset();
      setProject(null);
      setFiles({});
      notify(message(e));
    } finally {
      if (op.current === token) setBusy("");
    }
  };
  const loadAudio = async (file: File) => {
    if (busy || jobActive) {
      notify(
        "Aguarde ou cancele o processamento atual antes de abrir outra música.",
      );
      return;
    }
    if (file.size > 200 * 1024 * 1024) {
      notify("Envie um arquivo de até 200 MB.");
      return;
    }
    const track = makeTrack("original");
    track.volume = 1;
    track.filename = file.name;
    await open({
      project: {
        version: 1,
        id: crypto.randomUUID(),
        title: file.name.replace(/\.[^.]+$/, ""),
        filename: file.name,
        duration: 0,
        updated: Date.now(),
        tracks: [track],
        cues: [],
        rawText: "",
      },
      files: { [track.id]: file },
    });
  };
  const demo = async () => {
    if (busy || jobActive) return;
    setBusy("Preparando a sessão de demonstração…");
    try {
      await open(await createDemo());
    } catch (e) {
      notify(message(e));
      setBusy("");
    }
  };
  const seek = useCallback(
    (n: number) => {
      void engine.current
        .seek(n, tracksRef.current)
        .then(() => setTime(n))
        .catch((e) => notify(message(e)));
    },
    [notify],
  );
  const playPause = useCallback(async () => {
    if (!projectRef.current || busy) return;
    try {
      if (engine.current.playing) {
        engine.current.pause();
        setPlaying(false);
      } else {
        const audio = engine.current;
        await audio.play(
          tracksRef.current,
          audio.time >= audio.duration - 0.02 ? 0 : audio.time,
        );
        setPlaying(true);
      }
    } catch (e) {
      notify(message(e));
    }
  }, [busy, notify]);
  const markCue = useCallback(
    (id = selectedCue) => {
      const cue = projectRef.current?.cues.find((c) => c.id === id);
      if (!cue) {
        notify("Selecione um trecho para marcar o tempo.");
        return;
      }
      const n = engine.current.time;
      update((p) => ({
        ...p,
        cues: p.cues.map((c) =>
          c.id === id
            ? { ...c, start: n, end: undefined, source: "manual" }
            : c,
        ),
      }));
      const list = projectRef.current!.cues,
        index = list.findIndex((c) => c.id === id);
      setSelectedCue(list[index + 1]?.id || id);
    },
    [selectedCue, update, notify],
  );
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const element = e.target as HTMLElement;
      if (
        ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(element.tagName) ||
        element.isContentEditable ||
        panel !== "none"
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        void playPause();
      }
      if (e.key.toLowerCase() === "m" && editing) {
        e.preventDefault();
        markCue();
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        seek(Math.max(0, engine.current.time - 5));
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        seek(Math.min(engine.current.duration, engine.current.time + 5));
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [playPause, markCue, editing, panel, seek]);

  const applyResult = useCallback(
    async (resultJob: Job, base: string) => {
      const p = projectRef.current;
      if (!p || p.jobId !== resultJob.id || !resultJob.result || p.jobApplied)
        return;
      if (deliveryFlight.current) return;
      const projectId = p.id,
        controller = new AbortController();
      deliveryFlight.current = controller;
      setReceiving(true);
      engine.current.pause();
      setPlaying(false);
      try {
        const merged = mergeResult(p, resultJob);
        engine.current.retain(new Set(merged.tracks.map((track) => track.id)));
        update((current) =>
          current.id === projectId ? mergeResult(current, resultJob) : current,
        );
        setWaveforms((current) => ({
          ...current,
          ...Object.fromEntries(
            merged.tracks
              .filter((t) => t.waveform?.length)
              .map((t) => [t.id, t.waveform!]),
          ),
        }));
        setSelectedTrack(
          merged.tracks.find((t) => t.kind === "guitar")?.id ||
            merged.tracks[0].id,
        );
        setTab("chords");
        setEditing(false);
        const stream = preferMediaPlayback(
          merged.duration,
          merged.tracks.length,
        );
        const valid = () =>
          !controller.signal.aborted && projectRef.current?.id === projectId;
        const result = await receiveResult({
          job: resultJob,
          files: { ...filesRef.current },
          signal: controller.signal,
          hasAudio: (id) =>
            engine.current.has(id) &&
            !(stream && engine.current.buffers.has(id)),
          fetchFile: (file, signal) =>
            artifact(base, resultJob.id, file, signal, true),
          loadAudio: (id, file) => engine.current.load(id, file, stream),
          onFile: (id, file) => {
            if (valid()) {
              setFiles((current) => ({ ...current, [id]: file }));
              update((current) =>
                current.id !== projectId
                  ? current
                  : {
                      ...current,
                      tracks: current.tracks.map((t) =>
                        t.id === id
                          ? {
                              ...t,
                              playbackFormat: file.type.includes("mp4")
                                ? "m4a"
                                : "wav",
                            }
                          : t,
                      ),
                    },
              );
            }
          },
          onTrack: (id, state, error, samples) => {
            if (!valid()) return;
            update((current) =>
              current.id !== projectId
                ? current
                : {
                    ...current,
                    tracks: current.tracks.map((t) =>
                      t.id === id
                        ? { ...t, loadState: state, loadError: error }
                        : t,
                    ),
                  },
            );
            if (samples?.length)
              setWaveforms((current) => ({ ...current, [id]: samples }));
            if (state === "loading")
              setJobNotice(
                `Carregando ${merged.tracks.find((t) => t.id === id)?.name || "pista"}… O arranjo já está disponível.`,
              );
          },
        });
        if (!valid()) return;
        if (result.ready === result.total) {
          const retained = new Set(merged.tracks.map((track) => track.id));
          setFiles((current) =>
            Object.fromEntries(
              Object.entries(current).filter(([id]) => retained.has(id)),
            ),
          );
        }
        update((current) =>
          current.id === projectId
            ? { ...current, jobApplied: result.ready === result.total }
            : current,
        );
        setJobNotice(
          result.failures.length
            ? `${result.ready} de ${result.total} pistas carregadas. ${result.failures.join(" | ")}`
            : "",
        );
        if (!result.failures.length)
          notify(
            "Pistas e arranjo carregados. Escolha o instrumento que quer tocar.",
          );
      } catch (e) {
        if (!controller.signal.aborted)
          setJobNotice(`Não foi possível carregar o resultado: ${message(e)}`);
      } finally {
        if (deliveryFlight.current === controller) {
          deliveryFlight.current = null;
          setReceiving(false);
        }
      }
    },
    [update, notify],
  );
  useEffect(() => {
    if (!project?.jobId || (project.jobApplied && !project.lyricsPending))
      return;
    const id = project.jobId,
      base = project.jobBase || "";
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const status = await getJob(base, id);
        if (stopped) return;
        setJob(status);
        setJobNotice("");
        if (status.status === "completed") {
          update((current) => mergeLyrics(current, status));
          if (!projectRef.current?.jobApplied) await applyResult(status, base);
          if (
            !["queued", "running", "waiting"].includes(
              status.lyrics_state || "",
            )
          )
            return;
        }
        if (status.status === "failed" || status.status === "cancelled") {
          update((current) => mergeLyrics(current, status));
          return;
        }
      } catch {
        if (!stopped)
          setJobNotice(
            "Conexão interrompida. Tentando retomar o acompanhamento da tarefa…",
          );
      }
      if (!stopped)
        timer = setTimeout(() => {
          void poll();
        }, 2000);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [
    project?.jobId,
    project?.jobApplied,
    project?.lyricsPending,
    project?.jobBase,
    jobRevision,
    applyResult,
    update,
  ]);

  const connect = async () => {
    setChecking(true);
    setConnectionError("");
    try {
      const base = apiBase.trim().replace(/\/$/, "");
      if (base && !/^https?:\/\//.test(base))
        throw new Error(
          "Informe a URL completa do servidor, começando com https:// ou http://.",
        );
      const result = await health(base);
      setConnection(result);
      localStorage.setItem("riffsync-api", base);
      setApiBase(base);
      notify(
        result.worker_online && result.separation_available
          ? "Servidor conectado e pronto para separar instrumentos."
          : "API conectada. O worker de separação ainda precisa ser iniciado.",
      );
    } catch (e) {
      setConnection(null);
      setConnectionError(
        `Não foi possível conectar ao servidor: ${message(e)}`,
      );
    } finally {
      setChecking(false);
    }
  };
  const separate = async (requestedBase = serverBase()) => {
    const p = projectRef.current,
      original = p?.tracks.find((t) => t.kind === "original");
    if (!p || p.demo || !original || busy || jobActive || receiving) return;
    if (
      !p.jobApplied &&
      (job?.status === "completed" || (p.jobResultId === p.jobId && p.jobId))
    ) {
      setJobRevision((value) => value + 1);
      return;
    }
    setSeparationError("");
    setConnectionError("");
    setBusy("Verificando o servidor de processamento…");
    let reachedServer = false;
    try {
      const base = requestedBase.trim().replace(/\/$/, "");
      if (base && !/^https?:\/\//.test(base))
        throw new Error(
          "Informe a URL completa do servidor, começando com https:// ou http://.",
        );
      const status = await health(base);
      reachedServer = true;
      setConnection(status);
      if (!status.worker_online || !status.separation_available)
        throw new Error(
          "O servidor respondeu, mas o worker de separação está indisponível. Inicie o worker e tente novamente.",
        );
      localStorage.setItem("riffsync-api", base);
      setApiBase(base);
      const file = filesRef.current[original.id];
      if (!file?.size)
        throw new Error(
          "O áudio original não está disponível neste projeto. Carregue a música novamente.",
        );
      setBusy("Enviando a música para análise…");
      const created = await createJob(
        base,
        file,
        p.filename,
        model,
        transcribe,
        recognizeLyrics,
        lyricsLanguage,
      );
      setJob(created);
      update((current) =>
        current.id !== p.id
          ? current
          : {
              ...current,
              jobId: created.id,
              jobBase: base,
              jobApplied: false,
              lyricsPending: recognizeLyrics,
            },
      );
      setPanel("none");
    } catch (e) {
      if (!reachedServer) setConnection(null);
      setSeparationError(
        reachedServer
          ? message(e)
          : `Não foi possível verificar o servidor de processamento: ${message(e)}`,
      );
    } finally {
      setBusy("");
    }
  };
  const revise = async (operation: "chords" | "vocals_drums") => {
    const p = projectRef.current;
    if (!p?.jobId || busy || jobActive || receiving) return;
    setBusy(
      operation === "chords"
        ? "Preparando a cifra com as faixas existentes…"
        : "Preparando o refinamento de voz e bateria…",
    );
    try {
      const created = await reviseJob(p.jobBase || "", p.jobId, operation);
      if (projectRef.current?.id !== p.id) return;
      if (operation === "vocals_drums") {
        const backup = {
          ...p,
          id: crypto.randomUUID(),
          title: `${p.title} · separação anterior`,
          updated: Date.now(),
        };
        try {
          await saveSession({
            project: backup,
            files: { ...filesRef.current },
            score,
          });
          void listSessions().then(setProjects);
        } catch {
          notify(
            "A cópia local não pôde ser salva; a tarefa anterior continua preservada no servidor.",
          );
        }
      }
      const cached: Record<string, Blob> = {};
      for (const track of p.tracks) {
        if (
          track.kind === "original" ||
          (operation === "vocals_drums" &&
            ["vocals", "drums"].includes(track.kind))
        )
          continue;
        if (filesRef.current[track.id])
          cached[`${created.id}-${track.kind}`] = filesRef.current[track.id];
      }
      setFiles((current) => ({ ...current, ...cached }));
      setJob(created);
      update((current) => ({
        ...current,
        jobId: created.id,
        jobApplied: false,
        lyricsPending: false,
      }));
      setTab("chords");
      setJobRevision((value) => value + 1);
    } catch (error) {
      notify(message(error));
    } finally {
      setBusy("");
    }
  };
  const generateLyrics = async () => {
    const p = projectRef.current;
    if (!p?.jobId || lyricsRequest) return;
    setLyricsRequest(true);
    try {
      const status = await requestLyrics(
        p.jobBase || "",
        p.jobId,
        lyricsLanguage,
      );
      if (projectRef.current?.id !== p.id) return;
      setJob(status);
      update((current) => ({ ...mergeLyrics(current, status), lyrics: [] }));
      setManualText(false);
      setTab("text");
      setJobRevision((value) => value + 1);
    } catch (error) {
      notify(message(error));
    } finally {
      setLyricsRequest(false);
    }
  };
  const stopLyrics = async () => {
    const p = projectRef.current;
    if (!p?.jobId) return;
    try {
      const status = await cancelLyrics(p.jobBase || "", p.jobId);
      if (projectRef.current?.id !== p.id) return;
      setJob(status);
      update((current) => mergeLyrics(current, status));
    } catch (error) {
      notify(message(error));
    }
  };
  const readText = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      notify("O arquivo de texto deve ter até 2 MB.");
      return;
    }
    setText(await file.text());
    setPanel("import");
  };
  const applyText = () => {
    if (!text.trim()) return;
    const cues = parseText(text, textMode);
    update((p) => ({ ...p, rawText: text, cues }));
    setManualText(true);
    setSelectedCue(cues[0]?.id || "");
    setEditing(true);
    setTab("text");
    setPanel("none");
    notify(
      "Texto importado. Selecione um trecho e marque o momento em que ele começa.",
    );
  };
  const newCue = () => {
    const cue: Cue = {
      id: crypto.randomUUID(),
      text: "Novo trecho",
      start: null,
      source: "manual",
    };
    update((p) => ({ ...p, cues: [...p.cues, cue] }));
    setSelectedCue(cue.id);
    setEditing(true);
    setTab("text");
  };
  const changeCue = (id: string, changes: Partial<Cue>) =>
    update((p) => {
      const cues = p.cues.map((c) =>
        c.id === id ? { ...c, ...changes, source: "manual" as const } : c,
      );
      return {
        ...p,
        cues,
        rawText:
          changes.text === undefined
            ? p.rawText
            : cues
                .filter((c) => c.barIndex === undefined)
                .map((c) => c.text)
                .join("\n\n"),
      };
    });
  const exportProject = async () => {
    if (!project) return;
    setExportMenu(false);
    setBusy("Exportando o projeto…");
    try {
      await exportSession({ project, files, score });
    } catch (e) {
      notify(message(e));
    } finally {
      setBusy("");
    }
  };
  const exportMix = async () => {
    if (!project) return;
    setExportMenu(false);
    setBusy("Renderizando seu acompanhamento…");
    try {
      download(
        await renderMix(
          engine.current.buffers,
          project.tracks,
          project.duration,
          files,
        ),
        `${project.title}-acompanhamento.wav`,
      );
    } catch (e) {
      notify(message(e));
    } finally {
      setBusy("");
    }
  };
  const remove = async (id: string) => {
    await deleteSession(id);
    setProjects(await listSessions());
    if (project?.id === id) {
      ++op.current;
      engine.current.reset();
      setProject(null);
      setFiles({});
      setScore(undefined);
      setPlaying(false);
      setTime(0);
    }
  };
  const harmony = projectChords(project);
  const harmonyCues: Cue[] = harmony.map((chord, index) => ({
    id: `harmony-${index}`,
    text: chord.label,
    start: chord.start,
    end: chord.end,
    source: "ai",
  }));
  const hasStems =
    (project?.tracks.filter((t) => t.kind !== "original").length || 0) > 0;
  const preferredWave =
    waveforms[
      project?.tracks.find((t) => t.kind === "original")?.id || selectedTrack
    ] || [];
  const mainWave = preferredWave.length
    ? preferredWave
    : Object.values(waveforms).find((values) => values.length) || [];
  const visibleCues =
    project?.cues.filter((c) => c.barIndex === undefined) || [];

  return (
    <div className="app-shell">
      <input
        ref={audioInput}
        type="file"
        accept="audio/*,video/webm,.mp3,.wav,.flac,.m4a,.ogg,.aac,.webm,.weba,.opus"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void loadAudio(f);
          e.target.value = "";
        }}
      />
      <input
        ref={textInput}
        type="file"
        accept=".txt,.lrc,.chordpro,.cho,.pro"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void readText(f);
          e.target.value = "";
        }}
      />
      <input
        ref={projectInput}
        type="file"
        accept=".riffsync,.zip"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            setBusy("Importando o projeto…");
            void importSession(f)
              .then(open)
              .catch((err) => {
                setBusy("");
                notify(message(err));
              });
          }
          e.target.value = "";
        }}
      />

      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => e.preventDefault()}
          aria-label="RiffSync"
        >
          <span className="brand-mark">
            <AudioLines size={25} strokeWidth={2.4} />
          </span>
          <span>
            riff<span className="brand-light">sync</span>
            <small>PLAY IT YOUR WAY</small>
          </span>
        </a>
        <div className="workspace-label">
          SEU ESTÚDIO <span>v{APP_VERSION}</span>
        </div>
        <nav aria-label="Navegação principal">
          <button className="nav-item active" onClick={() => setPanel("none")}>
            <SlidersHorizontal size={18} /> Estúdio <span className="nav-dot" />
          </button>
          <button className="nav-item" onClick={() => setPanel("projects")}>
            <FolderOpen size={18} /> Meus projetos{" "}
            <span className="nav-count">{projects.length}</span>
          </button>
          <button
            className="nav-item"
            onClick={() => {
              setText(project?.rawText || "");
              setPanel(project ? "import" : "help");
            }}
          >
            <FileMusic size={18} /> Cifras e tablaturas
          </button>
        </nav>
        <div className="sidebar-section-title">
          RECENTES{" "}
          <button
            aria-label="Nova música"
            onClick={() => audioInput.current?.click()}
            disabled={!!busy || jobActive}
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="recent-projects">
          {projects.length ? (
            projects.slice(0, 5).map((p) => (
              <button
                className={p.id === project?.id ? "current" : ""}
                key={p.id}
                disabled={!!busy || jobActive}
                onClick={() => {
                  void loadSession(p.id).then((s) => s && open(s));
                }}
              >
                <Music2 size={15} />
                <span>
                  {p.title}
                  <small>
                    {p.demo
                      ? "Demonstração"
                      : `${p.tracks.length} ${p.tracks.length === 1 ? "faixa" : "faixas"}`}
                  </small>
                </span>
              </button>
            ))
          ) : (
            <p>
              Suas músicas ficam salvas
              <br />
              aqui, neste dispositivo.
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="practice-card">
            <Headphones size={22} />
            <strong>O palco é seu.</strong>
            <p>
              Escolha uma faixa.
              <br />
              Dê espaço ao seu som.
            </p>
            <button
              onClick={() => {
                void demo();
              }}
              disabled={!!busy || jobActive}
            >
              Explorar demonstração <Play size={12} fill="currentColor" />
            </button>
          </div>
          <button className="nav-item" onClick={() => setPanel("settings")}>
            <Settings2 size={17} /> Configurações
          </button>
          <button className="nav-item" onClick={() => setPanel("help")}>
            <CircleHelp size={17} /> Como funciona
          </button>
          <div className="profile">
            <span>RS</span>
            <div>
              Estúdio local<small>Seu espaço de criação</small>
            </div>
          </div>
        </div>
      </aside>

      <main className="main-studio">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> <strong>Estúdio</strong>
          </div>
          <div className="top-actions">
            <button
              className={`server-state ${connection?.worker_online && connection.separation_available ? "connected" : ""}`}
              onClick={() => setPanel("settings")}
            >
              <Cloud size={15} />
              <span>
                {connection?.worker_online && connection.separation_available
                  ? "IA conectada"
                  : "Conectar IA"}
              </span>
            </button>
            <span className="top-divider" />
            <button
              className="icon-button"
              title="Ajuda e atalhos"
              aria-label="Ajuda e atalhos"
              onClick={() => setPanel("help")}
            >
              <Keyboard size={18} />
            </button>
          </div>
        </header>
        <div className="studio-content">
          <section className="page-heading">
            <div>
              <div className="eyebrow">
                <span /> SEU ESTÚDIO DE PRÁTICA
              </div>
              <h1>
                Sua música. <span>Seu jeito de tocar.</span>
              </h1>
              <p>Separe os instrumentos. Encontre seu espaço. Toque junto.</p>
            </div>
            <button
              className="button primary new-music"
              onClick={() => audioInput.current?.click()}
              disabled={!!busy || jobActive}
            >
              <Plus size={18} /> Nova música
            </button>
          </section>

          {!project && (
            <section
              className={`upload-zone ${dragging ? "dragging" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (e.dataTransfer.files[0])
                  void loadAudio(e.dataTransfer.files[0]);
              }}
            >
              <div className="upload-decoration" aria-hidden="true">
                <div />
                <div />
                <div />
                <div />
                <div />
                <div />
                <div />
                <div />
                <div />
              </div>
              <span className="upload-icon">
                <Upload size={25} />
              </span>
              <h2>Qual vai ser o som de hoje?</h2>
              <p>Arraste sua música para cá ou escolha um arquivo.</p>
              <button
                className="button primary"
                disabled={!!busy}
                onClick={() => audioInput.current?.click()}
              >
                <FolderOpen size={17} /> Carregar música
              </button>
              <small>
                MP3, WAV, FLAC, M4A, OGG, AAC, WebM e Opus · até 200 MB
              </small>
              <div className="upload-bottom">
                <span>Quer conhecer primeiro?</span>
                <button
                  onClick={() => {
                    void demo();
                  }}
                  disabled={!!busy}
                >
                  <Play size={13} fill="currentColor" /> Abrir sessão de
                  demonstração
                </button>
              </div>
            </section>
          )}

          {project && (
            <section className="session-card">
              <div className="session-heading">
                <div className="song-art">
                  <AudioLines size={27} />
                </div>
                <div className="song-details">
                  <input
                    aria-label="Nome do projeto"
                    className="song-title"
                    value={project.title}
                    onChange={(e) =>
                      update((p) => ({ ...p, title: e.target.value }))
                    }
                  />
                  <div>
                    {project.demo ? (
                      <span className="demo-badge">
                        DEMONSTRAÇÃO · ÁUDIO SINTETIZADO
                      </span>
                    ) : (
                      <span>{project.filename}</span>
                    )}
                    <span className="metadata-dot">·</span>
                    <span>{formatTime(project.duration)}</span>
                    {project.bpm && (
                      <>
                        <span className="metadata-dot">·</span>
                        <span>{Math.round(project.bpm)} BPM</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="session-save">
                  {saved ? <Check size={14} /> : <Save size={14} />}
                  <span>{saved ? "Salvo no dispositivo" : "Salvando…"}</span>
                </div>
                <div className="export-wrap">
                  <button
                    className="button secondary compact"
                    disabled={!!busy}
                    onClick={() => setExportMenu(!exportMenu)}
                  >
                    <Download size={15} />
                    <span>Exportar</span>
                    <ChevronDown size={13} />
                  </button>
                  {exportMenu && (
                    <div className="dropdown">
                      <button
                        onClick={() => {
                          void exportProject();
                        }}
                      >
                        <FolderOpen size={16} /> Projeto com áudios
                      </button>
                      <button
                        onClick={() => {
                          void exportMix();
                        }}
                      >
                        <Headphones size={16} /> Acompanhamento WAV
                      </button>
                      <button
                        onClick={() => {
                          download(
                            new Blob(
                              [
                                JSON.stringify(
                                  {
                                    title: project.title,
                                    rawText: project.rawText,
                                    cues: project.cues,
                                    lyrics: project.lyrics,
                                    lyricsLanguage: project.lyricsLanguage,
                                    harmony: project.harmony,
                                  },
                                  null,
                                  2,
                                ),
                              ],
                              { type: "application/json" },
                            ),
                            `${project.title}-sincronizacao.json`,
                          );
                          setExportMenu(false);
                        }}
                      >
                        <FileText size={16} /> Marcadores JSON
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <Timeline
                samples={mainWave}
                time={time}
                duration={project.duration}
                cues={project.cues}
                loop={loopEnabled ? loop : null}
                onSeek={seek}
                onMoveCue={(id, at) =>
                  changeCue(id, { start: at, end: undefined })
                }
              />
              <div className="transport">
                <div className="transport-play">
                  <button
                    className="icon-button"
                    aria-label="Voltar ao início"
                    title="Voltar ao início"
                    onClick={() => seek(0)}
                  >
                    <SkipBack size={18} />
                  </button>
                  <button
                    className="play-button"
                    aria-label={playing ? "Pausar" : "Reproduzir"}
                    onClick={() => {
                      void playPause();
                    }}
                    disabled={!!busy}
                  >
                    {playing ? (
                      <Pause size={19} fill="currentColor" />
                    ) : (
                      <Play size={19} fill="currentColor" />
                    )}
                  </button>
                  <span className="time-display">
                    {formatTime(time, true)}{" "}
                    <span>/ {formatTime(project.duration)}</span>
                  </span>
                </div>
                <div className="loop-controls">
                  <button
                    className={`icon-button ${loopEnabled ? "selected-control" : ""}`}
                    aria-label="Ativar repetição do trecho"
                    title="Repetir trecho A–B"
                    disabled={!loop}
                    onClick={() => setLoopEnabled(!loopEnabled)}
                  >
                    <Loop size={18} />
                  </button>
                  <button
                    className={`loop-marker ${loopStart !== null ? "set" : ""}`}
                    onClick={() => {
                      setLoopStart(time);
                      setLoop(null);
                      setLoopEnabled(false);
                    }}
                    title="Marcar início do trecho"
                  >
                    A{" "}
                    {loopStart !== null && (
                      <small>{formatTime(loopStart)}</small>
                    )}
                  </button>
                  <button
                    className={`loop-marker ${loop ? "set" : ""}`}
                    disabled={loopStart === null || time <= loopStart + 0.1}
                    onClick={() => {
                      if (loopStart !== null) {
                        setLoop([loopStart, time]);
                        setLoopEnabled(true);
                      }
                    }}
                    title="Marcar fim do trecho"
                  >
                    B {loop && <small>{formatTime(loop[1])}</small>}
                  </button>
                  <span className="transport-tip">Repetir trecho</span>
                </div>
                <div className="transport-right">
                  <span className="keycap">espaço</span>
                  <span>play / pause</span>
                </div>
              </div>
            </section>
          )}

          {job && (
            <div
              className={`job-status ${job.status === "completed" && !project?.jobApplied ? "delivering" : job.status}`}
            >
              <div>
                <span className="job-icon">
                  {jobActive || receiving ? (
                    <LoaderCircle className="spin" size={18} />
                  ) : job.status === "completed" && project?.jobApplied ? (
                    <Check size={18} />
                  ) : (
                    <Activity size={18} />
                  )}
                </span>
                <div>
                  <strong>
                    {job.status === "completed" && !project?.jobApplied
                      ? "Resultado gerado · carregando as pistas"
                      : job.stage}
                  </strong>
                  <p>
                    {jobNotice ||
                      job.error ||
                      (jobActive
                        ? "Você pode continuar editando e sincronizando enquanto a IA trabalha."
                        : project?.lyricsPending
                          ? "As faixas estão disponíveis. A letra está sendo reconhecida; acompanhe na aba Letra e cifra."
                          : job.lyrics_state === "ready"
                            ? "Faixas, arranjo e letra disponíveis. Abra Letra e cifra para acompanhar a música."
                            : job.warnings.join(" "))}
                  </p>
                  {job.error_details && (
                    <details className="job-diagnostics">
                      <summary>Ver diagnóstico do processamento</summary>
                      <textarea
                        aria-label="Diagnóstico do processamento"
                        readOnly
                        value={job.error_details}
                      />
                      <button
                        className="button secondary compact"
                        onClick={() => {
                          void navigator.clipboard
                            .writeText(job.error_details || "")
                            .then(() => notify("Diagnóstico copiado."))
                            .catch(() =>
                              notify(
                                "Selecione o texto do diagnóstico para copiar.",
                              ),
                            );
                        }}
                      >
                        Copiar diagnóstico
                      </button>
                    </details>
                  )}
                  {job.status === "failed" && job.source_job && (
                    <button
                      className="button secondary compact"
                      onClick={() => {
                        update((p) => ({
                          ...p,
                          jobId: job.source_job,
                          jobApplied: false,
                        }));
                        setJobRevision((value) => value + 1);
                      }}
                    >
                      Voltar ao resultado anterior
                    </button>
                  )}
                  {job.status === "failed" && (
                    <button
                      className="button secondary compact job-retry"
                      disabled={!!busy}
                      onClick={() => {
                        setBusy("Retomando processamento…");
                        void retryJob(project!.jobBase || "", job.id)
                          .then((next) => {
                            setJob(next);
                            setJobNotice("");
                            setJobRevision((value) => value + 1);
                          })
                          .catch((e) => notify(message(e)))
                          .finally(() => setBusy(""));
                      }}
                    >
                      Retomar processamento
                    </button>
                  )}
                  {job.status === "completed" && (
                    <button
                      className="button secondary compact job-retry"
                      disabled={receiving || !!busy}
                      onClick={() => {
                        update((p) => ({ ...p, jobApplied: false }));
                        setJobRevision((value) => value + 1);
                      }}
                    >
                      <RotateCcw size={15} />{" "}
                      {receiving ? "Carregando pistas…" : "Recuperar resultado"}
                    </button>
                  )}
                </div>
              </div>
              {jobActive ? (
                <>
                  <span>{job.progress}%</span>
                  <button
                    className="button ghost compact"
                    onClick={() => {
                      void cancelJob(project!.jobBase || "", job.id)
                        .then(setJob)
                        .catch((e) => notify(message(e)));
                    }}
                  >
                    Cancelar
                  </button>
                </>
              ) : (
                <button
                  className="icon-button"
                  aria-label="Fechar status"
                  onClick={() => setJob(null)}
                >
                  <X size={16} />
                </button>
              )}
              <div
                className="job-progress"
                style={{ width: `${job.progress}%` }}
              />
            </div>
          )}
          {jobNotice && !job && <p className="inline-notice">{jobNotice}</p>}
          {separationError && (
            <div className="separation-error" role="alert">
              <strong>Não foi possível iniciar a separação</strong>
              <p>{separationError}</p>
              <button
                className="button secondary compact"
                onClick={() => setPanel("settings")}
              >
                <Settings2 size={15} /> Configurar processamento
              </button>
            </div>
          )}

          <section className="mixer-section">
            <div className="section-heading">
              <div>
                <h2>
                  <SlidersHorizontal size={19} /> Mixer de instrumentos{" "}
                  <span className="count-badge">
                    {project?.tracks.length || 0}
                  </span>
                </h2>
                <p>Silencie uma faixa e assuma o instrumento.</p>
              </div>
              <button
                className="button ai-button"
                disabled={!canSeparate || !!busy || jobActive || receiving}
                onClick={() => {
                  void separate();
                }}
              >
                <Sparkles size={16} />{" "}
                {!project?.jobApplied &&
                (job?.status === "completed" || project?.jobResultId)
                  ? "Recuperar resultado"
                  : hasStems
                    ? "Analisar novamente"
                    : "Separar com IA"}
              </button>
            </div>
            <div className="mixer-card">
              {project ? (
                project.tracks.map((track) => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    selected={track.id === selectedTrack}
                    samples={waveforms[track.id] || []}
                    file={files[track.id]}
                    onRetry={() => {
                      if (!receiving) setJobRevision((value) => value + 1);
                    }}
                    onDownload={
                      project.jobId && track.kind !== "original"
                        ? () => {
                            void artifact(
                              project.jobBase || "",
                              project.jobId!,
                              track.filename || `${track.kind}.wav`,
                            )
                              .then((blob) =>
                                download(
                                  blob,
                                  track.filename || `${track.kind}.wav`,
                                ),
                              )
                              .catch((error) => notify(message(error)));
                          }
                        : undefined
                    }
                    onSelect={() => {
                      setSelectedTrack(track.id);
                      if (track.kind === "guitar" || track.kind === "bass")
                        setTab("arrangement");
                    }}
                    onChange={(changes) =>
                      update((p) => ({
                        ...p,
                        tracks: p.tracks.map((t) =>
                          t.id === track.id ? { ...t, ...changes } : t,
                        ),
                      }))
                    }
                  />
                ))
              ) : (
                <div className="mixer-empty">
                  <div className="instrument-placeholders">
                    {[Guitar, Music2, Radio, AudioLines].map((Icon, i) => (
                      <span
                        key={i}
                        style={{ color: Object.values(PALETTE)[i] }}
                      >
                        <Icon size={21} />
                      </span>
                    ))}
                  </div>
                  <div>
                    <strong>Cada instrumento no seu lugar.</strong>
                    <p>
                      Carregue uma música para começar ou explore a
                      demonstração.
                    </p>
                  </div>
                  <button
                    className="button ghost compact"
                    onClick={() => {
                      void demo();
                    }}
                    disabled={!!busy}
                  >
                    Experimentar <Play size={12} />
                  </button>
                </div>
              )}
            </div>
            {project && !hasStems && (
              <p className="mixer-footnote">
                <Sparkles size={13} /> A música original já pode tocar. Conecte
                a IA para separar os instrumentos.
              </p>
            )}
            {hasStems && project?.jobId && (
              <div className="refine-actions">
                <button
                  className="button secondary compact"
                  disabled={!!busy || jobActive || receiving}
                  onClick={() => void revise("vocals_drums")}
                >
                  <Sparkles size={15} /> Refinar voz e bateria
                </button>
                <span>
                  Processa dois modelos específicos; mantém baixo, guitarra e
                  demais faixas. A versão anterior fica em Meus projetos.
                </span>
              </div>
            )}
            {hasStems && (
              <div className="mixer-legend">
                <span>
                  <b>M</b> silenciar áudio
                </span>
                <span>
                  <b>S</b> ouvir isoladamente
                </span>
                <span>
                  <EyeIcon /> mostrar notação
                </span>
                <button
                  onClick={() =>
                    update((p) => ({
                      ...p,
                      tracks: p.tracks.map((t) => ({
                        ...t,
                        muted: t.kind === "original",
                        solo: false,
                        volume: t.kind === "original" ? 1 : 0.8,
                        visible: true,
                      })),
                    }))
                  }
                >
                  <RotateCcw size={12} /> Restaurar mixer
                </button>
              </div>
            )}
          </section>

          <section className="notation-section">
            <div className="section-heading">
              <div>
                <h2>
                  <FileMusic size={19} /> Acompanhe cada nota
                </h2>
                <p>
                  Letra, cifras e tablaturas geradas a partir das pistas de
                  áudio.
                </p>
              </div>
              <button
                className="button secondary compact"
                disabled={!project}
                onClick={() => {
                  setText(project?.rawText || "");
                  setPanel("import");
                }}
              >
                <Upload size={15} /> Correção manual · TXT
              </button>
            </div>
            <div className="notation-card">
              <div className="notation-toolbar">
                <div
                  className="view-tabs"
                  role="tablist"
                  aria-label="Visualização musical"
                >
                  <button
                    role="tab"
                    aria-selected={tab === "chords"}
                    className={tab === "chords" ? "active" : ""}
                    onClick={() => setTab("chords")}
                  >
                    <Guitar size={15} /> Cifra e braço
                  </button>
                  <button
                    role="tab"
                    aria-selected={tab === "arrangement"}
                    className={tab === "arrangement" ? "active" : ""}
                    onClick={() => setTab("arrangement")}
                  >
                    <Music2 size={15} /> Arranjo da IA
                  </button>
                  <button
                    role="tab"
                    aria-selected={tab === "text"}
                    className={tab === "text" ? "active" : ""}
                    onClick={() => setTab("text")}
                  >
                    <FileText size={15} /> Letra e cifra
                  </button>
                </div>
                <div className="notation-actions">
                  {tab === "text" && (
                    <label className="follow-toggle">
                      <input
                        type="checkbox"
                        checked={autoFollow}
                        onChange={(e) => setAutoFollow(e.target.checked)}
                      />{" "}
                      Acompanhar
                    </label>
                  )}
                  <button
                    className={`button ghost compact ${editing ? "selected-control" : ""}`}
                    disabled={!project || tab !== "text"}
                    onClick={() => setEditing(!editing)}
                  >
                    <Settings2 size={15} />{" "}
                    {editing ? "Concluir edição" : "Sincronizar"}
                  </button>
                </div>
              </div>
              {tab === "text" && project && (
                <div className="lyrics-status">
                  <div>
                    {project.lyricsPending ? (
                      <span role="status">
                        <LoaderCircle className="spin" size={15} />{" "}
                        {job?.lyrics_stage ||
                          "A letra será reconhecida após separar os instrumentos"}{" "}
                        {job?.lyrics_progress ? `${job.lyrics_progress}%` : ""}
                      </span>
                    ) : job?.lyrics_state === "failed" ? (
                      <span role="alert">
                        {job.lyrics_error ||
                          "O reconhecimento da letra falhou."}
                      </span>
                    ) : job?.lyrics_state === "no_speech" ? (
                      <span>
                        Não foi possível reconhecer a letra com confiança. Fixe
                        o idioma e tente novamente ou importe o texto.
                      </span>
                    ) : project.lyrics?.length ? (
                      <span>
                        Transcrição estimada ·{" "}
                        {project.lyricsLanguage || "idioma automático"} ·{" "}
                        {project.lyricsSource === "original"
                          ? "áudio original"
                          : "versão anterior: confira a letra"}
                      </span>
                    ) : (
                      <span>
                        A letra é reconhecida no áudio original; os acordes, no
                        acompanhamento.
                      </span>
                    )}
                    {!!project.lyrics?.length && (
                      <div className="text-source">
                        <button
                          className={!manualText ? "active" : ""}
                          onClick={() => setManualText(false)}
                        >
                          Letra da IA
                        </button>
                        <button
                          className={manualText ? "active" : ""}
                          onClick={() => setManualText(true)}
                        >
                          {project.rawText ? "Texto importado" : "Acordes"}
                        </button>
                      </div>
                    )}
                  </div>
                  <label className="lyric-language">
                    Idioma{" "}
                    <select
                      aria-label="Idioma da letra"
                      value={lyricsLanguage}
                      onChange={(e) => setLyricsLanguage(e.target.value)}
                    >
                      <option value="">Automático</option>
                      <option value="pt">Português</option>
                      <option value="en">Inglês</option>
                      <option value="es">Espanhol</option>
                    </select>
                  </label>
                  {project.lyricsPending ? (
                    <button
                      className="button ghost compact"
                      onClick={() => void stopLyrics()}
                      disabled={job?.status !== "completed"}
                    >
                      Cancelar letra
                    </button>
                  ) : project.jobId &&
                    (project.jobResultId ||
                      project.jobApplied ||
                      job?.status === "completed") ? (
                    <button
                      className="button secondary compact"
                      disabled={lyricsRequest}
                      onClick={() => void generateLyrics()}
                    >
                      <Sparkles size={14} />{" "}
                      {lyricsRequest
                        ? "Solicitando…"
                        : project.lyrics?.length
                          ? "Refazer letra no áudio original"
                          : "Gerar letra com IA"}
                    </button>
                  ) : null}
                </div>
              )}
              {tab === "chords" ? (
                <CifraView
                  project={project}
                  chords={harmony}
                  time={time}
                  selectedTrack={selectedTrack}
                  onTrack={setSelectedTrack}
                  onSeek={seek}
                  onGenerate={() => void revise("chords")}
                  onLyric={() => setTab("text")}
                  busy={!!busy || jobActive || receiving}
                  onChange={(index, label) =>
                    update((p) => ({
                      ...p,
                      harmony: projectChords(p).map((chord, i) =>
                        i === index ? { ...chord, label } : chord,
                      ),
                    }))
                  }
                />
              ) : tab === "arrangement" ? (
                <ArrangementView
                  tracks={project?.tracks || []}
                  cues={harmonyCues}
                  timing={project?.timing}
                  bpm={project?.bpm}
                  duration={project?.duration || 0}
                  time={time}
                  selectedTrack={selectedTrack}
                  demo={project?.demo}
                  onSeek={seek}
                  onChangeNote={(id, index, note) =>
                    update((p) => ({
                      ...p,
                      tracks: p.tracks.map((t) =>
                        t.id === id
                          ? {
                              ...t,
                              notes: note
                                ? t.notes?.map((n, i) =>
                                    i === index ? note : n,
                                  )
                                : t.notes?.filter((_, i) => i !== index),
                            }
                          : t,
                      ),
                    }))
                  }
                  onGrid={(bpm, numerator) =>
                    update((p) => ({
                      ...p,
                      bpm,
                      timing: {
                        ...measureGrid(p.duration, bpm, numerator),
                        estimated: false,
                      },
                    }))
                  }
                />
              ) : project?.lyrics?.length && !manualText ? (
                <LyricsView
                  lines={project.lyrics}
                  review={project.lyricsReview}
                  cues={harmonyCues}
                  time={time}
                  follow={autoFollow}
                  editing={editing}
                  onSeek={seek}
                  onChange={(index, line) =>
                    update((p) => ({
                      ...p,
                      lyrics: p.lyrics?.map((item, i) =>
                        i === index ? line : item,
                      ),
                    }))
                  }
                />
              ) : visibleCues.length ? (
                <div className={`cue-display ${editing ? "editing" : ""}`}>
                  {visibleCues.map((cue, i) => (
                    <div
                      id={`cue-${cue.id}`}
                      key={cue.id}
                      className={`cue-block ${cue.id === active ? "current" : ""} ${cue.id === selectedCue && editing ? "selected" : ""}`}
                      onClick={() => setSelectedCue(cue.id)}
                    >
                      <div className="cue-number">
                        {String(i + 1).padStart(2, "0")}
                      </div>
                      <div className="cue-body">
                        {editing ? (
                          <textarea
                            aria-label={`Texto do trecho ${i + 1}`}
                            value={cue.text}
                            rows={Math.max(1, cue.text.split("\n").length)}
                            onChange={(e) =>
                              changeCue(cue.id, { text: e.target.value })
                            }
                          />
                        ) : (
                          <pre>{cue.text}</pre>
                        )}
                        <div className="cue-meta">
                          {cue.source === "ai" && (
                            <span>
                              <Sparkles size={10} /> Estimativa da IA
                            </span>
                          )}
                          {cue.start === null && (
                            <span>Aguardando sincronização</span>
                          )}
                        </div>
                      </div>
                      {editing ? (
                        <div className="cue-edit-controls">
                          <TimeInput
                            value={cue.start}
                            max={project!.duration}
                            onChange={(n) =>
                              changeCue(cue.id, { start: n, end: undefined })
                            }
                          />
                          <button
                            className="button ghost compact mark-button"
                            onClick={(e) => {
                              e.stopPropagation();
                              markCue(cue.id);
                            }}
                            title="Marcar na posição atual do áudio"
                          >
                            <Radio size={13} /> Marcar
                          </button>
                          <button
                            className="icon-button delete-cue"
                            aria-label={`Remover trecho ${i + 1}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              update((p) => ({
                                ...p,
                                cues: p.cues.filter((c) => c.id !== cue.id),
                              }));
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ) : (
                        <button
                          className="cue-time"
                          disabled={cue.start === null}
                          onClick={() => cue.start !== null && seek(cue.start)}
                        >
                          {cue.start === null
                            ? "—"
                            : formatTime(cue.start, true)}
                          {cue.id === active && <span className="live-dot" />}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-notation text-empty">
                  <span className="notation-empty-icon">
                    <FileText size={27} />
                  </span>
                  <h3>O próximo acorde é seu.</h3>
                  <p>
                    Separe os instrumentos para reconhecer a letra e os acordes.
                    Você também pode carregar um texto e sincronizá-lo com a
                    música.
                  </p>
                  <div>
                    <button
                      className="button secondary compact"
                      disabled={!project}
                      onClick={() => {
                        setText("");
                        setPanel("import");
                      }}
                    >
                      <Plus size={15} /> Adicionar cifra
                    </button>
                    <span>TXT · LRC · ChordPro</span>
                  </div>
                </div>
              )}
              {editing &&
                project &&
                tab === "text" &&
                (!project.lyrics?.length || manualText) && (
                  <div className="sync-footer">
                    <span>
                      <Radio size={14} /> Selecione um trecho e pressione{" "}
                      <kbd>M</kbd> no momento certo.
                    </span>
                    <button className="button ghost compact" onClick={newCue}>
                      <Plus size={13} /> Novo trecho
                    </button>
                  </div>
                )}
            </div>
          </section>

          {!project && (
            <section className="feature-notes">
              <div>
                <span>
                  <AudioLines size={19} />
                </span>
                <div>
                  <h3>Ouça cada detalhe</h3>
                  <p>
                    Instrumentos separados para você
                    <br />
                    estudar do seu jeito.
                  </p>
                </div>
              </div>
              <div>
                <span>
                  <Guitar size={19} />
                </span>
                <div>
                  <h3>Toque com a banda</h3>
                  <p>
                    Silencie seu instrumento e crie
                    <br />
                    seu próprio acompanhamento.
                  </p>
                </div>
              </div>
              <div>
                <span>
                  <Radio size={19} />
                </span>
                <div>
                  <h3>Coloque tudo no tempo</h3>
                  <p>
                    Importe sua cifra e sincronize
                    <br />
                    cada trecho com o áudio.
                  </p>
                </div>
              </div>
            </section>
          )}
          <footer className="studio-footer">
            <span className="footer-brand">
              <AudioLines size={14} /> riffsync
            </span>
            <span>Feito para quem vive a música.</span>
            <span>
              <Headphones size={13} /> Dê play. Faça parte.
            </span>
          </footer>
        </div>
      </main>

      {panel !== "none" && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPanel("none");
          }}
        >
          <section
            className={`modal ${panel === "import" ? "wide" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={
              panel === "settings"
                ? "Configurações"
                : panel === "projects"
                  ? "Meus projetos"
                  : panel === "import"
                    ? "Importar cifra ou tablatura"
                    : "Como funciona"
            }
          >
            <button
              className="modal-close icon-button"
              aria-label="Fechar janela"
              onClick={() => setPanel("none")}
            >
              <X size={20} />
            </button>
            {panel === "settings" && (
              <>
                <div className="modal-eyebrow">
                  <Cloud size={19} /> PROCESSAMENTO DE ÁUDIO
                </div>
                <h2>
                  {connection?.worker_online && connection.separation_available
                    ? "IA pronta para separar."
                    : "Configure o processamento de áudio."}
                </h2>
                <p>
                  Escolha as pistas e inicie a separação da música carregada. O
                  arranjo acompanha o áudio original de cada instrumento.
                </p>
                <label className="field-label" htmlFor="api-url">
                  Endereço do servidor
                </label>
                <div className="connection-field">
                  <input
                    id="api-url"
                    placeholder="https://seu-servidor.com"
                    value={apiBase}
                    onChange={(e) => {
                      setApiBase(e.target.value);
                      setConnection(null);
                      setConnectionError("");
                    }}
                  />
                  <button
                    className="button primary"
                    onClick={() => {
                      void connect();
                    }}
                    disabled={checking}
                  >
                    {checking ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <Wifi size={16} />
                    )}{" "}
                    Conectar
                  </button>
                </div>
                <small className="field-help">
                  Vazio: usar o servidor deste aplicativo. Outra URL: usar um
                  servidor externo.
                </small>
                {connectionError && (
                  <p className="separation-error" role="alert">
                    {connectionError}
                  </p>
                )}
                <div className="connection-report">
                  <span
                    className={
                      connection?.worker_online &&
                      connection.separation_available
                        ? "status-light online"
                        : "status-light"
                    }
                  />
                  {connection
                    ? connection.worker_online &&
                      connection.separation_available
                      ? "Servidor pronto para processar"
                      : "API conectada · worker indisponível"
                    : "Sem conexão com o servidor de IA"}
                </div>
                <label className="field-label" htmlFor="model">
                  Separação de instrumentos
                </label>
                <select
                  id="model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                >
                  <option value="htdemucs_6s">
                    6 faixas · voz, bateria, baixo, guitarra, piano e outros
                  </option>
                  <option value="htdemucs">
                    4 faixas · voz, bateria, baixo e outros
                  </option>
                  <option value="htdemucs_ft">
                    4 faixas · modelo refinado, processamento maior
                  </option>
                </select>
                <p className="field-help">
                  O modelo de 6 faixas é experimental. Solo e base de guitarra
                  podem permanecer na mesma pista.
                </p>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={transcribe}
                    onChange={(e) => setTranscribe(e.target.checked)}
                  />{" "}
                  Estimar cifras e notas após separar
                </label>
                <p className="field-help">
                  As transcrições são editáveis. As pistas de áudio continuam
                  disponíveis quando uma transcrição falha.
                </p>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={recognizeLyrics}
                    onChange={(e) => setRecognizeLyrics(e.target.checked)}
                  />{" "}
                  Reconhecer e sincronizar a letra com IA
                </label>
                <p className="field-help">
                  Usa o áudio original com Whisper large-v3-turbo. O modelo é
                  baixado no primeiro uso. A letra é uma estimativa editável.
                </p>
                <label className="field-label">
                  Idioma da música
                  <select
                    aria-label="Idioma da música"
                    value={lyricsLanguage}
                    onChange={(e) => setLyricsLanguage(e.target.value)}
                  >
                    <option value="">Automático</option>
                    <option value="pt">Português</option>
                    <option value="en">Inglês</option>
                    <option value="es">Espanhol</option>
                  </select>
                </label>
                <p className="field-help">
                  Aplicativo {APP_VERSION} · revisão {APP_REVISION}
                  {connection?.build
                    ? ` · servidor ${connection.build.version}`
                    : ""}
                </p>
                {separationError && (
                  <div className="separation-error" role="alert">
                    <strong>Não foi possível iniciar a separação</strong>
                    <p>{separationError}</p>
                  </div>
                )}
                <div className="modal-footer">
                  <button
                    className="button secondary"
                    onClick={() => setPanel("none")}
                  >
                    Voltar ao estúdio
                  </button>
                  <button
                    className="button primary"
                    disabled={
                      !canSeparate ||
                      !!busy ||
                      jobActive ||
                      checking ||
                      receiving
                    }
                    onClick={() => {
                      void separate(apiBase);
                    }}
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <Sparkles size={16} />
                    )}
                    Separar instrumentos
                  </button>
                </div>
                {!canSeparate && (
                  <p className="field-help">
                    Carregue sua música no estúdio para iniciar a separação.
                  </p>
                )}
                {jobActive && (
                  <p className="field-help">
                    Já existe uma tarefa em andamento. Acompanhe o progresso no
                    estúdio.
                  </p>
                )}
              </>
            )}
            {panel === "import" && (
              <>
                <div className="modal-eyebrow">
                  <FileText size={19} /> SUA MÚSICA, SEU MATERIAL
                </div>
                <h2>Traga sua cifra ou tablatura.</h2>
                <p>
                  Cole o texto mantendo o alinhamento original. Depois, marque
                  os trechos enquanto a música toca.
                </p>
                <div className="import-top">
                  <button
                    className="button secondary compact"
                    onClick={() => textInput.current?.click()}
                  >
                    <FolderOpen size={15} /> Abrir TXT / LRC / ChordPro
                  </button>
                  <label>
                    Separar por{" "}
                    <select
                      value={textMode}
                      onChange={(e) =>
                        setTextMode(e.target.value as "blocks" | "lines")
                      }
                    >
                      <option value="blocks">blocos (linha em branco)</option>
                      <option value="lines">linhas</option>
                    </select>
                  </label>
                </div>
                <textarea
                  className="import-text"
                  autoFocus
                  aria-label="Texto da cifra ou tablatura"
                  placeholder={
                    "Em             C\nCole aqui sua cifra com a letra\n\nG              D\nOu os blocos de tablatura"
                  }
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  spellCheck={false}
                />
                <p className="field-help">
                  Blocos preservam as seis linhas de uma tablatura. Arquivos LRC
                  mantêm os tempos existentes. Aplicar substitui os marcadores
                  atuais.
                </p>
                <div className="modal-footer">
                  <button
                    className="button ghost"
                    onClick={() => setPanel("none")}
                  >
                    Cancelar
                  </button>
                  <button
                    className="button primary"
                    disabled={!text.trim()}
                    onClick={applyText}
                  >
                    <Check size={16} /> Aplicar texto
                  </button>
                </div>
              </>
            )}
            {panel === "projects" && (
              <>
                <div className="modal-eyebrow">
                  <FolderOpen size={19} /> SEU REPERTÓRIO
                </div>
                <h2>Meus projetos.</h2>
                <p>
                  Áudios, cifras e ajustes salvos neste dispositivo. Exporte um
                  projeto para transferi-lo para outro aparelho.
                </p>
                <div className="project-list">
                  {projects.length ? (
                    projects.map((p) => (
                      <div className="project-item" key={p.id}>
                        <Music2 size={20} />
                        <button
                          disabled={!!busy || jobActive}
                          onClick={() => {
                            void loadSession(p.id).then((s) => s && open(s));
                          }}
                        >
                          <strong>{p.title}</strong>
                          <small>
                            {formatTime(p.duration)} · {p.tracks.length} faixas
                            · {new Date(p.updated).toLocaleDateString("pt-BR")}
                          </small>
                        </button>
                        <button
                          className="icon-button"
                          title="Remover projeto deste dispositivo"
                          aria-label={`Remover projeto ${p.title}`}
                          disabled={jobActive || !!busy}
                          onClick={() => {
                            void remove(p.id).catch((e) => notify(message(e)));
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="empty-projects">
                      Seu repertório começa com a primeira música.
                    </div>
                  )}
                </div>
                <div className="modal-footer">
                  <button
                    className="button secondary"
                    disabled={!!busy || jobActive}
                    onClick={() => projectInput.current?.click()}
                  >
                    <Upload size={16} /> Importar projeto
                  </button>
                  <button
                    className="button primary"
                    disabled={!!busy || jobActive}
                    onClick={() => audioInput.current?.click()}
                  >
                    <Plus size={16} /> Nova música
                  </button>
                </div>
              </>
            )}
            {panel === "help" && (
              <>
                <div className="modal-eyebrow">
                  <Headphones size={19} /> DO PLAY À PRÁTICA
                </div>
                <h2>Seu espaço na música.</h2>
                <div className="help-steps">
                  <div>
                    <Upload size={20} />
                    <p>
                      <strong>Carregue uma música.</strong> Abra um MP3 e dê
                      play. A faixa original fica disponível imediatamente.
                    </p>
                  </div>
                  <div>
                    <Sparkles size={20} />
                    <p>
                      <strong>Separe com IA.</strong> Conecte um servidor de
                      processamento e escolha o modelo. A qualidade depende da
                      gravação e dos instrumentos.
                    </p>
                  </div>
                  <div>
                    <SlidersHorizontal size={20} />
                    <p>
                      <strong>Monte o acompanhamento.</strong> Use M para
                      silenciar uma pista, S para ouvi-la sozinha e o olho para
                      esconder sua notação.
                    </p>
                  </div>
                  <div>
                    <Radio size={20} />
                    <p>
                      <strong>Sincronize seu material.</strong> Importe texto,
                      ative Sincronizar e use Marcar no início de cada trecho.
                      Arraste os marcadores na forma de onda para ajustar.
                    </p>
                  </div>
                </div>
                <div className="shortcuts">
                  <span>
                    <kbd>Espaço</kbd> play / pause
                  </span>
                  <span>
                    <kbd>M</kbd> marcar trecho selecionado
                  </span>
                  <span>
                    <kbd>←</kbd>
                    <kbd>→</kbd> voltar / avançar 5 s
                  </span>
                </div>
                <button
                  className="button secondary"
                  disabled={!!busy || jobActive}
                  onClick={() => {
                    setPanel("none");
                    void demo();
                  }}
                >
                  <Play size={15} /> Experimentar demonstração
                </button>
              </>
            )}
          </section>
        </div>
      )}
      {busy && (
        <div className="busy-banner" role="status">
          <LoaderCircle size={17} className="spin" />
          {busy}
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Activity size={18} />
          <span>{toast}</span>
          <button aria-label="Fechar mensagem" onClick={() => setToast("")}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function TimeInput({
  value,
  max,
  onChange,
}: {
  value: number | null;
  max: number;
  onChange: (n: number | null) => void;
}) {
  const [text, setText] = useState(
    value === null ? "" : formatTime(value, true),
  );
  useEffect(
    () => setText(value === null ? "" : formatTime(value, true)),
    [value],
  );
  return (
    <input
      className="cue-time-input"
      aria-label="Tempo do marcador"
      placeholder="00:00.00"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const n = parseTime(text);
        if (!text.trim()) onChange(null);
        else if (n !== null && n <= max) onChange(n);
        else setText(value === null ? "" : formatTime(value, true));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}
function EyeIcon() {
  return <span className="eye-symbol">◉</span>;
}
function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Não foi possível concluir a operação.";
}
