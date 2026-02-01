from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import tempfile, os, time, uuid
from pathlib import Path
import sys
import traceback


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import mgen

app = FastAPI()

# ✅ IMPORTANT: expose custom headers so frontend can read session/candidate IDs
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Session-Id", "X-Candidate-Id"],
)

# --- In-memory session store (fine for local dev) ---
SESSIONS = {}  # session_id -> dict(state)

class GenerateRequest(BaseModel):
    key: str = "C"
    scale: str = "major"
    bars: int = 8
    notes_per_bar: int = 4
    steps: int = 1
    tempo: int = 120
    generations: int = 50  # UI-only for now
    population: int = 60
    pauses: bool = True

class RateRequest(BaseModel):
    session_id: str
    candidate_id: str
    rating: int  # 0..5


@app.get("/")
def health():
    return {"ok": True, "message": "Music GA backend running"}


@app.post("/generate")
def generate(req: GenerateRequest):
    """
    Generates ONE candidate MIDI for a NEW session.
    Returns the MIDI file directly, with headers containing session_id + candidate_id.
    """
    try:
        session_id = str(uuid.uuid4())
        out_dir = tempfile.mkdtemp(prefix="musicga_")
        ts = int(time.time())
        out_path = os.path.join(out_dir, f"cand_{ts}.mid")

        # Create a new GA session state
        state = mgen.init_session_state(
            num_bars=req.bars,
            num_notes=req.notes_per_bar,
            pauses=req.pauses,
            key=req.key,
            scale=req.scale,
            bpm=req.tempo,
            population_size=req.population,
            num_mutations=2,
            mutation_prob=0.5,
        )

        # Generate first candidate
        candidate_id = mgen.generate_next_candidate(state, out_path=out_path, steps=req.steps)

        SESSIONS[session_id] = {
            "state": state,
            "last_candidate_id": candidate_id,
            "out_dir": out_dir,
            "params": req.model_dump(),
        }

        resp = FileResponse(out_path, media_type="audio/midi", filename="generated.mid")
        resp.headers["X-Session-Id"] = session_id
        resp.headers["X-Candidate-Id"] = candidate_id
        return resp

    except Exception as e:
        # dev-friendly error; you can remove traceback later
        tb = traceback.format_exc()
        raise HTTPException(status_code=500, detail=f"{e}\n\n{tb}")


@app.post("/rate")
def rate(req: RateRequest):
    """
    Submit a rating for the current candidate, then returns NEXT candidate MIDI.
    """
    try:
        if req.session_id not in SESSIONS:
            raise HTTPException(status_code=404, detail="Unknown session_id")

        if not (0 <= req.rating <= 5):
            raise HTTPException(status_code=400, detail="rating must be 0..5")

        sess = SESSIONS[req.session_id]
        state = sess["state"]
        params = sess["params"]

        # Store rating + evolve state internally
        mgen.submit_rating(state, candidate_id=req.candidate_id, rating=req.rating)

        # Generate next candidate
        out_dir = sess["out_dir"]
        ts = int(time.time())
        out_path = os.path.join(out_dir, f"cand_{ts}.mid")

        candidate_id = mgen.generate_next_candidate(
            state,
            out_path=out_path,
            steps=params["steps"],
        )

        sess["last_candidate_id"] = candidate_id

        resp = FileResponse(out_path, media_type="audio/midi", filename="generated.mid")
        resp.headers["X-Session-Id"] = req.session_id
        resp.headers["X-Candidate-Id"] = candidate_id
        return resp

    except HTTPException:
        raise
    except Exception as e:
        tb = traceback.format_exc()
        raise HTTPException(status_code=500, detail=f"{e}\n\n{tb}")
