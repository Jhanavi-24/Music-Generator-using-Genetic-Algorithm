import click
from datetime import datetime
import os
import random
from typing import List, Dict, Any, Callable

# music21
from music21 import stream, note, scale as m21scale, instrument, tempo

# GA helpers
from algorithms.genetic import (
    generate_genome,
    Genome,
    selection_pair,
    single_point_crossover,
    mutation,
)

BITS_PER_NOTE = 4
KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
SCALES = ["major", "minor", "dorian", "phrygian", "lydian", "mixolydian", "majorBlues", "minorBlues"]


def int_from_bits(bits: List[int]) -> int:
    """Convert a list of bits to an integer."""
    return int(sum([bit * pow(2, index) for index, bit in enumerate(bits)]))


def _build_scale(key: str, scale_name: str):
    """Return a music21 scale object from (key, scale_name)."""
    key_pitch = note.Note(key).pitch

    if scale_name == "major":
        sc = m21scale.MajorScale(key_pitch)
    elif scale_name == "minor":
        sc = m21scale.MinorScale(key_pitch)
    elif scale_name == "dorian":
        sc = m21scale.DorianScale(key_pitch)
    elif scale_name == "phrygian":
        sc = m21scale.PhrygianScale(key_pitch)
    elif scale_name == "lydian":
        sc = m21scale.LydianScale(key_pitch)
    elif scale_name == "mixolydian":
        sc = m21scale.MixolydianScale(key_pitch)
    elif scale_name == "majorBlues":
        sc = m21scale.ConcreteScale(tonic=key_pitch, intervals=["P1", "M2", "m3", "M3", "P5", "M6"])
    elif scale_name == "minorBlues":
        sc = m21scale.ConcreteScale(tonic=key_pitch, intervals=["P1", "m3", "P4", "d5", "P5", "m7"])
    else:
        sc = m21scale.MajorScale(key_pitch)

    # safety fallback
    if not sc.getPitches():
        sc = m21scale.MajorScale(key_pitch)

    return sc


def genome_to_melody(
    genome: Genome,
    num_bars: int,
    num_notes: int,
    num_steps: int,
    pauses: bool,
    key: str,
    scale_name: str,
    root: int,
) -> Dict[str, list]:
    """
    Convert a genome to a melody representation.
    melody["notes"] becomes a list of steps, each step is a list of midi values (0 = rest).
    """
    chunks = [
        genome[i * BITS_PER_NOTE : i * BITS_PER_NOTE + BITS_PER_NOTE]
        for i in range(num_bars * num_notes)
    ]

    note_length = 4 / float(num_notes)  # quarterLength

    sc = _build_scale(key, scale_name)
    scale_pitches = sc.getPitches()
    if not scale_pitches:
        scale_pitches = m21scale.MajorScale(note.Note(key).pitch).getPitches()

    melody = {"notes": [], "velocity": [], "beat": []}

    for note_bits in chunks:
        integer = int_from_bits(note_bits)

        if not pauses:
            integer = int(integer % pow(2, BITS_PER_NOTE - 1))

        # rest if highest bit set
        if integer >= pow(2, BITS_PER_NOTE - 1):
            melody["notes"].append(0)
            melody["velocity"].append(0)
            melody["beat"].append(note_length)
        else:
            # extend same note
            if len(melody["notes"]) > 0 and melody["notes"][-1] == integer:
                melody["beat"][-1] += note_length
            else:
                melody["notes"].append(integer)
                melody["velocity"].append(127)
                melody["beat"].append(note_length)

    steps = []
    for step in range(num_steps):
        step_notes = []
        for v in melody["notes"]:
            if v == 0:
                step_notes.append(0)
            else:
                idx = (v + step * 2) % len(scale_pitches)
                step_notes.append(scale_pitches[idx].midi)
        steps.append(step_notes)

    melody["notes"] = steps
    return melody


def genome_to_stream(
    genome: Genome,
    num_bars: int,
    num_notes: int,
    num_steps: int,
    pauses: bool,
    key: str,
    scale_name: str,
    root: int,
    bpm: int,
) -> List[stream.Stream]:
    """Convert genome to music21 stream objects (one per step)."""
    melody = genome_to_melody(genome, num_bars, num_notes, num_steps, pauses, key, scale_name, root)

    streams: List[stream.Stream] = []

    for step_notes in melody["notes"]:
        s = stream.Stream()
        s.append(tempo.MetronomeMark(number=bpm))
        s.append(instrument.Piano())

        current_offset = 0.0
        for i, midi_val in enumerate(step_notes):
            dur = melody["beat"][i]
            if midi_val == 0:
                n = note.Rest()
                n.quarterLength = dur
            else:
                n = note.Note(midi_val)
                n.volume.velocity = melody["velocity"][i]
                n.quarterLength = dur

            s.insert(current_offset, n)
            current_offset += dur

        streams.append(s)

    return streams


