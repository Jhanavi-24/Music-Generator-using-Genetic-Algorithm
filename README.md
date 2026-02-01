# 🎶 Can AI Make Music?
## 🎼 Music Generator Using Genetic Algorithm

> **Short answer:** Yes — and it can *evolve* based on your taste.

This project demonstrates how **Artificial Intelligence can generate music** using a **Genetic Algorithm (GA)**.  
Instead of learning from large datasets, the system **evolves melodies over generations**, guided by **human feedback**.

Users listen to generated music, rate it, and the algorithm improves future melodies using principles inspired by **natural selection**.

---

## ✨ Features

- 🎵 AI-generated melodies using **Genetic Algorithms**
- 🧬 **User-driven evolution** (rate melodies from 0–5)
- 🎹 **Real-time playback** in the browser
- 🔁 **Auto-play after generation**
- 📤 **Export melodies as MIDI files**
- 🎨 Interactive **Next.js UI**
- ⚡ **FastAPI backend**
- 🎼 Musical constraints: key, scale, tempo, bars

---
## 🎥 Demo

<img width="1512" height="949" alt="image" src="https://github.com/user-attachments/assets/e435bb08-9258-477b-8164-a90d78621443" />


Run the project locally and open:
- Frontend: http://localhost:3000  
- Backend: http://127.0.0.1:8000

---

## 🧠 How It Works

This project uses a **Genetic Algorithm (GA)** to generate short musical sequences that evolve over time based on user feedback.

1. **Initialization**  
   A population of random musical candidates is generated.  
   Each candidate is a sequence of notes constrained by:
   - Key
   - Scale
   - Tempo
   - Bars and notes per bar

2. **Playback & Evaluation**  
   Generated melodies are played in the browser using **Tone.js**.

3. **User Rating (Fitness Function)**  
   The user rates each melody (0–5).  
   Higher-rated melodies are treated as fitter individuals.

4. **Selection, Crossover & Mutation**  
   - High-fitness melodies are selected
   - Notes are recombined (crossover)
   - Random mutations introduce variation

5. **Evolution**  
   The process repeats, gradually producing more musically pleasing results.🎶

---

## 🧩 Tech Stack

### Backend
- Python
- FastAPI
- Genetic Algorithms
- music21 / MIDI processing

### Frontend
- Next.js (App Router)
- TypeScript
- Tone.js
- @tonejs/midi
- Modern responsive UI

---

## 📁 Project Structure

```bash
Music-Generator-using-Genetic-Algorithm/
│
├── algorithms/              # Genetic algorithm logic
├── backend/                 # FastAPI server
│   ├── main.py              # API entry point
│   └── requirements.txt
│
├── frontend/                # Next.js frontend
│   ├── app/
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── public/
│   ├── package.json
│   └── README.md
│
├── mgen.py                  # Music generation logic
├── cleanup_older_pyo_versions.py
├── LICENSE
└── README.md
```
---

## 🚀 Getting Started

### Prerequisites

- Python **3.9+**
- Node.js **18+**
- npm or yarn

---

### Backend Setup (FastAPI)

```bash
cd backend
python -m venv venv
source venv/bin/activate   # macOS/Linux
# venv\Scripts\activate    # Windows

pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
---

### Frontend Setup (Next.js)

```bash
cd frontend
npm install
npm run dev
```
---

## 🔮 Future Improvements

- Multi-instrument support
- Rhythm-aware fitness scoring
- Model-based fitness prediction
- Save & reload evolution sessions
- Cloud deployment (Vercel + FastAPI)
---

## 📜 License

This project is licensed under the MIT License.

---

## 🙌 Acknowledgements

- Tone.js
- music21
- Genetic Algorithm research literature

