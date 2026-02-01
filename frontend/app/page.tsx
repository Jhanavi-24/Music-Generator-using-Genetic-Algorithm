"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as Tone from "tone";
import { Midi } from "@tonejs/midi";

const KEYS = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const SCALES = ["major","minor","dorian","phrygian","lydian","mixolydian","majorBlues","minorBlues"];

type CandidateMeta = { sessionId: string; candidateId: string };
type RatingEvent = { candidateId: string; rating: number; at: string };

function clamp(n: number, a: number, b: number) { return Math.max(a, Math.min(b, n)); }
function fmtTime(sec: number) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
function shortId(id: string, n = 8) { return id ? id.slice(0, n) : ""; }
function simpleHash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).slice(0, 8).toUpperCase();
}
function ratingColor(r: number) {
  const map: Record<number, { bg: string; fg: string; border: string }> = {
    0: { bg: "rgba(239,68,68,.12)", fg: "#991b1b", border: "rgba(239,68,68,.30)" },
    1: { bg: "rgba(249,115,22,.12)", fg: "#9a3412", border: "rgba(249,115,22,.30)" },
    2: { bg: "rgba(245,158,11,.14)", fg: "#92400e", border: "rgba(245,158,11,.35)" },
    3: { bg: "rgba(34,197,94,.14)", fg: "#065f46", border: "rgba(34,197,94,.35)" },
    4: { bg: "rgba(59,130,246,.14)", fg: "#1e40af", border: "rgba(59,130,246,.35)" },
    5: { bg: "rgba(168,85,247,.14)", fg: "#6b21a8", border: "rgba(168,85,247,.35)" },
  };
  return map[r] ?? map[3];
}

const HELP: Record<string, string> = {
  key: "The musical key (tonic). This is the ‘home note’ of the melody.",
  scale: "The scale/mode used to pick notes (major, minor, dorian, blues, etc.).",
  bars: "How long the melody is (more bars = longer).",
  npb: "How many note slots per bar (higher = busier/faster rhythm).",
  tempo: "Playback speed in beats per minute (BPM).",
  population: "How many candidate melodies the GA explores per step (higher = more variety, slower).",
  steps: "Number of variations/lanes derived from the same genome (1 is simplest).",
  pauses: "If enabled, the melody can include rests (silence) between notes.",
};

/** Tooltip system (works on hover + click) **/
function useOutsideClick(ref: React.RefObject<HTMLElement | null>, onOutside: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const onDown = (e: MouseEvent | TouchEvent) => {
      const el = ref.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      onOutside();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOutside();
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown as any);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, onOutside, enabled]);
}

function HelpDot({ text }: { text: string }) {
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useOutsideClick(wrapRef, () => setOpen(false), open);

  function computePos() {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const top = r.top + r.height + 8;
    const left = Math.min(window.innerWidth - 260, Math.max(12, r.left - 120));
    setPos({ top, left });
  }

  return (
    <span
      ref={wrapRef}
      style={helpWrap}
      role="button"
      tabIndex={0}
      aria-label="Help"
      onMouseEnter={() => { computePos(); setOpen(true); }}
      onMouseLeave={() => setOpen(false)}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); computePos(); setOpen(v => !v); }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); computePos(); setOpen(v => !v); }
      }}
    >
      ?
      {open && pos ? (
        <div style={{ ...tooltip, top: pos.top, left: pos.left }}>
          <div style={tooltipText}>{text}</div>
          <div style={tooltipHint}>Esc to close</div>
        </div>
      ) : null}
    </span>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(15,23,42,.75)" }}>{label}</div>
        {help ? <HelpDot text={help} /> : null}
      </div>
      {children}
    </label>
  );
}