def save_genome_to_midi(
    filename: str,
    genome: Genome,
    num_bars: int,
    num_notes: int,
    num_steps: int,
    pauses: bool,
    key: str,
    scale_name: str,
    root: int,
    bpm: int,
):
    """
    Save genome as MIDI.
    If num_steps > 1:
      - step0 saved to `filename`
      - step1.. saved to `<base>_step{i}.mid`
    """
    streams = genome_to_stream(genome, num_bars, num_notes, num_steps, pauses, key, scale_name, root, bpm)

    parent = os.path.dirname(filename)
    if parent:
        os.makedirs(parent, exist_ok=True)

    base, ext = os.path.splitext(filename)
    if ext.lower() != ".mid":
        ext = ".mid"

    for i, s in enumerate(streams):
        if i == 0:
            out = base + ext
        else:
            out = f"{base}_step{i}{ext}"
        s.write("midi", fp=out)


# =========================================================
# Interactive CLI fitness (kept for your original workflow)
# =========================================================
def fitness(
    genome: Genome,
    num_bars: int,
    num_notes: int,
    num_steps: int,
    pauses: bool,
    key: str,
    scale_name: str,
    root: int,
    bpm: int,
) -> int:
    streams = genome_to_stream(genome, num_bars, num_notes, num_steps, pauses, key, scale_name, root, bpm)

    try:
        streams[0].show("midi")
        rating = input("Rating (0-5): ")
        try:
            rating = int(rating)
        except ValueError:
            rating = 0
        return max(0, min(5, rating))
    except Exception as e:
        print(f"Error playing MIDI: {e}")
        return 0


@click.command()
@click.option("--num-bars", default=8, prompt="Number of bars:", type=int)
@click.option("--num-notes", default=4, prompt="Notes per bar:", type=int)
@click.option("--num-steps", default=1, prompt="Number of steps:", type=int)
@click.option("--pauses", default=True, prompt="Introduce Pauses?", type=bool)
@click.option("--key", default="C", prompt="Key:", type=click.Choice(KEYS, case_sensitive=False))
@click.option("--scale", default="major", prompt="Scale:", type=click.Choice(SCALES, case_sensitive=False))
@click.option("--root", default=4, prompt="Scale Root:", type=int)
@click.option("--population-size", default=10, prompt="Population size:", type=int)
@click.option("--num-mutations", default=2, prompt="Number of mutations:", type=int)
@click.option("--mutation-probability", default=0.5, prompt="Mutations probability:", type=float)
@click.option("--bpm", default=128, type=int)
def main(
    num_bars: int,
    num_notes: int,
    num_steps: int,
    pauses: bool,
    key: str,
    scale: str,
    root: int,
    population_size: int,
    num_mutations: int,
    mutation_probability: float,
    bpm: int,
):
    """Original interactive GA loop (CLI)."""
    folder = str(int(datetime.now().timestamp()))
    genome_length = num_bars * num_notes * BITS_PER_NOTE
    population = [generate_genome(genome_length) for _ in range(population_size)]
    population_id = 0

    running = True
    while running:
        random.shuffle(population)

        pop_fit = [
            (g, fitness(g, num_bars, num_notes, num_steps, pauses, key, scale, root, bpm))
            for g in population
        ]
        pop_fit_sorted = sorted(pop_fit, key=lambda x: x[1], reverse=True)
        population = [x[0] for x in pop_fit_sorted]

        # fitness lookup required by selection_pair
        def fitness_lookup(genome: Genome) -> int:
            for g, f in pop_fit:
                if g == genome:
                    return f
            return 0

        next_generation = population[0:2]  # elite

        for _ in range(int(len(population) / 2) - 1):
            parents = selection_pair(population, fitness_lookup)
            a, b = single_point_crossover(parents[0], parents[1])
            a = mutation(a, num=num_mutations, probability=mutation_probability)
            b = mutation(b, num=num_mutations, probability=mutation_probability)
            next_generation += [a, b]

        print(f"Population {population_id} done")

        print("Saving population MIDI files...")
        os.makedirs(f"{folder}/{population_id}", exist_ok=True)
        for i, g in enumerate(population):
            save_genome_to_midi(
                f"{folder}/{population_id}/{scale}-{key}-{i}.mid",
                g,
                num_bars,
                num_notes,
                num_steps,
                pauses,
                key,
                scale,
                root,
                bpm,
            )
        print("Done")

        running = input("Continue? [Y/n] ") != "n"
        population = next_generation
        population_id += 1


