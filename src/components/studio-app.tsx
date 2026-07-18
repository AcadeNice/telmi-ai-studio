"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArchiveRestore,
  Bell,
  BookHeart,
  BookOpen,
  ChevronRight,
  CircleDollarSign,
  FileText,
  LayoutDashboard,
  LogOut,
  Plus,
  PencilLine,
  RefreshCw,
  Settings,
  Sparkles,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { GraphEditor } from "./graph-editor";
import type {
  CreationParameters,
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
};
type Story = {
  id: string;
  uuid: string;
  title: string;
  description: string;
  age: number;
  deletedAt?: string | null;
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
type ElevenLabsVoice = {
  voice_id: string;
  name: string;
  category?: string;
  preview_url?: string;
  labels?: Record<string, string>;
};
type ApiFailure = {
  message?: string;
  fieldErrors?: Record<string, string[]>;
};

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
    throw new Error(
      [error.message ?? `HTTP ${response.status}`, details]
        .filter(Boolean)
        .join(" "),
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
    const [active, all, alerts] = await Promise.all([
      api<{ list: Story[] }>("/api/stories"),
      api<{ list: Story[] }>("/api/stories?deleted=true"),
      api<{ list: InternalNotification[] }>("/api/notifications"),
    ]);
    setStories(active.list);
    setDeleted(all.list.filter((item) => item.deletedAt));
    setNotifications(alerts.list);
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
  const [key, setKey] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const result = await parseResponse<{
        csrfToken: string;
        storeApiKey: string;
      }>(
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
      setKey(result.storeApiKey);
      sessionStorage.setItem("setup-csrf", result.csrfToken);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  if (key)
    return (
      <div className="auth-page">
        <div className="auth-card">
          <span className="brand-mark large">T</span>
          <h1>Votre studio est prêt</h1>
          <p>Copiez maintenant la clé du store. Elle ne sera plus affichée.</p>
          <code className="secret-code">{key}</code>
          <button
            className="primary"
            onClick={() => onDone(sessionStorage.getItem("setup-csrf") ?? "")}
          >
            Entrer dans le studio
          </button>
        </div>
      </div>
    );
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
  onCreate,
  onOpen,
}: {
  stories: Story[];
  onCreate: () => void;
  onOpen: (story: Story) => void;
}) {
  const published = stories.filter((story) =>
    story.versions?.some((version) => version.status === "published"),
  ).length;
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
        <Stat icon={<CircleDollarSign />} value="—" label="ce mois-ci" />
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
  }));
  const [title, setTitle] = useState(
    existingStory?.title ?? "L’aventure de Mila",
  );
  const [description, setDescription] = useState(
    existingStory?.description ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [voicesStatus, setVoicesStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [voicesError, setVoicesError] = useState("");
  const loadVoices = useCallback(async () => {
    setVoicesStatus("loading");
    setVoicesError("");
    try {
      const result = await api<{ list: ElevenLabsVoice[] }>(
        "/api/providers/voices",
      );
      setVoices(result.list);
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
    void api<{ childName: string }>("/api/settings")
      .then((settings) => {
        setParams((current) => ({ ...current, childName: settings.childName }));
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
            <Field label="Voix ElevenLabs">
              <select
                value={params.defaultVoiceId ?? ""}
                onChange={(e) =>
                  setParams({
                    ...params,
                    defaultVoiceId: e.target.value || undefined,
                  })
                }
                disabled={voicesStatus === "loading"}
              >
                <option value="">
                  {voicesStatus === "loading"
                    ? "Chargement des voix…"
                    : voices.length
                      ? "Choisir une voix"
                      : "Aucune voix disponible"}
                </option>
                {params.defaultVoiceId &&
                  !voices.some(
                    (voice) => voice.voice_id === params.defaultVoiceId,
                  ) && (
                    <option value={params.defaultVoiceId}>
                      Voix enregistrée ({params.defaultVoiceId})
                    </option>
                  )}
                {voices.map((voice) => (
                  <option key={voice.voice_id} value={voice.voice_id}>
                    {formatVoiceLabel(voice)}
                  </option>
                ))}
              </select>
              <div className="voice-selector-meta">
                {voicesStatus === "ready" && voices.length > 0 && (
                  <span>
                    {voices.length} voix disponible
                    {voices.length > 1 ? "s" : ""}, y compris vos voix clonées.
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
              {params.defaultVoiceId &&
                voices.find((voice) => voice.voice_id === params.defaultVoiceId)
                  ?.preview_url && (
                  <audio
                    className="voice-preview"
                    controls
                    preload="none"
                    src={
                      voices.find(
                        (voice) => voice.voice_id === params.defaultVoiceId,
                      )!.preview_url
                    }
                  />
                )}
            </Field>
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
                    parameters: params,
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

function formatVoiceLabel(voice: ElevenLabsVoice) {
  const categories: Record<string, string> = {
    cloned: "clonée",
    generated: "générée",
    premade: "prédéfinie",
    professional: "professionnelle",
  };
  const details = [
    voice.category ? (categories[voice.category] ?? voice.category) : null,
    voice.labels?.language,
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
        <BookHeart />
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
    issues: Array<{ severity: string; message: string }>;
  } | null>(null);
  const [tab, setTab] = useState<"list" | "graph" | "json">("list");
  const [json, setJson] = useState("");
  const [busy, setBusy] = useState("");
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
      }>(`/api/stories/${story.id}/versions/${version.id}/narrative`);
      setNarrative(data.narrative);
      setJson(JSON.stringify(data.narrative, null, 2));
      setValidation(data.validation);
    } catch {
      setNarrative(null);
    }
  }, [api, story.id, version]);
  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);
  useEffect(() => {
    if (!job || ["completed", "failed"].includes(job.status)) return;
    const timer = setInterval(
      () =>
        void api<typeof job>(`/api/generation-jobs/${job.id}`)
          .then((data) => {
            setJob(data);
            if (data.status === "completed") {
              onNotice({ tone: "ok", text: "Le pack Telmi est prêt." });
              onRefresh();
            }
          })
          .catch(() => undefined),
      2000,
    );
    return () => clearInterval(timer);
  }, [api, job, onNotice, onRefresh]);
  if (!version) return <div className="empty">Version introuvable.</div>;
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
              onClick={() =>
                action("media", async () => {
                  const data = await api<{ job: typeof job }>(
                    "/api/generation-jobs",
                    {
                      method: "POST",
                      body: JSON.stringify({ versionId: version.id }),
                    },
                  );
                  setJob(data.job);
                })
              }
            >
              Générer les médias & le ZIP
            </button>
          )}
          {version.status === "ready" && (
            <button
              className="secondary"
              onClick={() =>
                action("publish", () =>
                  api(
                    `/api/stories/${story.id}/versions/${version.id}/publish`,
                    { method: "POST", body: JSON.stringify({ replace: true }) },
                  ),
                )
              }
            >
              Publier dans le store
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
      {job && (
        <div className="progress-card page-card">
          <div>
            <strong>Génération en cours</strong>
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
              <strong>
                {validation.valid ? "Structure valide" : "Corrections requises"}
              </strong>
              <span>
                {validation.issues.length} remarque
                {validation.issues.length > 1 ? "s" : ""}
              </span>
            </div>
          )}
          {tab === "list" && (
            <div className="scene-list">
              {narrative.scenes.map((scene, index) => (
                <article key={scene.id} className="scene-card">
                  <span>{index + 1}</span>
                  <div>
                    <small>{scene.type}</small>
                    <h3>{scene.title}</h3>
                    <p>{scene.text}</p>
                  </div>
                </article>
              ))}
            </div>
          )}
          {tab === "graph" && <GraphEditor narrative={narrative} />}
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
                      }>(
                        `/api/stories/${story.id}/versions/${version.id}/narrative`,
                        { method: "PUT", body: JSON.stringify(parsed) },
                      );
                      setNarrative(result.narrative);
                      setValidation(result.validation);
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
    n8nWebhookUrl?: string | null;
    providers: Array<{
      type: "text" | "image" | "tts";
      provider: string;
      baseUrl?: string | null;
      model?: string | null;
      enabled: boolean;
      apiKey?: string;
    }>;
  };
  const [data, setData] = useState<SettingsData | null>(null);
  const [storeKey, setStoreKey] = useState("");
  useEffect(() => {
    void api<SettingsData>("/api/settings").then((value) =>
      setData({
        ...value,
        providers: ["text", "image", "tts"].map(
          (type) =>
            value.providers.find((item) => item.type === type) ?? {
              type: type as "text" | "image" | "tts",
              provider:
                type === "tts"
                  ? "elevenlabs"
                  : type === "image"
                    ? "openai"
                    : "openrouter",
              enabled: true,
            },
        ),
      }),
    );
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
        {data.providers.map((provider, index) => (
          <div className="provider-row" key={provider.type}>
            <strong>
              {provider.type === "text"
                ? "Scénario"
                : provider.type === "image"
                  ? "Images"
                  : "Narration"}
            </strong>
            <div className="form-grid">
              <Field label="Fournisseur">
                <input
                  value={provider.provider}
                  onChange={(e) =>
                    updateProvider(index, { provider: e.target.value })
                  }
                />
              </Field>
              <Field label="Modèle">
                <input
                  value={provider.model ?? ""}
                  onChange={(e) =>
                    updateProvider(index, { model: e.target.value })
                  }
                />
              </Field>
              <Field label="URL API">
                <input
                  value={provider.baseUrl ?? ""}
                  onChange={(e) =>
                    updateProvider(index, { baseUrl: e.target.value })
                  }
                  placeholder={
                    provider.type === "text"
                      ? "https://openrouter.ai/api/v1"
                      : "URL par défaut"
                  }
                />
              </Field>
              <Field label="Clé API">
                <input
                  type="password"
                  value={provider.apiKey ?? ""}
                  onChange={(e) =>
                    updateProvider(index, { apiKey: e.target.value })
                  }
                  placeholder="Laisser vide pour conserver"
                />
              </Field>
            </div>
          </div>
        ))}
      </section>
      <section className="page-card">
        <h2>n8n et store</h2>
        <Field label="Webhook n8n (facultatif)">
          <input
            value={data.n8nWebhookUrl ?? ""}
            onChange={(e) =>
              setData({ ...data, n8nWebhookUrl: e.target.value })
            }
          />
        </Field>
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
        <button
          className="secondary"
          onClick={async () => {
            const result = await api<{ storeApiKey: string }>(
              "/api/settings/store-key",
              { method: "POST", body: "{}" },
            );
            setStoreKey(result.storeApiKey);
          }}
        >
          Faire tourner la clé du store
        </button>
        {storeKey && <code className="secret-code small">{storeKey}</code>}
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