export default function Home() {
  // params
  const [key, setKey] = useState("C");
  const [scale, setScale] = useState("major");
  const [bars, setBars] = useState(8);
  const [notesPerBar, setNotesPerBar] = useState(4);
  const [tempo, setTempo] = useState(120);

  // advanced
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [steps, setSteps] = useState(1);
  const [population, setPopulation] = useState(60);
  const [pauses, setPauses] = useState(true);

  // app state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<CandidateMeta | null>(null);
  const [midiData, setMidiData] = useState<ArrayBuffer | null>(null);

  // playback
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [durationSec, setDurationSec] = useState(0);
  const [playheadSec, setPlayheadSec] = useState(0);

  // rating
  const [lastRating, setLastRating] = useState<number | null>(null);
  const [ratingHistory, setRatingHistory] = useState<RatingEvent[]>([]);

  // tone refs
  const synthRef = useRef<Tone.PolySynth | null>(null);
  const rafRef = useRef<number | null>(null);

  const signature = useMemo(() => {
    const s = [
      `key=${key}`, `scale=${scale}`, `bars=${bars}`, `npb=${notesPerBar}`, `tempo=${tempo}`,
      `steps=${steps}`, `pop=${population}`, `pauses=${pauses ? 1 : 0}`,
    ].join("|");
    return `SIG-${simpleHash(s)}`;
  }, [key, scale, bars, notesPerBar, tempo, steps, population, pauses]);

  const parsed = useMemo(() => {
    if (!midiData) return null;
    try {
      const midi = new Midi(midiData);
      const notes = midi.tracks.flatMap(t => t.notes);
      const end = notes.length ? Math.max(...notes.map(n => n.time + n.duration)) : 0;
      return { notes, end };
    } catch {
      return null;
    }
  }, [midiData]);

  useEffect(() => {
    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.01, decay: 0.1, sustain: 0.3, release: 0.7 },
    }).toDestination();
    synthRef.current = synth;

    return () => {
      stop();
      synth.dispose();
      synthRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startTicker() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const tick = () => {
      setPlayheadSec(Tone.Transport.seconds);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }
  function stopTicker() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }

  function clearTransport() {
    try {
      Tone.Transport.stop();
      Tone.Transport.cancel(0);
      Tone.Transport.position = 0;
    } catch {}
  }

  function stop() {
    stopTicker();
    clearTransport();
    setIsPlaying(false);
    setIsPaused(false);
    setPlayheadSec(0);
  }
  function pause() {
    try { Tone.Transport.pause(); } catch {}
    stopTicker();
    setIsPaused(true);
    setIsPlaying(false);
  }
  function resume() {
    try {
      Tone.Transport.start();
      startTicker();
      setIsPaused(false);
      setIsPlaying(true);
    } catch {}
  }
  function seek(sec: number) {
    const s = clamp(sec, 0, durationSec || 0);
    try { Tone.Transport.seconds = s; } catch {}
    setPlayheadSec(s);
  }

  function downloadMidi(filename = "generated.mid") {
    if (!midiData) return;
    const blob = new Blob([midiData], { type: "audio/midi" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  async function playNowFromBuffer(buf: ArrayBuffer) {
    try {
      const midi = new Midi(buf);
      const notes = midi.tracks.flatMap(t => t.notes);
      const synth = synthRef.current;
      if (!synth || !notes.length) return;

      stop();
      for (const n of notes) {
        Tone.Transport.schedule((t) => {
          synth.triggerAttackRelease(n.name, n.duration, t, n.velocity);
        }, n.time);
      }

      const endLocal = notes.length ? Math.max(...notes.map(n => n.time + n.duration)) : 0;
      setDurationSec(endLocal);
      Tone.Transport.scheduleOnce(() => stop(), endLocal + 0.05);

      setIsPlaying(true);
      setIsPaused(false);
      Tone.Transport.start();
      startTicker();
    } catch {}
  }

  async function fetchCandidate(url: string, payload: any, opts?: { autoplay?: boolean }) {
    setLoading(true);
    setError(null);

    try {
      await Tone.start();

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let detail = "";
        try { const j = await res.json(); detail = j?.detail ? ` — ${j.detail}` : ""; } catch {}
        throw new Error(`Backend error: ${res.status}${detail}`);
      }

      const sessionId = res.headers.get("X-Session-Id") || "";
      const candidateId = res.headers.get("X-Candidate-Id") || "";
      if (!sessionId || !candidateId) {
        throw new Error("Missing X-Session-Id / X-Candidate-Id (add expose_headers in FastAPI CORS).");
      }

      const buf = await res.arrayBuffer();
      stop();

      setMeta({ sessionId, candidateId });
      setMidiData(buf);
      setLastRating(null);

      // compute duration
      try {
        const midi = new Midi(buf);
        const notes = midi.tracks.flatMap(t => t.notes);
        const end = notes.length ? Math.max(...notes.map(n => n.time + n.duration)) : 0;
        setDurationSec(end);
      } catch { setDurationSec(0); }

      if (opts?.autoplay) {
        requestAnimationFrame(() => playNowFromBuffer(buf));
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function generate() {
    await fetchCandidate("http://127.0.0.1:8000/generate", {
      key,
      scale,
      bars,
      notes_per_bar: notesPerBar,
      steps,
      tempo,
      population,
      pauses,
    }, { autoplay: true });
  }

  async function submitRating(rating: number) {
    if (!meta) return;

    setLastRating(rating);
    setRatingHistory(prev => [{ candidateId: meta.candidateId, rating, at: new Date().toLocaleTimeString() }, ...prev]);

    await fetchCandidate("http://127.0.0.1:8000/rate", {
      session_id: meta.sessionId,
      candidate_id: meta.candidateId,
      rating,
    }, { autoplay: false });
  }

  async function play() {
    if (!parsed || !parsed.notes.length) {
      setError("MIDI has no notes to play.");
      return;
    }
    setError(null);
    await playNowFromBuffer(midiData!);
  }

  const hasAny = !!meta;
  const progress = durationSec > 0 ? clamp(playheadSec / durationSec, 0, 1) : 0;

  return (
    <main style={page}>
      <div style={shell}>
        <header style={topBar}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={logo}>♪</div>
            <div style={{ display: "grid", gap: 4 }}>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 950, letterSpacing: -0.3, color: "#0f172a" }}>
                Genetic Music Generator
              </h1>
              <div style={{ fontSize: 12, color: "rgba(15,23,42,.65)" }}>
                Generate → Auto-Play → Rate (0–5)
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <span style={pillSoft}>{signature}</span>
            <span style={pillSoft}>
              {meta ? <>cand <b>{shortId(meta.candidateId)}</b>…</> : "no session"}
            </span>
            {lastRating !== null ? (
              <span style={{ ...pillSoft, ...ratingColor(lastRating), fontWeight: 900 }}>
                ⭐ {lastRating}
              </span>
            ) : null}
          </div>
        </header>

        <div style={grid}>
          <section style={panel}>
            <div style={cardTitleRow}>
              <div style={cardTitle}>Controls</div>
              <button onClick={() => setShowAdvanced(v => !v)} style={ghostBtn}>
                {showAdvanced ? "Hide advanced" : "Advanced"}
              </button>
            </div>

            <div style={row2}>
              <Field label="Key" help={HELP.key}>
                <select value={key} onChange={(e) => setKey(e.target.value)} style={control}>
                  {KEYS.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </Field>
              <Field label="Scale" help={HELP.scale}>
                <select value={scale} onChange={(e) => setScale(e.target.value)} style={control}>
                  {SCALES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>

            <div style={row2}>
              <Field label="Bars" help={HELP.bars}>
                <input type="number" min={1} max={64} value={bars} onChange={(e) => setBars(Number(e.target.value))} style={control} />
              </Field>
              <Field label="Notes / bar" help={HELP.npb}>
                <input type="number" min={1} max={16} value={notesPerBar} onChange={(e) => setNotesPerBar(Number(e.target.value))} style={control} />
              </Field>
            </div>

            <div style={row2}>
              <Field label="Tempo (BPM)" help={HELP.tempo}>
                <input type="number" min={40} max={240} value={tempo} onChange={(e) => setTempo(Number(e.target.value))} style={control} />
              </Field>
              <div />
            </div>

            {showAdvanced ? (
              <div style={advancedBox}>
                <div style={row2}>
                  <Field label="Population" help={HELP.population}>
                    <input type="number" min={2} max={200} value={population} onChange={(e) => setPopulation(Number(e.target.value))} style={control} />
                  </Field>
                  <Field label="Steps" help={HELP.steps}>
                    <input type="number" min={1} max={8} value={steps} onChange={(e) => setSteps(Number(e.target.value))} style={control} />
                  </Field>
                </div>

                <label style={checkRow}>
                  <input type="checkbox" checked={pauses} onChange={(e) => setPauses(e.target.checked)} />
                  <span style={{ fontSize: 13, color: "#0f172a", display: "flex", alignItems: "center", gap: 8 }}>
                    Pauses (rests) <HelpDot text={HELP.pauses} />
                  </span>
                </label>
              </div>
            ) : null}

            <div style={playerCard}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontWeight: 900, color: "#0f172a" }}>Player</div>
                <div style={{ fontSize: 12, color: "rgba(15,23,42,.65)" }}>
                  {fmtTime(playheadSec)} / {fmtTime(durationSec)}
                </div>
              </div>

              <div style={progressWrap}>
                <div style={{ ...progressBar, width: `${progress * 100}%` }} />
              </div>

              <input
                type="range"
                min={0}
                max={Math.max(0, durationSec)}
                step={0.01}
                value={clamp(playheadSec, 0, durationSec || 0)}
                onChange={(e) => seek(Number(e.target.value))}
                disabled={!midiData}
                style={slider}
              />

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                <button onClick={generate} disabled={loading} style={btnPrimary}>
                  {loading ? "Generating…" : "Generate (Auto-Play)"}
                </button>
                <button onClick={play} disabled={!midiData || loading || isPlaying} style={btnBlue}>
                  Play
                </button>
                <button onClick={pause} disabled={!isPlaying} style={btnAmber}>
                  Pause
                </button>
                <button onClick={resume} disabled={!isPaused} style={btnGreen}>
                  Resume
                </button>
                <button onClick={() => stop()} disabled={!isPlaying && !isPaused} style={btnRed}>
                  Stop
                </button>
                <button onClick={() => downloadMidi(`${signature}_${key}_${scale}_${tempo}bpm.mid`)} disabled={!midiData} style={btnPurple}>
                  Export MIDI
                </button>
              </div>

              {error ? <div style={errorBox}>{error}</div> : null}
            </div>

            <div style={rateCard}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ fontWeight: 950, color: "#0f172a" }}>Rate (0–5)</div>
                <div style={{ fontSize: 12, color: "rgba(15,23,42,.65)" }}>
                  {hasAny ? "click to evolve" : "generate first"}
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {[0,1,2,3,4,5].map(r => {
                  const c = ratingColor(r);
                  const selected = lastRating === r;
                  return (
                    <button
                      key={r}
                      onClick={() => submitRating(r)}
                      disabled={!meta || loading}
                      style={{
                        ...rateBtn,
                        background: selected ? "linear-gradient(135deg,#0f172a,#334155)" : c.bg,
                        borderColor: selected ? "transparent" : c.border,
                        color: selected ? "white" : c.fg,
                      }}
                    >
                      {r}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <aside style={side}>
            <div style={sideCard}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={sideTitle}>Ratings</div>
                <span style={countPill}>{ratingHistory.length}</span>
              </div>

              <div style={{ marginTop: 10, display: "grid", gap: 10, maxHeight: 520, overflow: "auto" }}>
                {ratingHistory.length === 0 ? (
                  <div style={muted}>No ratings yet.</div>
                ) : ratingHistory.map((e, idx) => {
                  const c = ratingColor(e.rating);
                  return (
                    <div key={`${e.candidateId}-${idx}`} style={histRow}>
                      <div style={{ display: "grid", gap: 2 }}>
                        <div style={{ fontSize: 12, color: "rgba(15,23,42,.60)" }}>{e.at}</div>
                        <div style={{ fontSize: 13, color: "#0f172a" }}>
                          cand <b>{shortId(e.candidateId)}</b>…
                        </div>
                      </div>
                      <div style={{ ...pillSoft, ...c, fontWeight: 950 }}>⭐ {e.rating}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

/* ---------------- styles ---------------- */

const page: React.CSSProperties = {
  minHeight: "100vh",
  background:
    "radial-gradient(900px 520px at 12% 8%, rgba(99,102,241,.22), transparent 55%)," +
    "radial-gradient(900px 520px at 88% 22%, rgba(14,165,233,.22), transparent 55%)," +
    "radial-gradient(900px 620px at 50% 92%, rgba(34,197,94,.18), transparent 55%)," +
    "linear-gradient(180deg,#f8fafc,#ffffff)",
  color: "#0f172a",
  fontFamily: "ui-sans-serif, system-ui",
};

const shell: React.CSSProperties = {
  maxWidth: 1100,
  margin: "0 auto",
  padding: "26px 16px 42px",
};

const topBar: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 16,
  flexWrap: "wrap",
  padding: 16,
  borderRadius: 18,
  background: "linear-gradient(135deg, rgba(255,255,255,.88), rgba(255,255,255,.72))",
  border: "1px solid rgba(15,23,42,.10)",
  boxShadow: "0 22px 60px rgba(15,23,42,.10)",
  backdropFilter: "blur(8px)",
};

const logo: React.CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: 14,
  display: "grid",
  placeItems: "center",
  background: "linear-gradient(135deg,#6366f1,#22c55e,#0ea5e9)",
  color: "white",
  fontWeight: 950,
  boxShadow: "0 16px 35px rgba(99,102,241,.25)",
};

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.25fr .75fr",
  gap: 16,
  marginTop: 16,
};

const panel: React.CSSProperties = {
  padding: 16,
  borderRadius: 18,
  background: "rgba(255,255,255,.88)",
  border: "1px solid rgba(15,23,42,.10)",
  boxShadow: "0 22px 70px rgba(15,23,42,.10)",
};

const side: React.CSSProperties = { display: "grid", gap: 16 };

const sideCard: React.CSSProperties = {
  padding: 14,
  borderRadius: 18,
  background: "rgba(255,255,255,.88)",
  border: "1px solid rgba(15,23,42,.10)",
  boxShadow: "0 18px 55px rgba(15,23,42,.10)",
};

const sideTitle: React.CSSProperties = { fontWeight: 950, fontSize: 14, color: "#0f172a" };

const row2: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 12,
  marginBottom: 12,
};

const control: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 14,
  background: "linear-gradient(180deg,#ffffff,#f8fafc)",
  border: "1px solid rgba(15,23,42,.10)",
  color: "#0f172a",
  outline: "none",
  boxShadow: "0 10px 22px rgba(15,23,42,.05)",
};

const cardTitleRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 10,
};

const cardTitle: React.CSSProperties = { fontWeight: 950, color: "#0f172a", fontSize: 14 };

const ghostBtn: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 14,
  border: "1px solid rgba(15,23,42,.10)",
  background: "rgba(255,255,255,.70)",
  cursor: "pointer",
  fontWeight: 900,
  color: "#0f172a",
};

const advancedBox: React.CSSProperties = {
  padding: 12,
  borderRadius: 16,
  background: "linear-gradient(135deg, rgba(99,102,241,.08), rgba(14,165,233,.08), rgba(34,197,94,.06))",
  border: "1px solid rgba(15,23,42,.10)",
  marginBottom: 12,
};

const checkRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, marginTop: 10 };

const playerCard: React.CSSProperties = {
  padding: 14,
  borderRadius: 18,
  border: "1px solid rgba(15,23,42,.10)",
  background: "linear-gradient(180deg,#ffffff,#f8fafc)",
  boxShadow: "0 18px 45px rgba(15,23,42,.08)",
};

const rateCard: React.CSSProperties = {
  marginTop: 14,
  padding: 14,
  borderRadius: 18,
  border: "1px solid rgba(15,23,42,.10)",
  background: "linear-gradient(135deg, rgba(168,85,247,.06), rgba(59,130,246,.06), rgba(34,197,94,.05), #ffffff)",
  boxShadow: "0 18px 45px rgba(15,23,42,.08)",
};

const progressWrap: React.CSSProperties = {
  height: 10,
  borderRadius: 999,
  background: "rgba(15,23,42,.08)",
  overflow: "hidden",
  marginTop: 10,
};

const progressBar: React.CSSProperties = {
  height: "100%",
  borderRadius: 999,
  background: "linear-gradient(90deg,#6366f1,#0ea5e9,#22c55e,#a855f7)",
  boxShadow: "0 12px 30px rgba(99,102,241,.20)",
};

const slider: React.CSSProperties = { width: "100%", marginTop: 8, accentColor: "#6366f1" };

const pillSoft: React.CSSProperties = {
  padding: "7px 11px",
  borderRadius: 999,
  border: "1px solid rgba(15,23,42,.10)",
  background: "rgba(255,255,255,.70)",
  fontSize: 12,
  fontWeight: 900,
  color: "#0f172a",
};

const countPill: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 999,
  background: "linear-gradient(135deg,#0ea5e9,#6366f1)",
  color: "white",
  fontWeight: 950,
  fontSize: 12,
};

const btnBase: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 14,
  border: "1px solid rgba(15,23,42,.10)",
  fontWeight: 950,
  cursor: "pointer",
  boxShadow: "0 14px 30px rgba(15,23,42,.08)",
};