# =========================================================
# Backend / frontend (non-blocking) interactive session API
# =========================================================
def init_session_state(
    num_bars: int,
    num_notes: int,
    pauses: bool,
    key: str,
    scale: str,
    bpm: int,
    population_size: int,
    num_mutations: int,
    mutation_prob: float,
) -> Dict[str, Any]:
    genome_length = num_bars * num_notes * BITS_PER_NOTE
    population = [generate_genome(genome_length) for _ in range(population_size)]
    return {
        "num_bars": num_bars,
        "num_notes": num_notes,
        "pauses": pauses,
        "key": key,
        "scale": scale,
        "bpm": bpm,
        "population_size": population_size,
        "num_mutations": num_mutations,
        "mutation_prob": mutation_prob,
        "population": population,
        "ratings": [],            # list of (genome, rating)
        "last_genome": None,
        "last_candidate_id": None,
        "generation": 0,
    }


def _fitness_lookup_from_ratings(state: Dict[str, Any]) -> Callable[[Genome], int]:
    """
    selection_pair requires fitness_func(genome) -> int.
    We'll use ratings gathered so far; unrated genomes get 0.
    """
    def fitness_func(genome: Genome) -> int:
        # look for exact match genome object equality
        for g, r in state["ratings"]:
            if g == genome:
                return int(r)
        return 0
    return fitness_func


def generate_next_candidate(state: Dict[str, Any], out_path: str, steps: int = 1) -> str:
    """
    Produce ONE candidate genome based on current population and existing ratings.
    Save MIDI to out_path and return candidate_id.
    """
    state["generation"] += 1

    fitness_func = _fitness_lookup_from_ratings(state)

    # pick parents with current ratings (or random if no ratings yet)
    try:
        parents = selection_pair(state["population"], fitness_func)
    except TypeError:
        # if their selection_pair signature differs, fallback to random
        parents = random.sample(state["population"], 2)

    try:
        child_a, child_b = single_point_crossover(parents[0], parents[1])
        child = child_a if random.random() < 0.5 else child_b
    except TypeError:
        # if single_point_crossover returns one genome in their version
        child = single_point_crossover(parents[0], parents[1])

    child = mutation(child, num=state["num_mutations"], probability=state["mutation_prob"])

    # (optional) keep child inside population by replacing worst/random
    replace_idx = random.randrange(len(state["population"]))
    state["population"][replace_idx] = child

    state["last_genome"] = child

    candidate_id = f"g{state['generation']}_{random.randint(100000, 999999)}"
    state["last_candidate_id"] = candidate_id

    save_genome_to_midi(
        out_path,
        child,
        num_bars=state["num_bars"],
        num_notes=state["num_notes"],
        num_steps=steps,
        pauses=state["pauses"],
        key=state["key"],
        scale_name=state["scale"],
        root=0,
        bpm=state["bpm"],
    )

    return candidate_id


def submit_rating(state: Dict[str, Any], candidate_id: str, rating: int):
    """
    Save rating for the last candidate genome.
    """
    rating = int(max(0, min(5, rating)))
    if state["last_genome"] is None:
        return

    # attach rating to the last genome (simple but effective)
    state["ratings"].append((state["last_genome"], rating))

    # If rating is high, also "elite-keep" it in population
    if rating >= 4:
        idx = random.randrange(len(state["population"]))
        state["population"][idx] = state["last_genome"]


# =========================================================
# Simple one-shot generator (no rating) for backend use
# =========================================================
def generate_midi_file(
    out_path: str,
    num_bars: int,
    num_notes: int,
    num_steps: int,
    pauses: bool,
    key: str,
    scale: str,
    root: int,
    bpm: int,
    population_size: int,
    num_mutations: int,
    mutation_prob: float,
):
    """
    Non-interactive: generate one MIDI file quickly.
    (Used if you want a single click generate without rating loop.)
    """
    state = init_session_state(
        num_bars=num_bars,
        num_notes=num_notes,
        pauses=pauses,
        key=key,
        scale=scale,
        bpm=bpm,
        population_size=population_size,
        num_mutations=num_mutations,
        mutation_prob=mutation_prob,
    )
    generate_next_candidate(state, out_path=out_path, steps=num_steps)


if __name__ == "__main__":
    main()
