"""Playable string assignment for estimated note events; no technique inference."""
from itertools import groupby

def assign_strings(notes, instrument="guitar"):
    tuning = [43, 38, 33, 28] if instrument == "bass" else [64, 59, 55, 50, 45, 40]
    # Process simultaneous notes together, reserving each physical string once.
    ordered = sorted(notes, key=lambda n: (round(n["start"] / 0.04), -n.get("pitch", n.get("midi", 0))))
    position, occupied = 4.0, {}
    for _, group in groupby(ordered, key=lambda n: round(n["start"] / 0.04)):
        for note in group:
            pitch = note.get("pitch", note.get("midi", 0))
            candidates = [(index + 1, pitch - open_note)
                          for index, open_note in enumerate(tuning)
                          if 0 <= pitch - open_note <= 24 and occupied.get(index + 1, 0) <= note["start"] + 0.035]
            if not candidates:
                continue  # Retain pitch without inventing an impossible fret.
            string, fret = min(candidates, key=lambda p: abs(p[1] - position) + 0.08 * p[1] - (0.5 if p[1] == 0 else 0))
            note.update(string=string, fret=fret)
            occupied[string] = note["end"]
            if fret:
                position = position * 0.65 + fret * 0.35
    return notes