const btnPrimary: React.CSSProperties = { ...btnBase, border: "1px solid rgba(99,102,241,.25)", background: "linear-gradient(135deg,#6366f1,#0ea5e9)", color: "white" };
const btnBlue: React.CSSProperties = { ...btnBase, background: "linear-gradient(135deg, rgba(59,130,246,.16), rgba(14,165,233,.16))", color: "#0f172a" };
const btnGreen: React.CSSProperties = { ...btnBase, background: "linear-gradient(135deg, rgba(34,197,94,.18), rgba(16,185,129,.14))", color: "#0f172a" };
const btnAmber: React.CSSProperties = { ...btnBase, background: "linear-gradient(135deg, rgba(245,158,11,.18), rgba(249,115,22,.14))", color: "#0f172a" };
const btnRed: React.CSSProperties = { ...btnBase, background: "linear-gradient(135deg, rgba(239,68,68,.18), rgba(244,63,94,.14))", color: "#0f172a" };
const btnPurple: React.CSSProperties = { ...btnBase, background: "linear-gradient(135deg, rgba(168,85,247,.16), rgba(99,102,241,.14))", color: "#0f172a" };

const rateBtn: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 16,
  border: "1px solid rgba(15,23,42,.10)",
  fontWeight: 950,
  cursor: "pointer",
  minWidth: 54,
  boxShadow: "0 14px 30px rgba(15,23,42,.08)",
};

