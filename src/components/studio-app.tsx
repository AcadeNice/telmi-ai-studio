"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArchiveRestore,
  BadgeEuro,
  Bell,
  BookHeart,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  LayoutDashboard,
  LogOut,
  Image as ImageIcon,
  Plus,
  PencilLine,
  RefreshCw,
  RotateCcw,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  WandSparkles,
} from "lucide-react";
import { GraphEditor } from "./graph-editor";
import { ART_STYLE_OPTIONS } from "@/lib/narrative/image-style";
import type {
  CreationParameters,
  NarrativeChoice,
  NarrativeScene,
  NarrativeStory,
} from "@/lib/narrative/schema";

type Screen =
  | "dashboard"
  | "create"
  | "library"
  | "trash"
  | "settings"
  | "story";
type StoryVersion = {
  id: string;
  version: number;
  status: string;
  parametersJson: string;
  estimatedCostCents: number;
  actualCostCents: number;
  packPath?: string | null;
  mediaReviewedAt?: string | null;
};
type Story = {
  id: string;
  uuid: string;
  title: string;
  description: string;
  age: number;
  deletedAt?: string | null;
  coverUrl?: string | null;
  versions?: StoryVersion[];
  assets?: Array<{ id: string; type: string }>;
  latestJob?: {
    id: string;
    status: string;
    progress: number;
    currentStep?: string | null;
  } | null;
};
type InternalNotification = {
  id: string;
  title: string;
  message: string;
  readAt?: string | null;
};
type DashboardSummary = {
  monthlySpentCents: number;
  monthlyBudgetCents: number;
};
type TtsVoice = {
  voice_id: string;
  name: string;
  category?: string;
  preview_url?: string;
  labels?: Record<string, string>;
};
type ApiFailure = {
  code?: string;
  message?: string;
  fieldErrors?: Record<string, string[]>;
};

type MediaReviewAsset = {
  id: string;
  type: "cover" | "image" | "title_audio" | "audio";
  sceneKey?: string | null;
  provider?: string | null;
  mimeType: string;
  bytes: number;
  label: string;
  prompt?: string;
  text?: string;
  voiceId?: string;
  source: "generated" | "uploaded";
  contentUrl: string;
};

type MediaReview = {
  list: MediaReviewAsset[];
  complete: boolean;
  expectedCount: number;
  generatedCount: number;
  reviewedAt?: string | null;
  readOnly: boolean;
};

class ApiClientError extends Error {
  constructor(
    public code: string,
    message: string,
    public fieldErrors: Record<string, string[]> = {},
  ) {
    super(message);
  }
}

const initialParameters: CreationParameters = {
  childName: "Mila",
  age: 4,
  targetDurationMinutes: 10,
  mainCharacter: "Une licorne",
  universe: "Une forêt enchantée",
  value: "Le partage",
  decisionCount: 3,
  choicesPerDecision: 2,
  endingStrategy: "mixed",
  happyEnding: "always",
  explicitMoral: false,
  illustrationMode: "choices",
  voiceMode: "single",
  artStylePreset: "watercolor",
  author: "Telmi AI Studio",
};

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = (await response
      .json()
      .catch(() => ({ message: `HTTP ${response.status}` }))) as ApiFailure;
    const details = Object.values(error.fieldErrors ?? {})
      .flat()
      .slice(0, 3)
      .join(" ");
    throw new ApiClientError(
      error.code ?? `HTTP_${response.status}`,
      [error.message ?? `HTTP ${response.status}`, details]
        .filter(Boolean)
        .join(" "),
      error.fieldErrors,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function StudioApp() {
  const [boot, setBoot] = useState<"loading" | "setup" | "login" | "ready">(
    "loading",
  );
  const [csrf, setCsrf] = useState("");
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [stories, setStories] = useState<Story[]>([]);
  const [deleted, setDeleted] = useState<Story[]>([]);
  const [selected, setSelected] = useState<Story | null>(null);
  const [editingStory, setEditingStory] = useState<Story | null>(null);
  const [notice, setNotice] = useState<{
    tone: "ok" | "error" | "info";
    text: string;
  } | null>(null);
  const [notifications, setNotifications] = useState<InternalNotification[]>(
    [],
  );
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary>({
    monthlySpentCents: 0,
    monthlyBudgetCents: 0,
  });

  const api = useCallback(
    async <T,>(url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (typeof init?.body === "string")
        headers.set("content-type", "application/json");
      if (init?.method && init.method !== "GET")
        headers.set("x-csrf-token", csrf);
      return parseResponse<T>(await fetch(url, { ...init, headers }));
    },
    [csrf],
  );

  const refresh = useCallback(async () => {
    const [active, all, alerts, summary] = await Promise.all([
      api<{ list: Story[] }>("/api/stories"),
      api<{ list: Story[] }>("/api/stories?deleted=true"),
      api<{ list: InternalNotification[] }>("/api/notifications"),
      api<DashboardSummary>("/api/dashboard"),
    ]);
    setStories(active.list);
    setDeleted(all.list.filter((item) => item.deletedAt));
    setNotifications(alerts.list);
    setDashboardSummary(summary);
  }, [api]);

  useEffect(() => {
    void (async () => {
      try {
        const setup = await parseResponse<{
          setupRequired: boolean;
        }>(await fetch("/api/setup"));
        if (setup.setupRequired) {
          return setBoot("setup");
        }
        const session = await parseResponse<{
          authenticated: boolean;
          csrfToken?: string;
        }>(await fetch("/api/auth/session"));
        if (!session.authenticated) return setBoot("login");
        setCsrf(session.csrfToken ?? "");
        setBoot("ready");
      } catch (error) {
        setNotice({ tone: "error", text: String(error) });
        setBoot("login");
      }
    })();
  }, []);

  useEffect(() => {
    if (boot === "ready") queueMicrotask(() => void refresh());
  }, [boot, refresh]);

  useEffect(() => {
    if (!notice) return;
    const displayedNotice = notice;
    const timer = window.setTimeout(
      () =>
        setNotice((current) => (current === displayedNotice ? null : current)),
      notice.tone === "error" ? 8_000 : 5_000,
    );
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (boot === "loading") return <Splash />;
  if (boot === "setup")
    return (
      <Setup
        onDone={(token) => {
          setCsrf(token);
          setBoot("ready");
        }}
      />
    );
  if (boot === "login")
    return (
      <Login
        onDone={(token) => {
          setCsrf(token);
          setBoot("ready");
        }}
      />
    );

  const openStory = async (story: Story) => {
    const detail = await api<Story>(`/api/stories/${story.id}`);
    setEditingStory(null);
    setSelected(detail);
    setScreen("story");
  };
  const navigate = (next: Screen) => {
    setSelected(null);
    setEditingStory(null);
    setScreen(next);
    if (["dashboard", "library", "trash"].includes(next)) void refresh();
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate("dashboard")}>
          <span className="brand-mark">T</span>
          <span>
            <strong>Telmi AI</strong>
            <small>Studio</small>
          </span>
        </button>
        <nav>
          <Nav
            active={screen === "dashboard"}
            icon={<LayoutDashboard />}
            label="Tableau de bord"
            onClick={() => navigate("dashboard")}
          />
          <Nav
            active={screen === "create"}
            icon={<WandSparkles />}
            label="Créer une histoire"
            onClick={() => navigate("create")}
          />
          <Nav
            active={screen === "library" || screen === "story"}
            icon={<BookOpen />}
            label="Bibliothèque"
            onClick={() => navigate("library")}
          />
          <Nav
            active={screen === "trash"}
            icon={<Trash2 />}
            label="Corbeille"
            onClick={() => navigate("trash")}
          />
        </nav>
        <nav className="sidebar-bottom">
          <Nav
            active={screen === "settings"}
            icon={<Settings />}
            label="Paramètres"
            onClick={() => navigate("settings")}
          />
          <button
            className="nav-item"
            aria-label="Déconnexion"
            title="Déconnexion"
            onClick={async () => {
              await api("/api/auth/logout", { method: "POST", body: "{}" });
              location.reload();
            }}
          >
            <LogOut /> <span>Déconnexion</span>
          </button>
        </nav>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div>
            <span className="eyebrow">Espace parent</span>
            <strong>
              {screen === "create" && editingStory
                ? "Modifier le brouillon"
                : screenTitle(screen)}
            </strong>
          </div>
          <button
            className="icon-button"
            title={notifications[0]?.message ?? "Notifications"}
            onClick={() => {
              const latest = notifications[0];
              if (latest) {
                setNotice({
                  tone: "info",
                  text: `${latest.title} — ${latest.message}`,
                });
                if (!latest.readAt)
                  void api("/api/notifications", {
                    method: "PATCH",
                    body: JSON.stringify({ id: latest.id }),
                  }).then(refresh);
              } else void refresh();
            }}
          >
            {notifications.some((item) => !item.readAt) ? (
              <Bell />
            ) : (
              <RefreshCw />
            )}
          </button>
        </header>
        {notice && (
          <div className={`notice ${notice.tone}`}>
            {notice.text}
            <button onClick={() => setNotice(null)}>×</button>
          </div>
        )}
        {screen === "dashboard" && (
          <Dashboard
            stories={stories}
            summary={dashboardSummary}
            onCreate={() => navigate("create")}
            onOpen={openStory}
          />
        )}
        {screen === "create" && (
          <CreationWizard
            key={editingStory?.id ?? "new-story"}
            api={api}
            existingStory={editingStory}
            onCancel={() => {
              if (editingStory) void openStory(editingStory);
              else navigate("dashboard");
            }}
            onSaved={(story) => {
              setNotice({
                tone: "ok",
                text: editingStory
                  ? "Brouillon modifié. Le scénario déjà généré, s’il existe, a été conservé."
                  : "Brouillon créé. Vous pouvez maintenant générer le scénario.",
              });
              void openStory(story);
            }}
          />
        )}
        {screen === "library" && (
          <Library
            stories={stories}
            onOpen={openStory}
            onTrash={async (id) => {
              await api(`/api/stories/${id}`, { method: "DELETE" });
              await refresh();
            }}
          />
        )}
        {screen === "trash" && (
          <Trash
            stories={deleted}
            onRestore={async (id) => {
              await api(`/api/stories/${id}`, {
                method: "PATCH",
                body: JSON.stringify({ action: "restore" }),
              });
              await refresh();
            }}
          />
        )}
        {screen === "settings" && (
          <SettingsPanel api={api} onNotice={setNotice} />
        )}
        {screen === "story" && selected && (
          <StoryStudio
            story={selected}
            api={api}
            onRefresh={() => openStory(selected)}
            onNotice={setNotice}
            onEditCreation={() => {
              setEditingStory(selected);
              setScreen("create");
            }}
          />
        )}
      </main>
    </div>
  );
}

function Splash() {
  return (
    <div className="auth-page">
      <div className="loader" />
      <p>Ouverture du studio…</p>
    </div>
  );
}
function screenTitle(screen: Screen) {
  return {
    dashboard: "Tableau de bord",
    create: "Nouvelle histoire",
    library: "Bibliothèque",
    trash: "Corbeille",
    settings: "Paramètres",
    story: "Studio de l’histoire",
  }[screen];
}
function Nav({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`nav-item ${active ? "active" : ""}`}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function Setup({ onDone }: { onDone: (csrf: string) => void }) {
  const [form, setForm] = useState({
    instanceName: "Telmi AI Studio",
    childName: "Mila",
    password: "",
    publicUrl: location.origin,
    monthlyBudgetCents: 2000,
    storyBudgetCents: 300,
  });
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const result = await parseResponse<{ csrfToken: string }>(
        await fetch("/api/setup", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            ...form,
            providers: [],
          }),
        }),
      );
      onDone(result.csrfToken);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <span className="brand-mark large">T</span>
        <h1>Bienvenue dans Telmi AI Studio</h1>
        <p>
          Quelques informations suffisent pour créer votre espace familial
          privé.
        </p>
        {error && <div className="form-error">{error}</div>}
        <Field label="Nom de l’instance">
          <input
            value={form.instanceName}
            onChange={(e) => setForm({ ...form, instanceName: e.target.value })}
          />
        </Field>
        <Field label="Prénom par défaut">
          <input
            value={form.childName}
            onChange={(e) => setForm({ ...form, childName: e.target.value })}
          />
        </Field>
        <Field label="Mot de passe administrateur">
          <input
            type="password"
            minLength={12}
            required
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="12 caractères minimum"
          />
        </Field>
        <Field label="URL publique">
          <input
            type="url"
            value={form.publicUrl}
            onChange={(e) => setForm({ ...form, publicUrl: e.target.value })}
          />
        </Field>
        <button className="primary" type="submit">
          Installer mon studio <ChevronRight />
        </button>
      </form>
    </div>
  );
}

