def measure_grid(duration, bpm, beats=(), numerator=4):
    """Estimated bar grid; beat positions retain local tempo variation."""
    boundaries = [0.0]
    if len(beats) >= numerator * 2:
        for value in beats[numerator::numerator]:
            if boundaries[-1] + 0.05 < value < duration - 0.05:
                boundaries.append(float(value))
    else:
        step = numerator * 60 / (bpm if bpm and 20 <= bpm <= 300 else 120)
        cursor = step
        while cursor < duration - 0.05:
            boundaries.append(cursor); cursor += step
    if duration > 0:
        boundaries.append(float(duration))
    return {"estimated": True, "beats": [round(float(n), 4) for n in beats],
            "measures": [{"index": i, "start": round(start, 4), "end": round(boundaries[i+1], 4),
                          "numerator": numerator, "denominator": 4} for i, start in enumerate(boundaries[:-1])]}


def merge_chunk_notes(events):
    merged = []
    for note in sorted(events, key=lambda n: (n["pitch"], n["start"])):
        if merged and merged[-1]["pitch"] == note["pitch"] and merged[-1].get("chunk") != note.get("chunk") and note["start"] <= merged[-1]["end"] + 0.025:
            merged[-1]["end"] = max(merged[-1]["end"], note["end"])
        else:
            merged.append(dict(note))
    for note in merged:
        note.pop("chunk", None)
    return sorted(merged, key=lambda n: (n["start"], n["pitch"]))