const histRow: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 16,
  border: "1px solid rgba(15,23,42,.10)",
  background: "linear-gradient(180deg,#ffffff,#f8fafc)",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  boxShadow: "0 14px 30px rgba(15,23,42,.06)",
};

const errorBox: React.CSSProperties = {
  marginTop: 10,
  padding: 10,
  borderRadius: 14,
  border: "1px solid rgba(239,68,68,.30)",
  background: "rgba(239,68,68,.10)",
  color: "#991b1b",
  fontSize: 13,
  fontWeight: 800,
};

const muted: React.CSSProperties = { color: "rgba(15,23,42,.60)", fontSize: 13 };

const helpWrap: React.CSSProperties = {
  width: 18,
  height: 18,
  borderRadius: 999,
  display: "grid",
  placeItems: "center",
  fontSize: 12,
  fontWeight: 950,
  color: "#0f172a",
  background: "linear-gradient(135deg, rgba(99,102,241,.18), rgba(14,165,233,.16))",
  border: "1px solid rgba(15,23,42,.10)",
  boxShadow: "0 10px 20px rgba(15,23,42,.06)",
  cursor: "pointer",
  position: "relative",
  userSelect: "none",
};

const tooltip: React.CSSProperties = {
  position: "fixed",
  width: 260,
  zIndex: 9999,
  padding: 12,
  borderRadius: 14,
  background: "rgba(15,23,42,.94)",
  color: "white",
  boxShadow: "0 24px 60px rgba(15,23,42,.28)",
  border: "1px solid rgba(255,255,255,.12)",
};

const tooltipText: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  lineHeight: 1.35,
};

const tooltipHint: React.CSSProperties = {
  marginTop: 8,
  fontSize: 11,
  color: "rgba(255,255,255,.70)",
};
