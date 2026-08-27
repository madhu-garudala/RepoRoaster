"use client";

import {
  ArrowRight,
  Check,
  ChevronRight,
  Clipboard,
  Code2,
  ExternalLink,
  Flame,
  GitFork,
  Moon,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Square,
  Sun,
  Terminal,
  Zap,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { processBrowserFiles } from "./lib/browser-local";

const MODES = [
  {
    id: "pep-talk",
    name: "Pep Talk",
    eyebrow: "Gentle",
    description: "Helpful feedback with the emotional damage turned off.",
    glyph: "☺",
  },
  {
    id: "code-review",
    name: "Code Review",
    eyebrow: "Direct",
    description: "Candid, specific, and still safe to paste into a PR.",
    glyph: "⌁",
  },
  {
    id: "napalm",
    name: "Napalm",
    eyebrow: "Brutal",
    description: "No cushioning. Your abstractions are on their own.",
    glyph: "✦",
  },
  {
    id: "nsfw",
    name: "NSFW",
    eyebrow: "Unhinged",
    description: "Maximum brutality, explicit language, zero workplace decorum.",
    glyph: "!#",
  },
  {
    id: "funny",
    name: "Funny",
    eyebrow: "Comedy",
    description: "A real code review disguised as a five-minute set.",
    glyph: "☻",
  },
] as const;

type ModeId = (typeof MODES)[number]["id"];

type RoastResult = {
  repo: {
    name: string;
    url: string;
    description: string | null;
    stars: number;
    language: string;
    filesScanned: number;
    totalFiles: number;
  };
  roast: {
    verdict: string;
    score: number;
    summary: string;
    hits: Array<{
      title: string;
      body: string;
      evidence: string;
      severity: "low" | "medium" | "high";
    }>;
    redeemingQuality: string;
    firstAid: string[];
  };
  meta: {
    requestId: string;
    model: string;
    cached: boolean;
    durationMs: number;
  };
};

const EXAMPLES = [
  "https://github.com/expressjs/express",
  "https://github.com/pallets/flask",
  "https://github.com/fastify/fastify",
];

function formatNumber(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact" }).format(value);
}

const THEME_EVENT = "repo-roast-theme-change";

function getThemeSnapshot() {
  const saved = localStorage.getItem("repo-roast-theme");
  return saved
    ? saved === "dark"
    : window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function subscribeToTheme(callback: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener(THEME_EVENT, callback);
  media.addEventListener("change", callback);
  return () => {
    window.removeEventListener(THEME_EVENT, callback);
    media.removeEventListener("change", callback);
  };
}

function ThemeButton() {
  const dark = useSyncExternalStore(subscribeToTheme, getThemeSnapshot, () => false);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);

  function toggle() {
    const next = !dark;
    localStorage.setItem("repo-roast-theme", next ? "dark" : "light");
    window.dispatchEvent(new Event(THEME_EVENT));
  }

  return (
    <button
      className="icon-button"
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

function ScoreDial({ score }: { score: number }) {
  return (
    <div className="score-dial" style={{ "--score": score } as React.CSSProperties}>
      <div>
        <strong>{score}</strong>
        <span>/100</span>
      </div>
    </div>
  );
}

export default function Home() {
  const [repoUrl, setRepoUrl] = useState("");
  const [localFiles, setLocalFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<ModeId>("code-review");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<RoastResult | null>(null);
  const [loading, setLoading] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLElement | null>(null);

  async function handleDirectorySelect(event: React.ChangeEvent<HTMLInputElement>) {
    if (event.target.files && event.target.files.length > 0) {
      setLocalFiles(Array.from(event.target.files));
      const repoName = event.target.files[0].webkitRelativePath.split('/')[0] || "local-repo";
      setRepoUrl(repoName + " (Local)");
    }
  }

  async function pasteUrl() {
    try {
      const text = await navigator.clipboard.readText();
      setRepoUrl(text.trim());
    } catch {
      setError("Clipboard access was blocked. Paste the GitHub URL directly.");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setResult(null);
    setStatus("Checking the address…");
    setLoading(true);

    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      if (!localFiles.length && (repoUrl.startsWith("/") || repoUrl.match(/^[a-zA-Z]:\\/))) {
        throw new Error("To roast a local repository, please click the 'LOCAL FOLDER' button to select it securely.");
      }

      let payload: Record<string, unknown> = { repoUrl, mode };
      
      // If we already have a result for this exact repo, we can reuse it to save tokens
      const isSameRepo = result && (
        result.repo.url === `file://${repoUrl.replace(" (Local)", "")}` || 
        result.repo.url === `https://github.com/${repoUrl.replace("https://github.com/", "")}` ||
        result.repo.url === `https://github.com/${repoUrl}` ||
        (localFiles.length > 0 && result.repo.url === `file://${localFiles[0].webkitRelativePath.split('/')[0] || "local-repo"}`)
      );
      
      if (isSameRepo) {
        payload.previousRoast = result.roast;
      }
      
      if (localFiles.length > 0) {
        const localContext = await processBrowserFiles(localFiles, (msg) => setStatus(msg));
        payload = { ...payload, repoUrl: "local", mode, localContext };
      }

      const response = await fetch("/api/roast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "The roast never made it out of the oven.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const eventBlock of events) {
          const dataLine = eventBlock
            .split("\n")
            .find((line) => line.startsWith("data: "));
          if (!dataLine) continue;
          const eventData = JSON.parse(dataLine.slice(6)) as {
            type: "status" | "result" | "error";
            message?: string;
            result?: RoastResult;
          };
          if (eventData.type === "status" && eventData.message) {
            setStatus(eventData.message);
          }
          if (eventData.type === "result" && eventData.result) {
            setResult(eventData.result);
            setStatus("");
            requestAnimationFrame(() =>
              resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
            );
          }
          if (eventData.type === "error") {
            throw new Error(eventData.message || "The roast failed unexpectedly.");
          }
        }
      }
    } catch (caught) {
      if ((caught as Error).name !== "AbortError") {
        setError(caught instanceof Error ? caught.message : "Something went wrong.");
      }
    } finally {
      setLoading(false);
      setStatus("");
      controllerRef.current = null;
    }
  }

  function stop() {
    controllerRef.current?.abort();
    setLoading(false);
    setStatus("");
  }

  return (
    <main>
      <nav className="nav shell" aria-label="Main navigation">
        <a className="brand" href="#top" aria-label="Repo Roast home">
          <span className="brand-mark"><Flame size={19} strokeWidth={2.7} /></span>
          <span>REPO ROAST</span>
        </a>
        <div className="nav-actions">
          <span className="luna-pill"><Sparkles size={13} /> GPT-5.6 LUNA</span>
          <a className="nav-link" href="#how-it-works">HOW IT WORKS</a>
          <a className="icon-button" href="https://github.com" target="_blank" rel="noreferrer" aria-label="Open GitHub">
            <GitFork size={18} />
          </a>
          <ThemeButton />
        </div>
      </nav>

      <section className="hero shell" id="top">
        <div className="hero-copy">
          <p className="eyebrow"><span /> AI REPO COMEDY ROAST</p>
          <h1>Your repo has been <em>talking</em> behind your back.</h1>
          <p className="lede">
            Drop a public GitHub repository. Luna reads the evidence, finds the most questionable choices,
            and delivers the devastatingly funny code roast you deserve. Strictly for entertainment!
          </p>
          <div className="trust-row">
            <span><ShieldCheck size={16} /> Public repos only</span>
            <span><Zap size={16} /> No clone required</span>
            <span><Code2 size={16} /> Evidence-backed</span>
          </div>
        </div>

        <form className="roast-card" onSubmit={submit}>
          <div className="card-corner">01</div>
          <div className="field-label">
            <label htmlFor="repo-url">GITHUB OR LOCAL REPOSITORY</label>
            <span>github.com/owner/repo or select folder</span>
          </div>
          <div className="url-input-wrap">
            <GitFork size={20} aria-hidden="true" />
            <input
              id="repo-url"
              type="text"
              placeholder="https://github.com/owner/repository"
              value={repoUrl}
              onChange={(event) => {
                setRepoUrl(event.target.value);
                setLocalFiles([]);
              }}
              autoComplete="url"
              required={localFiles.length === 0}
              disabled={loading}
            />
            <input 
              type="file"
              // @ts-expect-error React types don't include webkitdirectory
              webkitdirectory=""
              multiple
              ref={fileInputRef}
              onChange={handleDirectorySelect}
              style={{ display: 'none' }}
            />
            <button type="button" onClick={() => fileInputRef.current?.click()} className="paste-button" style={{ marginLeft: 5 }}>
              LOCAL FOLDER
            </button>
            <button type="button" onClick={pasteUrl} className="paste-button">
              <Clipboard size={15} /> PASTE
            </button>
          </div>

          <fieldset className="mode-fieldset" disabled={loading}>
            <legend>CHOOSE YOUR DAMAGE</legend>
            <div className="mode-grid">
              {MODES.map((item) => (
                <label className={`mode-card ${mode === item.id ? "selected" : ""}`} key={item.id}>
                  <input
                    type="radio"
                    name="roast-mode"
                    value={item.id}
                    checked={mode === item.id}
                    onChange={() => setMode(item.id)}
                  />
                  <span className="mode-top">
                    <span className="mode-glyph">{item.glyph}</span>
                    <span className="mode-check">{mode === item.id && <Check size={13} />}</span>
                  </span>
                  <strong>{item.name}</strong>
                  <small>{item.eyebrow}</small>
                  <p>{item.description}</p>
                </label>
              ))}
            </div>
          </fieldset>

          {error && <p className="form-error" role="alert">{error}</p>}

          <button className="roast-button" type={loading ? "button" : "submit"} onClick={loading ? stop : undefined}>
            {loading ? (
              <><Square size={14} fill="currentColor" /> STOP ROAST</>
            ) : (
              <>ROAST THIS REPO <ArrowRight size={19} /></>
            )}
          </button>
          <div className="card-footnote" aria-live="polite">
            {loading ? (
              <span className="status"><i /> {status || "Warming up the flamethrower…"}</span>
            ) : (
              <><span>Usually ready in under a minute.</span><span>No code is stored.</span></>
            )}
          </div>
        </form>
      </section>

      <section className="ticker" aria-label="Example repositories">
        <div className="ticker-track shell">
          <span className="ticker-label">NEED A TEST SUBJECT?</span>
          {EXAMPLES.map((example) => (
            <button key={example} onClick={() => { setRepoUrl(example); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
              {example.replace("https://github.com/", "")} <ChevronRight size={14} />
            </button>
          ))}
        </div>
      </section>

      {result && (
        <section className="results shell" ref={resultRef} aria-live="polite">
          <div className="result-heading">
            <div>
              <p className="eyebrow"><span /> THE DAMAGE REPORT</p>
              <a href={result.repo.url} target="_blank" rel="noreferrer">
                {result.repo.name} <ExternalLink size={17} />
              </a>
              <p>{result.roast.verdict}</p>
            </div>
            <ScoreDial score={result.roast.score} />
          </div>

          <div className="repo-stats">
            <span><strong>{result.repo.language}</strong> primary language</span>
            <span><strong>{formatNumber(result.repo.stars)}</strong> stars</span>
            <span><strong>{result.repo.filesScanned}/{result.repo.totalFiles}</strong> files inspected</span>
            <span><strong>{result.meta.cached ? "HIT" : "MISS"}</strong> analysis cache</span>
          </div>

          <blockquote>{result.roast.summary}</blockquote>

          <div className="findings">
            {result.roast.hits.map((hit, index) => (
              <article className="finding" key={`${hit.title}-${index}`}>
                <div className="finding-number">{String(index + 1).padStart(2, "0")}</div>
                <div>
                  <span className={`severity severity-${hit.severity}`}>{hit.severity}</span>
                  <h3>{hit.title}</h3>
                  <p>{hit.body}</p>
                  <code>{hit.evidence}</code>
                </div>
              </article>
            ))}
          </div>

          <div className="recovery-grid">
            <article>
              <span className="mini-label">CREDIT WHERE IT’S DUE</span>
              <h3>One redeeming quality</h3>
              <p>{result.roast.redeemingQuality}</p>
            </article>
            <article className="first-aid">
              <span className="mini-label">FIRST AID KIT</span>
              <h3>Fix these before someone forks it</h3>
              <ol>
                {result.roast.firstAid.map((item) => <li key={item}>{item}</li>)}
              </ol>
            </article>
          </div>

          <div className="result-footer">
            <span>Request {result.meta.requestId.slice(0, 8)} · {result.meta.model} · {(result.meta.durationMs / 1000).toFixed(1)}s</span>
            <button onClick={() => { setResult(null); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
              <RotateCcw size={15} /> ROAST ANOTHER
            </button>
          </div>
        </section>
      )}

      <section className="how shell" id="how-it-works">
        <div className="section-title">
          <p className="eyebrow"><span /> THE FORENSICS</p>
          <h2>A vibe check with <em>receipts.</em></h2>
          <p>Not a random insult generator. Every roast starts with actual repository evidence.</p>
        </div>
        <div className="steps">
          <article>
            <span>01</span><GitFork size={27} />
            <h3>Fetch the evidence</h3>
            <p>We read public metadata, the project tree, and a bounded set of high-signal files.</p>
          </article>
          <article>
            <span>02</span><Terminal size={27} />
            <h3>Find the comedy</h3>
            <p>Luna ignores real bugs and instead mocks your over-engineered abstractions, naming conventions, and terrible styling choices.</p>
          </article>
          <article>
            <span>03</span><Flame size={27} />
            <h3>Apply personality</h3>
            <p>Your mode controls the delivery. Whether it&apos;s a pedantic code review or a comedy set, it&apos;s guaranteed to hurt your feelings.</p>
          </article>
        </div>
      </section>

      <footer className="footer">
        <div className="shell">
          <div className="brand"><span className="brand-mark"><Flame size={18} /></span><span>REPO ROAST</span></div>
          <p>Built for brave developers and suspicious pull requests.</p>
          <span>GPT-5.6 LUNA · PUBLIC REPOS ONLY</span>
        </div>
      </footer>
    </main>
  );
}