function Login({ onDone }: { onDone: (csrf: string) => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="auth-page">
      <form
        className="auth-card compact"
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          try {
            const data = await parseResponse<{ csrfToken: string }>(
              await fetch("/api/auth/login", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ password }),
              }),
            );
            onDone(data.csrfToken);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        }}
      >
        <span className="brand-mark large">T</span>
        <h1>Ravi de vous revoir</h1>
        <p>Connectez-vous à votre studio familial.</p>
        {error && <div className="form-error">{error}</div>}
        <Field label="Mot de passe">
          <input
            autoFocus
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <button className="primary">Se connecter</button>
      </form>
    </div>
  );
}

function Dashboard({
  stories,
  summary,
  onCreate,
  onOpen,
}: {
  stories: Story[];
  summary: DashboardSummary;
  onCreate: () => void;
  onOpen: (story: Story) => void;
}) {
  const published = stories.filter((story) =>
    story.versions?.some((version) => version.status === "published"),
  ).length;
  const formatEuros = (cents: number) =>
    new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
    }).format(cents / 100);
  return (
    <div className="page-stack">
      <section className="hero">
        <div>
          <span className="pill">
            <Sparkles /> Studio familial privé
          </span>
          <h1>Quelle aventure allez-vous imaginer aujourd’hui ?</h1>
          <p>
            Créez un scénario interactif, relisez-le en famille, puis
            transformez-le en pack prêt pour Telmi.
          </p>
          <button className="primary" onClick={onCreate}>
            <Plus /> Créer une histoire
          </button>
        </div>
        <div className="hero-orb">
          <BookHeart />
        </div>
      </section>
      <section className="stats-grid">
        <Stat icon={<BookOpen />} value={stories.length} label="histoires" />
        <Stat icon={<ArchiveRestore />} value={published} label="publiées" />
        <Stat
          icon={<BadgeEuro />}
          value={formatEuros(summary.monthlySpentCents)}
          label={
            summary.monthlyBudgetCents > 0
              ? `dépensés ce mois-ci sur ${formatEuros(summary.monthlyBudgetCents)}`
              : "dépensés ce mois-ci"
          }
        />
      </section>
      <SectionTitle
        title="Histoires récentes"
        action={stories.length ? "Voir la bibliothèque" : undefined}
      />
      {stories.length === 0 ? (
        <Empty onCreate={onCreate} />
      ) : (
        <div className="story-grid">
          {stories.slice(0, 4).map((story) => (
            <StoryCard
              key={story.id}
              story={story}
              onClick={() => onOpen(story)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
function Stat({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: React.ReactNode;
  label: string;
}) {
  return (
    <div className="stat-card">
      <span>{icon}</span>
      <div>
        <strong>{value}</strong>
        <small>{label}</small>
      </div>
    </div>
  );
}
function SectionTitle({ title, action }: { title: string; action?: string }) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {action && <span>{action}</span>}
    </div>
  );
}
function Empty({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="empty">
      <BookOpen />
      <h3>Votre bibliothèque attend sa première histoire</h3>
      <p>L’assistant vous accompagne étape par étape.</p>
      <button className="secondary" onClick={onCreate}>
        Commencer
      </button>
    </div>
  );
}

function CreationWizard({
  api,
  existingStory,
  onCancel,
  onSaved,
}: {
  api: <T>(url: string, init?: RequestInit) => Promise<T>;
  existingStory: Story | null;
  onCancel: () => void;
  onSaved: (story: Story) => void;
}) {
  const existingVersion = existingStory?.versions?.[0];
  const savedParameters = (() => {
    if (!existingVersion?.parametersJson) return null;
    try {
      return JSON.parse(existingVersion.parametersJson) as CreationParameters;
    } catch {
      return null;
    }
  })();
  const [step, setStep] = useState(1);
  const [params, setParams] = useState<CreationParameters>(() => ({
    ...initialParameters,
    ...(savedParameters ?? {}),
    artStylePreset:
      savedParameters?.artStylePreset ??
      (savedParameters?.artDirection ? "custom" : "watercolor"),
  }));
  const [title, setTitle] = useState(
    existingStory?.title ?? "L’aventure de Mila",
  );
  const [description, setDescription] = useState(
    existingStory?.description ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [voicesStatus, setVoicesStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [voicesError, setVoicesError] = useState("");
  const [voiceLanguage, setVoiceLanguage] = useState("fr");
  const loadVoices = useCallback(async () => {
    setVoicesStatus("loading");
    setVoicesError("");
    try {
      const result = await api<{ list: TtsVoice[] }>("/api/providers/voices");
      setVoices(result.list);
      const defaultVoice = result.list[0];
      if (defaultVoice)
        setParams((current) =>
          current.defaultVoiceId
            ? current
            : {
                ...current,
                defaultVoiceId: defaultVoice.voice_id,
                defaultVoiceName: defaultVoice.name,
              },
        );
      setVoicesStatus("ready");
    } catch (error) {
      setVoicesStatus("error");
      setVoicesError(
        error instanceof Error ? error.message : "Voix indisponibles.",
      );
    }
  }, [api]);
  useEffect(() => {
    if (existingStory) return;
    void api<{ childName: string; instanceName: string }>("/api/settings")
      .then((settings) => {
        setParams((current) => ({
          ...current,
          childName: settings.childName,
          author: settings.instanceName,
        }));
        setTitle((current) =>
          current === "L’aventure de Mila"
            ? `L’aventure de ${settings.childName}`
            : current,
        );
      })
      .catch(() => undefined);
  }, [api, existingStory]);
  useEffect(() => {
    queueMicrotask(() => void loadVoices());
  }, [loadVoices]);
  const estimate = useMemo(
    () => ({
      scenes: 2 + params.decisionCount * (params.choicesPerDecision + 1),
      images:
        params.illustrationMode === "every-scene"
          ? 2 + params.decisionCount * (params.choicesPerDecision + 1)
          : params.decisionCount * params.choicesPerDecision + 1,
    }),
    [params],
  );
  const availableVoiceLanguages = useMemo(() => {
    const languages = new Set(
      voices
        .map((voice) => normalizeVoiceLanguage(voice.labels?.language))
        .filter((language): language is string => Boolean(language)),
    );
    languages.add("fr");
    return [...languages].sort((left, right) => {
      if (left === "fr") return -1;
      if (right === "fr") return 1;
      return formatVoiceLanguage(left).localeCompare(
        formatVoiceLanguage(right),
        "fr",
      );
    });
  }, [voices]);
  const filteredVoices = useMemo(
    () =>
      voices.filter(
        (voice) =>
          isCustomVoice(voice) ||
          voiceLanguage === "all" ||
          normalizeVoiceLanguage(voice.labels?.language) === voiceLanguage,
      ),
    [voiceLanguage, voices],
  );
  const customVoices = filteredVoices.filter(isCustomVoice);
  const standardVoices = filteredVoices.filter(
    (voice) => !isCustomVoice(voice),
  );
  const selectedVoice = voices.find(
    (voice) => voice.voice_id === params.defaultVoiceId,
  );
  return (
    <div className="wizard page-card">
      {existingStory && (
        <div className="wizard-editing-banner">
          <div>
            <strong>Modification du brouillon</strong>
            <span>
              Les réponses sont préremplies. Si un scénario existe déjà, il
              reste conservé et consultable.
            </span>
          </div>
          <button className="ghost" onClick={onCancel}>
            Voir le scénario
          </button>
        </div>
      )}
      <div className="steps">
        {[
          "Pour qui ?",
          "L’aventure",
          "Les choix",
          "Ambiance",
          "Vérification",
        ].map((label, index) => (
          <button
            key={label}
            className={
              step === index + 1 ? "active" : step > index + 1 ? "done" : ""
            }
            onClick={() => setStep(index + 1)}
          >
            <span>{index + 1}</span>
            {label}
          </button>
        ))}
      </div>
      <div className="wizard-body">
        {step === 1 && (
          <>
            <h2>À qui raconte-t-on cette histoire ?</h2>
            <div className="form-grid">
              <Field label="Prénom">
                <input
                  value={params.childName}
                  onChange={(e) =>
                    setParams({ ...params, childName: e.target.value })
                  }
                />
              </Field>
              <Field label="Âge">
                <input
                  type="number"
                  min={2}
                  max={12}
                  value={params.age}
                  onChange={(e) =>
                    setParams({ ...params, age: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="Durée cible">
                <select
                  value={params.targetDurationMinutes}
                  onChange={(e) =>
                    setParams({
                      ...params,
                      targetDurationMinutes: Number(e.target.value),
                    })
                  }
                >
                  {[5, 10, 15, 20, 30].map((value) => (
                    <option key={value} value={value}>
                      {value} minutes
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <h2>Imaginons l’aventure</h2>
            <div className="form-grid">
              <Field label="Titre de travail">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </Field>
              <Field label="Personnage principal">
                <input
                  value={params.mainCharacter}
                  onChange={(e) =>
                    setParams({ ...params, mainCharacter: e.target.value })
                  }
                />
              </Field>
              <Field label="Univers">
                <input
                  value={params.universe}
                  onChange={(e) =>
                    setParams({ ...params, universe: e.target.value })
                  }
                />
              </Field>
              <Field label="Valeur à transmettre">
                <input
                  value={params.value}
                  onChange={(e) =>
                    setParams({ ...params, value: e.target.value })
                  }
                />
              </Field>
            </div>
            <div className="creative-brief-grid">
              <Field label="Éléments à intégrer (facultatif)">
                <textarea
                  value={params.requiredStoryElements ?? ""}
                  placeholder="Ex. : des arcs-en-ciel, une princesse et un elfe qui s’appelle Noa…"
                  onChange={(event) =>
                    setParams({
                      ...params,
                      requiredStoryElements: event.target.value || undefined,
                    })
                  }
                />
              </Field>
              <Field label="Style graphique">
                <select
                  value={params.artStylePreset}
                  onChange={(event) => {
                    const artStylePreset = event.target
                      .value as CreationParameters["artStylePreset"];
                    setParams({
                      ...params,
                      artStylePreset,
                      artDirection:
                        artStylePreset === "custom"
                          ? params.artDirection
                          : undefined,
                    });
                  }}
                >
                  {ART_STYLE_OPTIONS.map((style) => (
                    <option key={style.value} value={style.value}>
                      {style.label}
                    </option>
                  ))}
                </select>
                {params.artStylePreset === "custom" && (
                  <textarea
                    value={params.artDirection ?? ""}
                    placeholder="Décrivez précisément le rendu souhaité : matières, palette, lumière, contours, ambiance…"
                    onChange={(event) =>
                      setParams({
                        ...params,
                        artDirection: event.target.value || undefined,
                      })
                    }
                  />
                )}
              </Field>
            </div>
            <p className="field-help">
              Les éléments imposés guident le récit. Le style sélectionné et le
              contexte visuel seront repris dans toutes les illustrations pour
              conserver les mêmes personnages, couleurs et détails.
            </p>
          </>
        )}
        {step === 3 && (
          <>
            <h2>Comment l’histoire se ramifie-t-elle ?</h2>
            <div className="form-grid">
              <Field label="Moments de décision">
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={params.decisionCount}
                  onChange={(e) =>
                    setParams({
                      ...params,
                      decisionCount: Number(e.target.value),
                    })
                  }
                />
              </Field>
              <Field label="Choix par décision">
                <input
                  type="number"
                  min={2}
                  max={5}
                  value={params.choicesPerDecision}
                  onChange={(e) =>
                    setParams({
                      ...params,
                      choicesPerDecision: Number(e.target.value),
                    })
                  }
                />
              </Field>
              <Field label="Stratégie des fins">
                <select
                  value={params.endingStrategy}
                  onChange={(e) =>
                    setParams({
                      ...params,
                      endingStrategy: e.target
                        .value as CreationParameters["endingStrategy"],
                    })
                  }
                >
                  <option value="shared">Une fin commune</option>
                  <option value="per-branch">Une fin par branche</option>
                  <option value="mixed">Mixte</option>
                </select>
              </Field>
              <Field label="Tonalité de la fin">
                <select
                  value={params.happyEnding}
                  onChange={(e) =>
                    setParams({
                      ...params,
                      happyEnding: e.target
                        .value as CreationParameters["happyEnding"],
                    })
                  }
                >
                  <option value="always">Toujours heureuse</option>
                  <option value="optional">Au choix</option>
                  <option value="never">Pas nécessairement heureuse</option>
                </select>
              </Field>
            </div>
          </>
        )}
        {step === 4 && (
          <>
            <h2>Voix et illustrations</h2>
            <div className="choice-cards">
              <ToggleCard
                active={params.illustrationMode === "cover"}
                title="Couverture"
                subtitle="Une image seulement"
                onClick={() =>
                  setParams({ ...params, illustrationMode: "cover" })
                }
              />
              <ToggleCard
                active={params.illustrationMode === "choices"}
                title="Aux choix"
                subtitle="Un visuel par décision"
                onClick={() =>
                  setParams({ ...params, illustrationMode: "choices" })
                }
              />
              <ToggleCard
                active={params.illustrationMode === "every-scene"}
                title="Chaque scène"
                subtitle="Le plus immersif"
                onClick={() =>
                  setParams({ ...params, illustrationMode: "every-scene" })
                }
              />
            </div>
            <div className="form-grid voice-fields">
              <Field label="Langue des voix">
                <select
                  value={voiceLanguage}
                  disabled={voicesStatus === "loading"}
                  onChange={(event) => {
                    const language = event.target.value;
                    setVoiceLanguage(language);
                    if (
                      selectedVoice &&
                      !isCustomVoice(selectedVoice) &&
                      language !== "all" &&
                      normalizeVoiceLanguage(selectedVoice.labels?.language) !==
                        language
                    )
                      setParams({
                        ...params,
                        defaultVoiceId: undefined,
                        defaultVoiceName: undefined,
                      });
                  }}
                >
                  {availableVoiceLanguages.map((language) => (
                    <option key={language} value={language}>
                      {formatVoiceLanguage(language)}
                    </option>
                  ))}
                  <option value="all">Toutes les langues</option>
                </select>
              </Field>
              <Field label="Voix de narration">
                <select
                  value={params.defaultVoiceId ?? ""}
                  onChange={(e) => {
                    const voiceId = e.target.value || undefined;
                    const voice = voices.find(
                      (item) => item.voice_id === voiceId,
                    );
                    setParams({
                      ...params,
                      defaultVoiceId: voiceId,
                      defaultVoiceName: voice?.name,
                    });
                  }}
                  disabled={voicesStatus === "loading"}
                >
                  <option value="">
                    {voicesStatus === "loading"
                      ? "Chargement des voix…"
                      : filteredVoices.length
                        ? "Choisir une voix"
                        : "Aucune voix disponible"}
                  </option>
                  {params.defaultVoiceId && !selectedVoice && (
                    <option value={params.defaultVoiceId}>
                      Voix enregistrée ({params.defaultVoiceId})
                    </option>
                  )}
                  {selectedVoice &&
                    !filteredVoices.some(
                      (voice) => voice.voice_id === selectedVoice.voice_id,
                    ) && (
                      <option value={selectedVoice.voice_id}>
                        {formatVoiceLabel(selectedVoice)} — sélectionnée
                      </option>
                    )}
                  {customVoices.length > 0 && (
                    <optgroup label="Voix personnalisées">
                      {customVoices.map((voice) => (
                        <option key={voice.voice_id} value={voice.voice_id}>
                          {formatVoiceLabel(voice)}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {standardVoices.length > 0 && (
                    <optgroup
                      label={
                        voiceLanguage === "all"
                          ? "Voix standards"
                          : `Voix en ${formatVoiceLanguage(voiceLanguage).toLowerCase()}`
                      }
                    >
                      {standardVoices.map((voice) => (
                        <option key={voice.voice_id} value={voice.voice_id}>
                          {formatVoiceLabel(voice)}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <div className="voice-selector-meta">
                  {voicesStatus === "ready" && voices.length > 0 && (
                    <span>
                      {filteredVoices.length} voix affichée
                      {filteredVoices.length > 1 ? "s" : ""} sur {voices.length}
                      . Les voix personnalisées restent toujours visibles.
                    </span>
                  )}
                  {voicesStatus === "error" && (
                    <span className="field-error">{voicesError}</span>
                  )}
                  <button
                    type="button"
                    className="ghost compact"
                    disabled={voicesStatus === "loading"}
                    onClick={() => void loadVoices()}
                  >
                    <RefreshCw /> Actualiser les voix
                  </button>
                </div>
                {selectedVoice?.preview_url && (
                  <audio
                    className="voice-preview"
                    controls
                    preload="none"
                    src={selectedVoice.preview_url}
                  />
                )}
                {selectedVoice?.category === "professional" && (
                  <p className="field-warning">
                    Cette voix provient de la bibliothèque ElevenLabs. Son
                    utilisation via l’API nécessite généralement un abonnement
                    payant.
                  </p>
                )}
              </Field>
            </div>
          </>
        )}
        {step === 5 && (
          <>
            <h2>
              {existingStory
                ? "Enregistrer les modifications"
                : "Tout est prêt pour le brouillon"}
            </h2>
            <div className="summary-card">
              <div>
                <strong>{title}</strong>
                <p>
                  {params.mainCharacter} dans {params.universe}, pour{" "}
                  {params.childName} ({params.age} ans).
                </p>
              </div>
              <dl>
                <div>
                  <dt>Durée</dt>
                  <dd>{params.targetDurationMinutes} min</dd>
                </div>
                <div>
                  <dt>Scènes estimées</dt>
                  <dd>{estimate.scenes}</dd>
                </div>
                <div>
                  <dt>Images estimées</dt>
                  <dd>{estimate.images}</dd>
                </div>
                <div>
                  <dt>Décisions</dt>
                  <dd>{params.decisionCount}</dd>
                </div>
              </dl>
              {(params.requiredStoryElements || params.artDirection) && (
                <div className="creative-summary">
                  {params.requiredStoryElements && (
                    <p>
                      <strong>Dans l’histoire :</strong>{" "}
                      {params.requiredStoryElements}
                    </p>
                  )}
                  {params.artDirection && (
                    <p>
                      <strong>Direction artistique :</strong>{" "}
                      {params.artDirection}
                    </p>
                  )}
                </div>
              )}
            </div>
            <Field label="Description facultative">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <p className="safety-note">
              Le scénario sera généré sans médias. Vous devrez le relire et le
              valider explicitement avant toute génération audio ou image.
            </p>
          </>
        )}
        <div className="wizard-actions">
          <button
            className="ghost"
            onClick={() => (step === 1 ? onCancel() : setStep(step - 1))}
          >
            {step === 1 && existingStory ? "Voir le scénario" : "Retour"}
          </button>
          {step < 5 ? (
            <button className="primary" onClick={() => setStep(step + 1)}>
              Continuer <ChevronRight />
            </button>
          ) : (
            <button
              className="primary"
              disabled={busy || !title}
              onClick={async () => {
                setBusy(true);
                try {
                  const body = JSON.stringify({
                    title,
                    description,
                    age: params.age,
                    parameters: {
                      ...params,
                      defaultVoiceName:
                        selectedVoice?.name ?? params.defaultVoiceName,
                    },
                  });
                  const story =
                    existingStory && existingVersion
                      ? await api<Story>(
                          `/api/stories/${existingStory.id}/versions/${existingVersion.id}`,
                          { method: "PATCH", body },
                        )
                      : await api<Story>("/api/stories", {
                          method: "POST",
                          body,
                        });
                  onSaved(story);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy
                ? "Enregistrement…"
                : existingStory
                  ? "Enregistrer le brouillon"
                  : "Créer le brouillon"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ToggleCard({
  active,
  title,
  subtitle,
  onClick,
}: {
  active: boolean;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`toggle-card ${active ? "active" : ""}`}
      onClick={onClick}
    >
      <strong>{title}</strong>
      <small>{subtitle}</small>
    </button>
  );
}

function isCustomVoice(voice: TtsVoice) {
  return voice.category === "cloned" || voice.category === "generated";
}

function normalizeVoiceLanguage(language?: string) {
  if (!language) return null;
  return language.trim().toLowerCase().split(/[-_]/)[0] || null;
}

function formatVoiceLanguage(language: string) {
  const commonLanguages: Record<string, string> = {
    fr: "Français",
    en: "Anglais",
    es: "Espagnol",
    de: "Allemand",
    it: "Italien",
    pt: "Portugais",
    nl: "Néerlandais",
    pl: "Polonais",
    ja: "Japonais",
    ko: "Coréen",
    zh: "Chinois",
  };
  return commonLanguages[language] ?? language.toUpperCase();
}

function formatVoiceLabel(voice: TtsVoice) {
  const categories: Record<string, string> = {
    cloned: "clonée",
    generated: "générée",
    premade: "prédéfinie",
    professional: "professionnelle",
  };
  const details = [
    voice.category ? (categories[voice.category] ?? voice.category) : null,
    voice.labels?.language,
    voice.labels?.quality,
    voice.labels?.accent,
    voice.labels?.gender,
  ].filter((value, index, list) => value && list.indexOf(value) === index);
  return details.length ? `${voice.name} — ${details.join(", ")}` : voice.name;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Library({
  stories,
  onOpen,
  onTrash,
}: {
  stories: Story[];
  onOpen: (story: Story) => void;
  onTrash: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const list = stories.filter((story) =>
    `${story.title} ${story.description}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <div className="page-stack">
      <div className="library-tools">
        <input
          type="search"
          placeholder="Rechercher par titre ou description…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span>
          {list.length} histoire{list.length > 1 ? "s" : ""}
        </span>
      </div>
      {list.length ? (
        <div className="story-grid">
          {list.map((story) => (
            <StoryCard
              key={story.id}
              story={story}
              onClick={() => onOpen(story)}
              onTrash={() => onTrash(story.id)}
            />
          ))}
        </div>
      ) : (
        <Empty onCreate={() => (location.hash = "create")} />
      )}
    </div>
  );
}
function StoryCard({
  story,
  onClick,
  onTrash,
}: {
  story: Story;
  onClick: () => void;
  onTrash?: () => void;
}) {
  const current = story.versions?.[0];
  return (
    <article className="story-card" onClick={onClick}>
      <div className="cover-placeholder">
        {story.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={story.coverUrl} alt={`Couverture de ${story.title}`} />
        ) : (
          <BookHeart />
        )}
        <span>{story.age}+</span>
      </div>
      <div className="story-card-body">
        <div className="status-row">
          <span className={`status status-${current?.status ?? "draft"}`}>
            {statusLabel(current?.status)}
          </span>
          <small>v{current?.version ?? 1}</small>
        </div>
        <h3>{story.title}</h3>
        <p>
          {story.description || "Une nouvelle histoire attend d’être imaginée."}
        </p>
        {onTrash && (
          <button
            className="trash-button"
            onClick={(event) => {
              event.stopPropagation();
              onTrash();
            }}
          >
            <Trash2 /> Corbeille
          </button>
        )}
      </div>
    </article>
  );
}
function statusLabel(status?: string) {
  return (
    (
      {
        draft: "Brouillon",
        validated: "Validé",
        generating: "Génération",
        ready: "Prêt",
        published: "Publié",
        superseded: "Remplacé",
        failed: "Erreur",
      } as Record<string, string>
    )[status ?? "draft"] ?? status
  );
}
function Trash({
  stories,
  onRestore,
}: {
  stories: Story[];
  onRestore: (id: string) => void;
}) {
  return (
    <div className="page-stack">
      <div className="page-card">
        <h2>Corbeille récupérable</h2>
        <p>
          Les histoires restent récupérables pendant 30 jours. La purge est
          volontairement manuelle.
        </p>
      </div>
      {stories.length === 0 ? (
        <div className="empty">
          <Trash2 />
          <h3>La corbeille est vide</h3>
        </div>
      ) : (
        <div className="list-card">
          {stories.map((story) => (
            <div className="list-row" key={story.id}>
              <div>
                <strong>{story.title}</strong>
                <small>Suppression programmée après 30 jours</small>
              </div>
              <button className="secondary" onClick={() => onRestore(story.id)}>
                <ArchiveRestore /> Restaurer
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StoryStudio({
  story,
  api,
  onRefresh,
  onNotice,
  onEditCreation,
}: {
  story: Story;
  api: <T>(url: string, init?: RequestInit) => Promise<T>;
  onRefresh: () => void;
  onNotice: (notice: { tone: "ok" | "error" | "info"; text: string }) => void;
  onEditCreation: () => void;
}) {
  const version = story.versions?.[0];
  const [narrative, setNarrative] = useState<NarrativeStory | null>(null);
  const [validation, setValidation] = useState<{
    valid: boolean;
    issues: Array<{
      severity: "error" | "warning";
      code: string;
      message: string;
      sceneId?: string;
    }>;
  } | null>(null);
  const [validationExpanded, setValidationExpanded] = useState(false);
  const [tab, setTab] = useState<"list" | "graph" | "json">("list");
  const [json, setJson] = useState("");
  const [busy, setBusy] = useState("");
  const [refinementInstruction, setRefinementInstruction] = useState("");
  const [preservedSceneIds, setPreservedSceneIds] = useState<string[]>([]);
  const [preservedChoiceIds, setPreservedChoiceIds] = useState<string[]>([]);
  const [graphLayoutSaved, setGraphLayoutSaved] = useState(false);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [budgetConfirmation, setBudgetConfirmation] = useState<{
    details: string[];
  } | null>(null);
  const [mediaReview, setMediaReview] = useState<MediaReview | null>(null);
  const [job, setJob] = useState<{
    id: string;
    status: string;
    progress: number;
    currentStep?: string | null;
    steps?: Array<{ step: string; status: string }>;
  } | null>(story.latestJob ?? null);
  const load = useCallback(async () => {
    if (!version) return;
    try {
      const data = await api<{
        narrative: NarrativeStory;
        validation: typeof validation;
        graphLayoutSaved: boolean;
        preservedSceneIds: string[];
        preservedChoiceIds: string[];
      }>(`/api/stories/${story.id}/versions/${version.id}/narrative`);
      setNarrative(data.narrative);
      setJson(JSON.stringify(data.narrative, null, 2));
      setValidation(data.validation);
      setGraphLayoutSaved(data.graphLayoutSaved ?? false);
      setPreservedSceneIds(data.preservedSceneIds ?? []);
      setPreservedChoiceIds(data.preservedChoiceIds ?? []);
    } catch {
      setNarrative(null);
    }
  }, [api, story.id, version]);
  const loadMedia = useCallback(async () => {
    if (!version) return;
    try {
      setMediaReview(
        await api<MediaReview>(
          `/api/stories/${story.id}/versions/${version.id}/media`,
        ),
      );
    } catch {
      setMediaReview(null);
    }
  }, [api, story.id, version]);
  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);
  useEffect(() => {
    const hasMedia = story.assets?.some((asset) =>
      ["cover", "image", "title_audio", "audio"].includes(asset.type),
    );
    if (hasMedia) queueMicrotask(() => void loadMedia());
    else queueMicrotask(() => setMediaReview(null));
  }, [loadMedia, story.assets]);
  useEffect(() => {
    queueMicrotask(() => setJob(story.latestJob ?? null));
  }, [story.latestJob]);
  useEffect(() => {
    queueMicrotask(() =>
      setValidationExpanded(Boolean(validation?.issues.length)),
    );
  }, [validation]);
  useEffect(() => {
    if (!job || ["completed", "failed"].includes(job.status)) return;
    const timer = setInterval(
      () =>
        void api<typeof job>(`/api/generation-jobs/${job.id}`)
          .then((data) => {
            setJob(data);
            if (data.status === "completed") {
              onNotice({
                tone: "ok",
                text:
                  data.currentStep === "compile"
                    ? "Le pack Telmi est prêt."
                    : "Les images et narrations sont prêtes à être vérifiées.",
              });
              void loadMedia();
              onRefresh();
            }
          })
          .catch(() => undefined),
      2000,
    );
    return () => clearInterval(timer);
  }, [api, job, loadMedia, onNotice, onRefresh]);
  if (!version) return <div className="empty">Version introuvable.</div>;
  const hasMedia = Boolean(
    story.assets?.some((asset) =>
      ["cover", "image", "title_audio", "audio"].includes(asset.type),
    ),
  );
  const action = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    try {
      await fn();
      onRefresh();
    } catch (error) {
      onNotice({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy("");
    }
  };
  const requestMediaGeneration = async (overrideBudget = false) => {
    if (
      hasMedia &&
      !overrideBudget &&
      !window.confirm(
        "Régénérer tous les médias supprimera le ZIP actuel. Vous pourrez vérifier chaque nouveau média avant d’en recréer un. Continuer ?",
      )
    )
      return;
    setBusy("media");
    try {
      const data = await api<{ job: typeof job }>("/api/generation-jobs", {
        method: "POST",
        body: JSON.stringify({ versionId: version.id, overrideBudget }),
      });
      setJob(data.job);
      setBudgetConfirmation(null);
      onRefresh();
    } catch (error) {
      if (
        !overrideBudget &&
        error instanceof ApiClientError &&
        error.code === "BUDGET_EXCEEDED"
      ) {
        setBudgetConfirmation({
          details: error.fieldErrors.budget ?? [error.message],
        });
      } else {
        onNotice({
          tone: "error",
          text: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      setBusy("");
    }
  };
  const recompileAndPublish = async () => {
    if (
      version.status === "published" &&
      !window.confirm(
        "Le ZIP actuellement disponible restera en ligne pendant la recompilation, puis sera remplacé par le nouveau pack. Continuer ?",
      )
    )
      return;
    setBusy("recompile-publish");
    try {
      await api(`/api/stories/${story.id}/compile`, {
        method: "POST",
        body: JSON.stringify({
          versionId: version.id,
          mediaReviewed: true,
          publish: true,
        }),
      });
      onNotice({
        tone: "ok",
        text: "Le ZIP a été recompilé et la version du store privé a été mise à jour.",
      });
      await loadMedia();
      onRefresh();
    } catch (error) {
      onNotice({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy("");
    }
  };
  const saveSceneEdit = async (
    scene: NarrativeScene,
    editedChoices: NarrativeChoice[],
  ) => {
    if (!narrative) return false;
    setBusy(`scene:${scene.id}`);
    try {
      const editedChoiceMap = new Map(
        editedChoices.map((choice) => [choice.id, choice]),
      );
      const nextNarrative: NarrativeStory = {
        ...narrative,
        scenes: narrative.scenes.map((item) =>
          item.id === scene.id ? scene : item,
        ),
        choices: narrative.choices.map(
          (choice) => editedChoiceMap.get(choice.id) ?? choice,
        ),
      };
      const result = await api<{
        narrative: NarrativeStory;
        validation: typeof validation;
        preservedSceneIds: string[];
        preservedChoiceIds: string[];
      }>(`/api/stories/${story.id}/versions/${version.id}/narrative`, {
        method: "PUT",
        body: JSON.stringify(nextNarrative),
      });
      setNarrative(result.narrative);
      setJson(JSON.stringify(result.narrative, null, 2));
      setValidation(result.validation);
      setPreservedSceneIds(result.preservedSceneIds ?? []);
      setPreservedChoiceIds(result.preservedChoiceIds ?? []);
      setSelectedSceneId(null);
      onNotice({
        tone: "ok",
        text: `La scène « ${scene.title} » est enregistrée et sera protégée lors du prochain passage de l’IA.`,
      });
      return true;
    } catch (error) {
      onNotice({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      setBusy("");
    }
  };
  const refineScenario = async () => {
    setBusy("refine");
    try {
      const result = await api<{
        narrative: NarrativeStory;
        validation: typeof validation;
      }>(`/api/stories/${story.id}/versions/${version.id}/generate-narrative`, {
        method: "POST",
        body: JSON.stringify({
          mode: "refine",
          instruction: refinementInstruction || undefined,
          preserveSceneIds: preservedSceneIds,
          preserveChoiceIds: preservedChoiceIds,
        }),
      });
      setNarrative(result.narrative);
      setJson(JSON.stringify(result.narrative, null, 2));
      setValidation(result.validation);
      setGraphLayoutSaved(false);
      setRefinementInstruction("");
      onNotice({
        tone: "ok",
        text: "Le scénario a été harmonisé. Vos scènes modifiées ont été conservées.",
      });
      onRefresh();
    } catch (error) {
      onNotice({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy("");
    }
  };
  const focusValidationIssue = (sceneId: string) => {
    setSelectedSceneId(sceneId);
    setTab("list");
    window.setTimeout(() => {
      document.getElementById(`scene-${sceneId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 50);
  };
  const validationErrors =
    validation?.issues.filter((issue) => issue.severity === "error") ?? [];
  const validationWarnings =
    validation?.issues.filter((issue) => issue.severity === "warning") ?? [];
  return (
    <div className="page-stack">
      <div className="studio-header page-card">
        <div>
          <span className={`status status-${version.status}`}>
            {statusLabel(version.status)}
          </span>
          <h1>{story.title}</h1>
          <p>{story.description}</p>
        </div>
        <div className="studio-actions">
          {version.status === "draft" && (
            <button className="ghost" onClick={onEditCreation}>
              <PencilLine /> Modifier la création
            </button>
          )}
          {!narrative && (
            <button
              className="primary"
              disabled={!!busy}
              onClick={() =>
                action("scenario", () =>
                  api(
                    `/api/stories/${story.id}/versions/${version.id}/generate-narrative`,
                    { method: "POST", body: "{}" },
                  ),
                )
              }
            >
              <Sparkles />{" "}
              {busy === "scenario" ? "Génération…" : "Générer le scénario"}
            </button>
          )}
          {narrative && version.status === "draft" && (
            <button
              className="primary"
              disabled={!validation?.valid || !!busy}
              onClick={() =>
                action("validate", () =>
                  api(
                    `/api/stories/${story.id}/versions/${version.id}/narrative`,
                    { method: "POST", body: "{}" },
                  ),
                )
              }
            >
              Valider en tant que parent
            </button>
          )}
          {["validated", "ready"].includes(version.status) && (
            <button
              className="primary"
              disabled={!!busy}
              onClick={() => void requestMediaGeneration()}
            >
              {busy === "media"
                ? "Préparation…"
                : hasMedia
                  ? "Régénérer tous les médias"
                  : "Générer les médias"}
            </button>
          )}
          {(["ready", "published"] as string[]).includes(version.status) && (
            <button
              className="secondary"
              disabled={!!busy}
              onClick={() => void recompileAndPublish()}
            >
              {busy === "recompile-publish"
                ? "Recompilation…"
                : version.status === "published"
                  ? "Recompiler et mettre à jour le store"
                  : "Recompiler et publier dans le store"}
            </button>
          )}
          {version.status === "published" && (
            <button
              className="secondary"
              onClick={() =>
                action("withdraw", () =>
                  api(
                    `/api/stories/${story.id}/versions/${version.id}/publish`,
                    { method: "DELETE", body: "{}" },
                  ),
                )
              }
            >
              Retirer du store
            </button>
          )}
          {story.assets?.some((asset) => asset.type === "pack") && (
            <a
              className="secondary link-button"
              href={`/api/artifacts/${story.assets.find((asset) => asset.type === "pack")!.id}/download`}
            >
              Télécharger le ZIP
            </a>
          )}
          {version.status !== "draft" && (
            <button
              className="ghost"
              onClick={() =>
                action("version", () =>
                  api(`/api/stories/${story.id}/versions`, {
                    method: "POST",
                    body: "{}",
                  }),
                )
              }
            >
              Créer un brouillon dérivé
            </button>
          )}
        </div>
      </div>
      {budgetConfirmation && (
        <div className="budget-confirmation page-card">
          <BadgeEuro />
          <div>
            <h3>Confirmer le dépassement du budget</h3>
            <p>
              La génération peut dépasser le plafond configuré. Vérifiez les
              montants avant de continuer.
            </p>
            <ul>
              {budgetConfirmation.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          </div>
          <div className="budget-confirmation-actions">
            <button
              className="ghost"
              disabled={!!busy}
              onClick={() => setBudgetConfirmation(null)}
            >
              Annuler
            </button>
            <button
              className="primary"
              disabled={!!busy}
              onClick={() => void requestMediaGeneration(true)}
            >
              {busy === "media" ? "Lancement…" : "Confirmer et générer"}
            </button>
          </div>
        </div>
      )}
      {job && (
        <div className="progress-card page-card">
          <div>
            <strong>
              {job.status === "completed"
                ? job.currentStep === "compile"
                  ? "ZIP terminé"
                  : "Médias prêts à vérifier"
                : job.status === "failed"
                  ? "Génération interrompue"
                  : "Génération en cours"}
            </strong>
            <span>
              {job.currentStep ?? "en attente"} · {job.progress}%
            </span>
          </div>
          <div className="progress">
            <i style={{ width: `${job.progress}%` }} />
          </div>
          {job.status === "failed" && (
            <button
              className="secondary"
              disabled={!!busy}
              onClick={() =>
                action("retry", async () => {
                  const firstFailed = job.steps?.find(
                    (step) => step.status === "failed",
                  )?.step;
                  await api(`/api/generation-jobs/${job.id}/retry`, {
                    method: "POST",
                    body: JSON.stringify({ step: firstFailed ?? "validate" }),
                  });
                  const refreshed = await api<typeof job>(
                    `/api/generation-jobs/${job.id}`,
                  );
                  setJob(refreshed);
                  onRefresh();
                })
              }
            >
              Relancer depuis l’étape en erreur
            </button>
          )}
        </div>
      )}
      {mediaReview && mediaReview.list.length > 0 && (
        <MediaReviewPanel
          storyId={story.id}
          version={version}
          review={mediaReview}
          api={api}
          busy={busy}
          onBusy={setBusy}
          onChange={setMediaReview}
          onNotice={onNotice}
          onRefresh={onRefresh}
        />
      )}
      {narrative ? (
        <>
          <div className="editor-tabs">
            <button
              className={tab === "list" ? "active" : ""}
              onClick={() => setTab("list")}
            >
              <FileText /> Liste
            </button>
            <button
              className={tab === "graph" ? "active" : ""}
              onClick={() => setTab("graph")}
            >
              Graphe
            </button>
            <button
              className={tab === "json" ? "active" : ""}
              onClick={() => setTab("json")}
            >
              JSON
            </button>
          </div>
          {validation && (
            <div
              className={`validation-banner ${validation.valid ? "valid" : "invalid"}`}
            >
              <button
                className="validation-summary"
                type="button"
                aria-expanded={validationExpanded}
                onClick={() => setValidationExpanded((value) => !value)}
              >
                <span>
                  <strong>
                    {validationErrors.length > 0
                      ? "Corrections requises"
                      : validationWarnings.length > 0
                        ? "Structure valide, avec des points à vérifier"
                        : "Structure valide"}
                  </strong>
                  {validation.issues.length > 0 && (
                    <small>
                      {validationErrors.length > 0 &&
                        `${validationErrors.length} correction${validationErrors.length > 1 ? "s" : ""}`}
                      {validationErrors.length > 0 &&
                        validationWarnings.length > 0 &&
                        " · "}
                      {validationWarnings.length > 0 &&
                        `${validationWarnings.length} avertissement${validationWarnings.length > 1 ? "s" : ""}`}
                    </small>
                  )}
                </span>
                {validation.issues.length > 0 && (
                  <span className="validation-toggle-label">
                    {validationExpanded ? "Masquer" : "Voir les détails"}
                    <ChevronRight />
                  </span>
                )}
              </button>
              {validationExpanded && validation.issues.length > 0 && (
                <div className="validation-details">
                  {validation.issues.map((issue, index) => {
                    const scene = issue.sceneId
                      ? narrative.scenes.find(
                          (item) => item.id === issue.sceneId,
                        )
                      : undefined;
                    return (
                      <div
                        className={`validation-issue ${issue.severity}`}
                        key={`${issue.code}-${issue.sceneId ?? "global"}-${index}`}
                      >
                        <span className="validation-severity">
                          {issue.severity === "error"
                            ? "À corriger"
                            : "À vérifier"}
                        </span>
                        <div>
                          <strong>{scene?.title ?? "Remarque générale"}</strong>
                          <p>{issue.message}</p>
                        </div>
                        {issue.sceneId && (
                          <button
                            className="ghost compact"
                            type="button"
                            onClick={() => focusValidationIssue(issue.sceneId!)}
                          >
                            Voir la scène <ChevronRight />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {!validation.valid && version.status !== "draft" && (
                    <p className="validation-locked-note">
                      Cette version est verrouillée. Créez un brouillon dérivé
                      pour appliquer les corrections.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          {version.status === "draft" && (
            <div className="refinement-card page-card">
              <div className="refinement-copy">
                <span className="refinement-icon">
                  <Sparkles />
                </span>
                <div>
                  <h3>Améliorer ou terminer avec l’IA</h3>
                  <p>
                    Modifiez d’abord les scènes souhaitées. Elles seront
                    verrouillées pendant que l’IA harmonise et complète le reste
                    du scénario.
                  </p>
                  {preservedSceneIds.length > 0 && (
                    <small>
                      {preservedSceneIds.length} scène
                      {preservedSceneIds.length > 1 ? "s" : ""} protégée
                      {preservedSceneIds.length > 1 ? "s" : ""}
                    </small>
                  )}
                </div>
              </div>
              <textarea
                value={refinementInstruction}
                maxLength={2000}
                placeholder="Consigne facultative : développe davantage la rencontre avec l’elfe, rends la fin plus douce…"
                onChange={(event) =>
                  setRefinementInstruction(event.target.value)
                }
              />
              <button
                className="secondary"
                disabled={!!busy}
                onClick={() => void refineScenario()}
              >
                <Sparkles />
                {busy === "refine"
                  ? "Amélioration en cours…"
                  : "Relancer l’IA sur ce scénario"}
              </button>
            </div>
          )}
          {tab === "list" && (
            <div className="scene-list">
              {narrative.scenes.map((scene, index) => (
                <SceneEditorCard
                  key={scene.id}
                  scene={scene}
                  index={index}
                  choices={narrative.choices.filter(
                    (choice) => choice.sourceSceneId === scene.id,
                  )}
                  editable={version.status === "draft"}
                  forceOpen={selectedSceneId === scene.id}
                  highlighted={selectedSceneId === scene.id}
                  busy={busy === `scene:${scene.id}`}
                  onSave={saveSceneEdit}
                  onClose={() => setSelectedSceneId(null)}
                />
              ))}
            </div>
          )}
          {tab === "graph" && (
            <GraphEditor
              narrative={narrative}
              savedLayout={graphLayoutSaved}
              onSaveLayout={async (positions) => {
                try {
                  await api(
                    `/api/stories/${story.id}/versions/${version.id}/narrative`,
                    {
                      method: "PATCH",
                      body: JSON.stringify({ positions }),
                    },
                  );
                  const positionsById = new Map(
                    positions.map((item) => [item.id, item.position]),
                  );
                  const nextNarrative = {
                    ...narrative,
                    scenes: narrative.scenes.map((scene) => ({
                      ...scene,
                      position: positionsById.get(scene.id) ?? scene.position,
                    })),
                  };
                  setNarrative(nextNarrative);
                  setJson(JSON.stringify(nextNarrative, null, 2));
                  setGraphLayoutSaved(true);
                  onNotice({
                    tone: "ok",
                    text: "La disposition du graphe est enregistrée.",
                  });
                } catch (error) {
                  onNotice({
                    tone: "error",
                    text: "Impossible d’enregistrer la disposition du graphe.",
                  });
                  throw error;
                }
              }}
              onSceneSelect={
                version.status === "draft"
                  ? (sceneId) => {
                      setSelectedSceneId(sceneId);
                      setTab("list");
                    }
                  : undefined
              }
            />
          )}
          {tab === "json" && (
            <div className="json-editor">
              <textarea
                value={json}
                onChange={(e) => setJson(e.target.value)}
                readOnly={version.status !== "draft"}
              />
              {version.status === "draft" && (
                <button
                  className="primary"
                  onClick={() =>
                    action("save", async () => {
                      const parsed = JSON.parse(json);
                      const result = await api<{
                        narrative: NarrativeStory;
                        validation: typeof validation;
                        preservedSceneIds: string[];
                        preservedChoiceIds: string[];
                      }>(
                        `/api/stories/${story.id}/versions/${version.id}/narrative`,
                        { method: "PUT", body: JSON.stringify(parsed) },
                      );
                      setNarrative(result.narrative);
                      setJson(JSON.stringify(result.narrative, null, 2));
                      setValidation(result.validation);
                      setPreservedSceneIds(result.preservedSceneIds ?? []);
                      setPreservedChoiceIds(result.preservedChoiceIds ?? []);
                    })
                  }
                >
                  Enregistrer le JSON
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="empty">
          <WandSparkles />
          <h3>Le brouillon est prêt</h3>
          <p>
            Configurez vos fournisseurs dans les paramètres, puis lancez la
            génération du scénario.
          </p>
        </div>
      )}
    </div>
  );
}

function MediaReviewPanel({
  storyId,
  version,
  review,
  api,
  busy,
  onBusy,
  onChange,
  onNotice,
  onRefresh,
}: {
  storyId: string;
  version: StoryVersion;
  review: MediaReview;
  api: <T>(url: string, init?: RequestInit) => Promise<T>;
  busy: string;
  onBusy: (value: string) => void;
  onChange: (review: MediaReview) => void;
  onNotice: (notice: { tone: "ok" | "error" | "info"; text: string }) => void;
  onRefresh: () => void;
}) {
  const images = review.list.filter((asset) =>
    ["cover", "image"].includes(asset.type),
  );
  const audios = review.list.filter((asset) =>
    ["title_audio", "audio"].includes(asset.type),
  );
  const published = version.status === "published";
  const locked =
    (review.readOnly && !published) || version.status === "generating";

  const prepareMediaEdit = async () => {
    if (!published) return true;
    if (
      !window.confirm(
        "Cette histoire est publiée. La modification va la retirer du store et supprimer le ZIP actuel. Vous pourrez la republier après avoir vérifié les médias. Continuer ?",
      )
    )
      return false;
    await api(`/api/stories/${storyId}/versions/${version.id}/publish`, {
      method: "DELETE",
      body: "{}",
    });
    return true;
  };

  const regenerate = async (
    asset: MediaReviewAsset,
    input: { prompt?: string; voiceId?: string },
  ) => {
    onBusy(`regenerate:${asset.id}`);
    try {
      if (!(await prepareMediaEdit())) return;
      onChange(
        await api<MediaReview>(
          `/api/stories/${storyId}/versions/${version.id}/media/${asset.id}/regenerate`,
          { method: "POST", body: JSON.stringify(input) },
        ),
      );
      onNotice({
        tone: "ok",
        text: `« ${asset.label} » a été régénéré. Vérifiez le nouveau résultat.`,
      });
      onRefresh();
    } catch (error) {
      onNotice({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      onBusy("");
    }
  };

  const upload = async (asset: MediaReviewAsset, file: File) => {
    onBusy(`upload:${asset.id}`);
    try {
      if (!(await prepareMediaEdit())) return;
      const body = new FormData();
      body.set("file", file);
      onChange(
        await api<MediaReview>(
          `/api/stories/${storyId}/versions/${version.id}/media/${asset.id}/upload`,
          { method: "POST", body },
        ),
      );
      onNotice({
        tone: "ok",
        text: `Votre fichier remplace maintenant « ${asset.label} ».`,
      });
      onRefresh();
    } catch (error) {
      onNotice({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      onBusy("");
    }
  };

  const compile = async (publish = false) => {
    onBusy("compile");
    try {
      await api(`/api/stories/${storyId}/compile`, {
        method: "POST",
        body: JSON.stringify({
          versionId: version.id,
          mediaReviewed: true,
          publish,
        }),
      });
      onNotice({
        tone: "ok",
        text: publish
          ? "Les médias sont validés, le ZIP est prêt et l’histoire est publiée dans le store privé."
          : "Les médias sont validés et le ZIP Telmi est prêt.",
      });
      onRefresh();
    } catch (error) {
      onNotice({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      onBusy("");
    }
  };

  return (
    <section className="media-review page-card">
      <div className="media-review-heading">
        <div>
          <span className="eyebrow">Contrôle parental</span>
          <h2>Vérifier les images et les narrations</h2>
          <p>
            Prévisualisez chaque média. Vous pouvez le régénérer seul ou le
            remplacer par votre propre fichier avant de créer le ZIP.
          </p>
        </div>
        <span className={`media-count ${review.complete ? "complete" : ""}`}>
          {review.generatedCount}/{review.expectedCount} prêts
        </span>
      </div>

      {published && (
        <div className="media-published-warning">
          Cette version est actuellement dans le store. Au premier média
          modifié, elle sera retirée automatiquement après votre confirmation,
          puis vous pourrez recréer et republier le ZIP.
        </div>
      )}

      <div className="media-section-heading">
        <ImageIcon />
        <div>
          <h3>Illustrations</h3>
          <p>Le prompt utilisé reste visible et modifiable.</p>
        </div>
      </div>
      <div className="media-image-grid">
        {images.map((asset) => (
          <MediaImageCard
            key={`${asset.id}:${asset.contentUrl}`}
            asset={asset}
            disabled={locked || Boolean(busy)}
            busy={busy.endsWith(asset.id)}
            onRegenerate={(prompt) => regenerate(asset, { prompt })}
            onUpload={(file) => upload(asset, file)}
          />
        ))}
      </div>

      <div className="media-section-heading audio-heading">
        <Volume2 />
        <div>
          <h3>Narrations</h3>
          <p>Écoutez le MP3 complet avant de le conserver.</p>
        </div>
      </div>
      <div className="media-audio-list">
        {audios.map((asset) => (
          <MediaAudioCard
            key={`${asset.id}:${asset.contentUrl}`}
            asset={asset}
            disabled={locked || Boolean(busy)}
            busy={busy.endsWith(asset.id)}
            onRegenerate={() => regenerate(asset, { voiceId: asset.voiceId })}
            onUpload={(file) => upload(asset, file)}
          />
        ))}
      </div>

      <div className="media-review-footer">
        <div>
          {version.status === "ready" || version.status === "published" ? (
            <span className="media-ready-message">
              <CheckCircle2 /> Le ZIP correspond aux médias affichés.
            </span>
          ) : (
            <p>
              Ce bouton confirme votre contrôle et autorise seulement ensuite la
              création du pack.
            </p>
          )}
        </div>
        {version.status === "validated" && (
          <button
            className="primary"
            disabled={!review.complete || Boolean(busy)}
            onClick={() => void compile(true)}
          >
            <CheckCircle2 />
            {busy === "compile"
              ? "Création et publication…"
              : "Créer le ZIP et publier dans le store"}
          </button>
        )}
      </div>
    </section>
  );
}

function MediaImageCard({
  asset,
  disabled,
  busy,
  onRegenerate,
  onUpload,
}: {
  asset: MediaReviewAsset;
  disabled: boolean;
  busy: boolean;
  onRegenerate: (prompt: string) => Promise<void>;
  onUpload: (file: File) => Promise<void>;
}) {
  const [prompt, setPrompt] = useState(asset.prompt ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <article className="media-image-card">
      <div className="media-preview">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={asset.contentUrl} alt={asset.label} />
        <span>{asset.source === "uploaded" ? "Image personnelle" : "IA"}</span>
      </div>
      <div className="media-card-body">
        <strong>{asset.label}</strong>
        <label>
          <span>Prompt de génération</span>
          <textarea
            value={prompt}
            maxLength={4000}
            disabled={disabled}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        <div className="media-card-actions">
          <button
            className="secondary compact"
            disabled={disabled || !prompt.trim()}
            onClick={() => void onRegenerate(prompt)}
          >
            <RotateCcw /> {busy ? "Traitement…" : "Régénérer"}
          </button>
          <div className="media-upload-control">
            <button
              type="button"
              className="ghost compact upload-button"
              disabled={disabled}
              onClick={() => inputRef.current?.click()}
            >
              <Upload /> Envoyer une image
            </button>
            <small>PNG, JPEG ou WebP · recadré en 640 × 480 (4:3)</small>
            <input
              ref={inputRef}
              className="media-file-input"
              type="file"
              accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
              disabled={disabled}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onUpload(file);
                event.target.value = "";
              }}
            />
          </div>
        </div>
      </div>
    </article>
  );
}

function MediaAudioCard({
  asset,
  disabled,
  busy,
  onRegenerate,
  onUpload,
}: {
  asset: MediaReviewAsset;
  disabled: boolean;
  busy: boolean;
  onRegenerate: () => Promise<void>;
  onUpload: (file: File) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <article className="media-audio-card">
      <div className="audio-card-copy">
        <span className="audio-icon">
          <Volume2 />
        </span>
        <div>
          <strong>{asset.label}</strong>
          {asset.text && <p>{asset.text}</p>}
          <small>
            {asset.source === "uploaded"
              ? "Fichier personnel"
              : (asset.provider ?? "Synthèse vocale IA")}
            {asset.voiceId ? ` · voix ${asset.voiceId}` : ""}
          </small>
        </div>
      </div>
      <audio key={asset.contentUrl} controls preload="metadata">
        <source src={asset.contentUrl} type="audio/mpeg" />
      </audio>
      <div className="media-card-actions">
        <button
          className="secondary compact"
          disabled={disabled || !asset.voiceId}
          onClick={() => void onRegenerate()}
        >
          <RotateCcw /> {busy ? "Traitement…" : "Régénérer"}
        </button>
        <div className="media-upload-control">
          <button
            type="button"
            className="ghost compact upload-button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <Upload /> Envoyer un audio
          </button>
          <small>MP3, WAV, M4A ou OGG · converti en MP3 44,1 kHz</small>
          <input
            ref={inputRef}
            className="media-file-input"
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.ogg"
            disabled={disabled}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onUpload(file);
              event.target.value = "";
            }}
          />
        </div>
      </div>
    </article>
  );
}

function SceneEditorCard({
  scene,
  index,
  choices,
  editable,
  forceOpen,
  highlighted,
  busy,
  onSave,
  onClose,
}: {
  scene: NarrativeScene;
  index: number;
  choices: NarrativeChoice[];
  editable: boolean;
  forceOpen: boolean;
  highlighted: boolean;
  busy: boolean;
  onSave: (
    scene: NarrativeScene,
    choices: NarrativeChoice[],
  ) => Promise<boolean>;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(forceOpen);
  const [draft, setDraft] = useState(scene);
  const [draftChoices, setDraftChoices] = useState(choices);

  const cancel = () => {
    setDraft(scene);
    setDraftChoices(choices);
    setEditing(false);
    onClose();
  };

  return (
    <article
      id={`scene-${scene.id}`}
      className={`scene-card ${editing ? "editing" : ""} ${highlighted ? "validation-target" : ""}`}
    >
      <span>{index + 1}</span>
      <div className="scene-card-content">
        <div className="scene-card-heading">
          <small>{scene.type}</small>
          {editable && !editing && (
            <button
              className="ghost compact"
              onClick={() => {
                setDraft(scene);
                setDraftChoices(choices);
                setEditing(true);
              }}
            >
              <PencilLine /> Modifier cette scène
            </button>
          )}
        </div>
        {!editing ? (
          <>
            <h3>{scene.title}</h3>
            <p>{scene.text}</p>
            {choices.length > 0 && (
              <div className="scene-choice-preview">
                {choices.map((choice) => (
                  <span key={choice.id}>{choice.label}</span>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="scene-edit-form">
            <Field label="Titre de la scène">
              <input
                value={draft.title}
                maxLength={160}
                onChange={(event) =>
                  setDraft({ ...draft, title: event.target.value })
                }
              />
            </Field>
            <Field label="Narration">
              <textarea
                value={draft.text}
                maxLength={12000}
                onChange={(event) =>
                  setDraft({ ...draft, text: event.target.value })
                }
              />
            </Field>
            <Field label="Consigne d’illustration (facultatif)">
              <textarea
                value={draft.imagePrompt ?? ""}
                maxLength={2000}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    imagePrompt: event.target.value || undefined,
                  })
                }
              />
            </Field>
            {draftChoices.length > 0 && (
              <div className="scene-choice-fields">
                <strong>Choix proposés après cette scène</strong>
                {draftChoices.map((choice, choiceIndex) => (
                  <Field key={choice.id} label={`Choix ${choiceIndex + 1}`}>
                    <input
                      value={choice.label}
                      maxLength={160}
                      onChange={(event) =>
                        setDraftChoices((current) =>
                          current.map((item) =>
                            item.id === choice.id
                              ? { ...item, label: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </Field>
                ))}
              </div>
            )}
            <div className="scene-edit-actions">
              <button className="ghost" disabled={busy} onClick={cancel}>
                Annuler
              </button>
              <button
                className="primary"
                disabled={busy || !draft.title.trim() || !draft.text.trim()}
                onClick={async () => {
                  if (await onSave(draft, draftChoices)) setEditing(false);
                }}
              >
                {busy ? "Enregistrement…" : "Enregistrer la scène"}
              </button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

type ProviderType = "text" | "image" | "tts";
type ProviderPreset =
  | "openrouter"
  | "openai"
  | "mistral"
  | "groq"
  | "elevenlabs"
  | "piper"
  | "codex"
  | "custom";
type ProviderSettings = {
  type: ProviderType;
  provider: string;
  baseUrl?: string | null;
  model?: string | null;
  enabled: boolean;
  apiKey?: string;
  configured?: boolean;
};
type ProviderModelOption = {
  id: string;
  name: string;
  description?: string;
};

const providerChoices: Record<
  ProviderType,
  Array<{ id: ProviderPreset; label: string }>
> = {
  text: [
    { id: "codex", label: "Codex CLI (abonnement ChatGPT)" },
    { id: "openrouter", label: "OpenRouter" },
    { id: "openai", label: "OpenAI" },
    { id: "mistral", label: "Mistral AI" },
    { id: "groq", label: "Groq" },
    { id: "custom", label: "Personnalisé" },
  ],
  image: [
    { id: "codex", label: "Codex Imagegen (abonnement ChatGPT)" },
    { id: "openrouter", label: "OpenRouter" },
    { id: "openai", label: "OpenAI" },
    { id: "custom", label: "Personnalisé" },
  ],
  tts: [
    { id: "piper", label: "Piper local (gratuit)" },
    { id: "elevenlabs", label: "ElevenLabs" },
    { id: "custom", label: "Personnalisé (compatible ElevenLabs)" },
  ],
};

const providerDefaults: Record<
  Exclude<ProviderPreset, "custom">,
  { baseUrl: string; model?: string }
> = {
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
  },
  mistral: {
    baseUrl: "https://api.mistral.ai/v1",
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
  },
  elevenlabs: {
    baseUrl: "https://api.elevenlabs.io/v1",
    model: "eleven_multilingual_v2",
  },
  piper: {
    baseUrl: "",
    model: "fr_FR-beatrice",
  },
  codex: {
    baseUrl: "",
    model: "gpt-5.6-sol",
  },
};

function inferProviderPresetClient(provider: ProviderSettings): ProviderPreset {
  try {
    const hostname = new URL(provider.baseUrl ?? "").hostname;
    if (hostname === "openrouter.ai") return "openrouter";
    if (hostname === "api.openai.com") return "openai";
    if (hostname === "api.mistral.ai") return "mistral";
    if (hostname === "api.groq.com") return "groq";
    if (hostname === "api.elevenlabs.io") return "elevenlabs";
  } catch {
    // An empty or custom URL belongs to the manual mode.
  }
  const value = provider.provider.toLowerCase() as ProviderPreset;
  return providerChoices[provider.type].some((choice) => choice.id === value)
    ? value
    : "custom";
}

function SettingsPanel({
  api,
  onNotice,
}: {
  api: <T>(url: string, init?: RequestInit) => Promise<T>;
  onNotice: (notice: { tone: "ok" | "error" | "info"; text: string }) => void;
}) {
  type SettingsData = {
    instanceName: string;
    childName: string;
    publicUrl: string;
    monthlyBudgetCents: number;
    storyBudgetCents: number;
    storeEnabled: boolean;
    providers: ProviderSettings[];
  };
  const [data, setData] = useState<SettingsData | null>(null);
  useEffect(() => {
    void api<SettingsData>("/api/settings").then((value) => {
      const providers = (["text", "image", "tts"] as ProviderType[]).map(
        (type): ProviderSettings => {
          const saved = value.providers.find((item) => item.type === type);
          const fallbackPreset: Exclude<ProviderPreset, "custom"> =
            type === "tts"
              ? "piper"
              : type === "image"
                ? "openai"
                : "openrouter";
          if (!saved)
            return {
              type,
              provider: fallbackPreset,
              baseUrl: providerDefaults[fallbackPreset].baseUrl,
              model: providerDefaults[fallbackPreset].model ?? "",
              enabled: true,
              configured: false,
            };
          const preset = inferProviderPresetClient(saved);
          return {
            ...saved,
            baseUrl:
              saved.baseUrl ||
              (preset === "custom" ? "" : providerDefaults[preset].baseUrl),
          };
        },
      );
      setData({ ...value, providers });
    });
  }, [api]);
  if (!data) return <Splash />;
  const updateProvider = (
    index: number,
    patch: Partial<SettingsData["providers"][number]>,
  ) =>
    setData({
      ...data,
      providers: data.providers.map((item, current) =>
        current === index ? { ...item, ...patch } : item,
      ),
    });
  return (
    <div className="settings-grid">
      <section className="page-card">
        <h2>Instance</h2>
        <Field label="Nom">
          <input
            value={data.instanceName}
            onChange={(e) => setData({ ...data, instanceName: e.target.value })}
          />
        </Field>
        <Field label="Prénom par défaut">
          <input
            value={data.childName}
            onChange={(e) => setData({ ...data, childName: e.target.value })}
          />
        </Field>
        <Field label="URL publique">
          <input
            value={data.publicUrl}
            onChange={(e) => setData({ ...data, publicUrl: e.target.value })}
          />
        </Field>
        <div className="form-grid">
          <Field label="Budget mensuel (€)">
            <input
              type="number"
              value={data.monthlyBudgetCents / 100}
              onChange={(e) =>
                setData({
                  ...data,
                  monthlyBudgetCents: Number(e.target.value) * 100,
                })
              }
            />
          </Field>
          <Field label="Plafond par histoire (€)">
            <input
              type="number"
              value={data.storyBudgetCents / 100}
              onChange={(e) =>
                setData({
                  ...data,
                  storyBudgetCents: Number(e.target.value) * 100,
                })
              }
            />
          </Field>
        </div>
      </section>
      <section className="page-card">
        <h2>Fournisseurs IA</h2>
        <p className="settings-intro">
          Choisissez un fournisseur : le studio charge ensuite uniquement les
          modèles compatibles avec l’usage concerné. Utilisez « Personnalisé »
          pour une autre API compatible.
        </p>
        {data.providers.map((provider, index) => (
          <ProviderSettingsCard
            key={provider.type}
            provider={provider}
            api={api}
            onChange={(patch) => updateProvider(index, patch)}
          />
        ))}
      </section>
      <section className="page-card">
        <h2>Store privé</h2>
        <label className="switch">
          <input
            type="checkbox"
            checked={data.storeEnabled}
            onChange={(e) =>
              setData({ ...data, storeEnabled: e.target.checked })
            }
          />
          <span /> Activer le store privé
        </label>
        <div className="store-guide">
          <div className="store-guide-heading">
            <span>
              <BookOpen />
            </span>
            <div>
              <strong>Connecter ce store à Telmi Sync</strong>
              <p>
                Le catalogue, les couvertures et les ZIP sont accessibles
                directement avec l’adresse publique du studio.
              </p>
            </div>
          </div>
          <ol>
            <li>Activez le store privé puis enregistrez les paramètres.</li>
            <li>
              Dans Telmi Sync, ouvrez <strong>Stores</strong>, puis cliquez sur{" "}
              <strong>+ Ajouter un store</strong>.
            </li>
            <li>
              Copiez l’adresse ci-dessous, collez-la dans Telmi Sync et validez
              le nouveau store.
            </li>
          </ol>
          <div className="store-url-example">
            <small>Adresse à saisir dans Telmi Sync</small>
            <code>{`${data.publicUrl.replace(/\/$/, "")}/store`}</code>
            <button
              className="ghost compact"
              onClick={async () => {
                await navigator.clipboard.writeText(
                  `${data.publicUrl.replace(/\/$/, "")}/store`,
                );
                onNotice({
                  tone: "ok",
                  text: "Adresse du store copiée.",
                });
              }}
            >
              <Copy /> Copier l’adresse
            </button>
          </div>
          <div className="inline-actions">
            <a
              className="ghost link-button compact"
              href="https://wiki.telmi.fr/stores/stores_prives/"
              target="_blank"
              rel="noreferrer"
            >
              Guide Telmi <ExternalLink />
            </a>
          </div>
        </div>
      </section>
      <OperationsPanel api={api} onNotice={onNotice} />
      <div className="settings-save">
        <button
          className="primary"
          onClick={async () => {
            try {
              await api("/api/settings", {
                method: "PUT",
                body: JSON.stringify(data),
              });
              onNotice({ tone: "ok", text: "Paramètres enregistrés." });
            } catch (error) {
              onNotice({
                tone: "error",
                text: error instanceof Error ? error.message : String(error),
              });
            }
          }}
        >
          Enregistrer les paramètres
        </button>
      </div>
    </div>
  );
}

function ProviderSettingsCard({
  provider,
  api,
  onChange,
}: {
  provider: ProviderSettings;
  api: <T>(url: string, init?: RequestInit) => Promise<T>;
  onChange: (patch: Partial<ProviderSettings>) => void;
}) {
  const preset = inferProviderPresetClient(provider);
  const effectiveBaseUrl =
    preset === "custom" ? provider.baseUrl : providerDefaults[preset].baseUrl;
  const [catalog, setCatalog] = useState<{
    status: "idle" | "loading" | "ready" | "error";
    list: ProviderModelOption[];
    error?: string;
  }>({ status: "idle", list: [] });

  const requestCatalog = async (includeTypedKey: boolean) => {
    if (preset === "custom" && !provider.baseUrl) {
      setCatalog({
        status: "error",
        list: [],
        error: "Saisissez d’abord l’URL de l’API personnalisée.",
      });
      return;
    }
    setCatalog((current) => ({
      ...current,
      status: "loading",
      error: undefined,
    }));
    try {
      const result = await api<{ list: ProviderModelOption[] }>(
        "/api/providers/models",
        {
          method: "POST",
          body: JSON.stringify({
            type: provider.type,
            preset,
            baseUrl: effectiveBaseUrl || undefined,
            apiKey: includeTypedKey ? provider.apiKey || undefined : undefined,
          }),
        },
      );
      setCatalog({ status: "ready", list: result.list });
    } catch (error) {
      setCatalog({
        status: "error",
        list: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (
        !active ||
        (preset === "custom" && !provider.baseUrl) ||
        (preset !== "openrouter" &&
          preset !== "piper" &&
          preset !== "codex" &&
          !provider.configured)
      )
        return;
      setCatalog((current) => ({
        ...current,
        status: "loading",
        error: undefined,
      }));
      void api<{ list: ProviderModelOption[] }>("/api/providers/models", {
        method: "POST",
        body: JSON.stringify({
          type: provider.type,
          preset,
          baseUrl: effectiveBaseUrl || undefined,
        }),
      })
        .then((result) => {
          if (active) setCatalog({ status: "ready", list: result.list });
        })
        .catch((error) => {
          if (active)
            setCatalog({
              status: "error",
              list: [],
              error: error instanceof Error ? error.message : String(error),
            });
        });
    });
    return () => {
      active = false;
    };
  }, [
    api,
    effectiveBaseUrl,
    preset,
    provider.baseUrl,
    provider.configured,
    provider.type,
  ]);

  const title =
    provider.type === "text"
      ? "Scénario"
      : provider.type === "image"
        ? "Images"
        : "Narration";
  const modelLabel =
    provider.type === "text"
      ? "Modèle de génération de texte"
      : provider.type === "image"
        ? "Modèle de génération d’image"
        : "Modèle de synthèse vocale";
  const selectedModelExists = catalog.list.some(
    (model) => model.id === provider.model,
  );

  return (
    <div className="provider-row">
      <div className="provider-row-heading">
        <div>
          <strong>{title}</strong>
          <small>
            {provider.type === "text"
              ? "Écriture structurée du scénario"
              : provider.type === "image"
                ? "Couverture et illustrations"
                : "MP3 et voix du compte"}
          </small>
        </div>
        <label className="switch compact-switch">
          <input
            type="checkbox"
            checked={provider.enabled}
            onChange={(event) => onChange({ enabled: event.target.checked })}
          />
          <span /> Actif
        </label>
      </div>
      <div className="form-grid provider-fields">
        <Field label="Fournisseur">
          <select
            value={preset}
            onChange={(event) => {
              const nextPreset = event.target.value as ProviderPreset;
              if (nextPreset === "custom") {
                onChange({
                  provider: "custom",
                  baseUrl: "",
                  model: "",
                });
                return;
              }
              const defaults = providerDefaults[nextPreset];
              onChange({
                provider: nextPreset,
                baseUrl: defaults.baseUrl,
                model:
                  nextPreset === "codex" && provider.type === "image"
                    ? "gpt-image-2"
                    : (defaults.model ?? ""),
              });
            }}
          >
            {providerChoices[provider.type].map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
        </Field>
        {preset === "custom" && (
          <Field label="Nom du fournisseur personnalisé">
            <input
              value={provider.provider === "custom" ? "" : provider.provider}
              onChange={(event) =>
                onChange({ provider: event.target.value || "custom" })
              }
              placeholder="Ex. : mon-api-compatible"
            />
          </Field>
        )}
        <Field label={modelLabel}>
          {preset === "custom" ? (
            <input
              value={provider.model ?? ""}
              onChange={(event) => onChange({ model: event.target.value })}
              placeholder="Identifiant exact du modèle"
            />
          ) : (
            <select
              value={provider.model ?? ""}
              disabled={catalog.status === "loading"}
              onChange={(event) => onChange({ model: event.target.value })}
            >
              <option value="">
                {catalog.status === "loading"
                  ? "Chargement des modèles…"
                  : "Choisir un modèle"}
              </option>
              {provider.model && !selectedModelExists && (
                <option value={provider.model}>
                  {provider.model} — configuration actuelle
                </option>
              )}
              {catalog.list.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name === model.id
                    ? model.id
                    : `${model.name} — ${model.id}`}
                </option>
              ))}
            </select>
          )}
        </Field>
        {preset === "piper" || preset === "codex" ? (
          <div className="provider-endpoint">
            <small>Exécution</small>
            <code>
              {preset === "piper"
                ? "Locale sur ce serveur — aucune clé API"
                : "Codex CLI sur ce serveur — connexion ChatGPT"}
            </code>
          </div>
        ) : preset === "custom" ? (
          <Field label="URL API personnalisée">
            <input
              type="url"
              value={provider.baseUrl ?? ""}
              onChange={(event) => onChange({ baseUrl: event.target.value })}
              placeholder="https://api.exemple.fr/v1"
            />
          </Field>
        ) : (
          <div className="provider-endpoint">
            <small>URL utilisée</small>
            <code>{effectiveBaseUrl}</code>
          </div>
        )}
        {preset !== "piper" && preset !== "codex" && (
          <Field label="Clé API">
            <input
              type="password"
              value={provider.apiKey ?? ""}
              onChange={(event) => onChange({ apiKey: event.target.value })}
              placeholder="Laisser vide pour conserver la clé enregistrée"
            />
          </Field>
        )}
      </div>
      <div className="provider-catalog-status">
        <button
          type="button"
          className="ghost compact"
          disabled={catalog.status === "loading"}
          onClick={() => void requestCatalog(true)}
        >
          <RefreshCw />
          {catalog.status === "loading"
            ? "Chargement…"
            : "Actualiser les modèles"}
        </button>
        {catalog.status === "ready" && (
          <span>
            {catalog.list.length} modèle{catalog.list.length > 1 ? "s" : ""}
            compatible{catalog.list.length > 1 ? "s" : ""}
          </span>
        )}
        {catalog.status === "error" && (
          <span className="field-error">{catalog.error}</span>
        )}
      </div>
      {provider.type === "tts" && preset === "elevenlabs" && (
        <p className="provider-note">
          Seuls les modèles ElevenLabs capables de synthèse vocale sont listés.
          Les voix réellement disponibles dans votre compte apparaîtront dans
          l’assistant de création.
        </p>
      )}
      {provider.type === "tts" && preset === "piper" && (
        <p className="provider-note">
          Piper génère la narration directement sur votre serveur, sans quota ni
          coût de fournisseur. Béatrice est la voix proposée par défaut.
        </p>
      )}
      {provider.type === "text" && preset === "codex" && (
        <>
          <CodexConnection api={api} />
          <p className="provider-note">
            Sol privilégie la qualité, Terra l’équilibre, Luna la rapidité et
            la légèreté. La liste vient directement des modèles disponibles
            pour ton compte ChatGPT dans Codex.
          </p>
        </>
      )}
      {provider.type === "image" && preset === "codex" && (
        <>
          <CodexConnection api={api} />
          <p className="provider-note">
            Les illustrations utilisent le skill Telmi Story Illustrator,
            construit sur le skill officiel $imagegen, avec contrôle du format,
            de la cohérence graphique et de l’absence de texte. Les limites de
            ton abonnement Codex s’appliquent.
          </p>
        </>
      )}
    </div>
  );
}

type CodexConnectionStatus = {
  connected: boolean;
  status: "idle" | "pending" | "connected" | "error";
  url?: string;
  code?: string;
  detail?: string;
  error?: string;
};

function CodexConnection({
  api,
}: {
  api: <T>(url: string, init?: RequestInit) => Promise<T>;
}) {
  const [status, setStatus] = useState<CodexConnectionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(
    () => api<CodexConnectionStatus>("/api/providers/codex").then(setStatus),
    [api],
  );
  useEffect(() => {
    queueMicrotask(() => void refresh());
  }, [refresh]);
  useEffect(() => {
    if (status?.status !== "pending") return;
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => window.clearInterval(timer);
  }, [refresh, status?.status]);
  return (
    <div className="provider-note codex-connection">
      <strong>Connexion Codex CLI</strong>
      {status?.connected ? (
        <>
          <p>
            Compte ChatGPT connecté. Le scénario peut utiliser ton abonnement
            Codex.
          </p>
          <button
            type="button"
            className="ghost compact"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setStatus(
                  await api<CodexConnectionStatus>("/api/providers/codex", {
                    method: "POST",
                    body: JSON.stringify({ action: "logout" }),
                  }),
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Déconnecter Codex
          </button>
        </>
      ) : (
        <>
          <p>
            La connexion reste enregistrée uniquement dans le volume privé du
            serveur.
          </p>
          {status?.url && status.code && (
            <div className="store-url-example">
              <small>Ouvre cette adresse puis saisis le code</small>
              <a href={status.url} target="_blank" rel="noreferrer">
                {status.url}
              </a>
              <code>{status.code}</code>
            </div>
          )}
          {status?.error && <span className="field-error">{status.error}</span>}
          <button
            type="button"
            className="secondary compact"
            disabled={busy || status?.status === "pending"}
            onClick={async () => {
              setBusy(true);
              try {
                setStatus(
                  await api<CodexConnectionStatus>("/api/providers/codex", {
                    method: "POST",
                    body: JSON.stringify({ action: "start" }),
                  }),
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {status?.status === "pending"
              ? "Connexion en attente…"
              : "Connecter mon compte ChatGPT"}
          </button>
        </>
      )}
    </div>
  );
}

function OperationsPanel({
  api,
  onNotice,
}: {
  api: <T>(url: string, init?: RequestInit) => Promise<T>;
  onNotice: (notice: { tone: "ok" | "error" | "info"; text: string }) => void;
}) {
  const [password, setPassword] = useState("");
  const [backupId, setBackupId] = useState("");
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [update, setUpdate] = useState<{
    installed: string;
    latest: string | null;
    updateAvailable: boolean;
    command: string;
  } | null>(null);
  const [logs, setLogs] = useState<
    Array<{ timestamp: string; level: string; message: string }>
  >([]);
  return (
    <section className="page-card operations">
      <h2>Exploitation</h2>
      <Field label="Mot de passe de la sauvegarde">
        <input
          type="password"
          minLength={12}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="12 caractères minimum"
        />
      </Field>
      <div className="inline-actions">
        <button
          className="secondary"
          disabled={password.length < 12}
          onClick={async () => {
            const form = new FormData();
            form.set("action", "create");
            form.set("password", password);
            try {
              const result = await api<{ id: string }>("/api/backups", {
                method: "POST",
                body: form,
              });
              setBackupId(result.id);
              onNotice({ tone: "ok", text: "Sauvegarde chiffrée créée." });
            } catch (error) {
              onNotice({
                tone: "error",
                text: error instanceof Error ? error.message : String(error),
              });
            }
          }}
        >
          Créer une sauvegarde
        </button>
        {backupId && (
          <a
            className="secondary link-button"
            href={`/api/backups?download=${backupId}`}
          >
            Télécharger
          </a>
        )}
      </div>
      <Field label="Restaurer une sauvegarde chiffrée">
        <input
          type="file"
          accept=".taisbackup,application/octet-stream"
          onChange={(event) => setRestoreFile(event.target.files?.[0] ?? null)}
        />
      </Field>
      <button
        className="secondary danger"
        disabled={!restoreFile || password.length < 12}
        onClick={async () => {
          if (
            !restoreFile ||
            !window.confirm(
              "La restauration remplacera la base et les packs actuels, puis redémarrera l’application. Continuer ?",
            )
          )
            return;
          const form = new FormData();
          form.set("action", "restore");
          form.set("password", password);
          form.set("file", restoreFile);
          try {
            await api("/api/backups", { method: "POST", body: form });
            onNotice({
              tone: "info",
              text: "Restauration validée. L’application redémarre…",
            });
            setTimeout(() => location.reload(), 2500);
          } catch (error) {
            onNotice({
              tone: "error",
              text: error instanceof Error ? error.message : String(error),
            });
          }
        }}
      >
        Restaurer et redémarrer
      </button>
      <div className="inline-actions">
        <button
          className="secondary"
          onClick={async () =>
            setLogs(
              (await api<{ list: typeof logs }>("/api/logs?limit=50")).list,
            )
          }
        >
          Afficher les journaux
        </button>
        <button
          className="secondary"
          onClick={async () => setUpdate(await api("/api/updates/check"))}
        >
          Vérifier les mises à jour
        </button>
      </div>
      {update && (
        <div className="ops-result">
          <strong>Version {update.installed}</strong>
          <p>
            {update.updateAvailable
              ? `Version ${update.latest} disponible.`
              : "Aucune mise à jour détectée."}
          </p>
          <code>{update.command}</code>
        </div>
      )}
      {logs.length > 0 && (
        <div className="log-view">
          {logs.map((log, index) => (
            <div key={`${log.timestamp}-${index}`}>
              <time>{new Date(log.timestamp).toLocaleString("fr-FR")}</time>
              <strong>{log.level}</strong>
              <span>{log.message}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
