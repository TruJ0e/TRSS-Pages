"""Pre-record natural voice audio for every card term and meaning.

Games play these files instead of the browser's robotic voice. Two voices:
woman (Ava) and man (Andrew). Files are named by a hash of the exact text,
so edited cards are re-recorded and unchanged ones are reused.

usage: python make_audio.py <site_root>     (site_root = TRSS-Pages checkout)
needs: pip install edge-tts
"""
import asyncio, hashlib, json, os, re, sys

import edge_tts

VOICES = {"woman": "en-US-AvaNeural", "man": "en-US-AndrewNeural"}
EXTRA_PHRASES = ["means", "Nice work!", "Let's learn this one", "True", "False"]

root = sys.argv[1] if len(sys.argv) > 1 else "."
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "audio")


def key(text):
    return hashlib.sha1(text.strip().encode("utf8")).hexdigest()[:12]


def field(obj_src, name):
    m = re.search(name + r'\s*:\s*"((?:[^"\\]|\\.)*)"', obj_src)
    return json.loads('"' + m.group(1) + '"') if m else ""


import subprocess
here = os.path.dirname(os.path.abspath(__file__))
texts = set(EXTRA_PHRASES) | set(json.loads(subprocess.check_output(["node", os.path.join(here, "extract_texts.js"), root])))


async def render(sem, voice_id, text, path):
    async with sem:
        for attempt in range(4):
            try:
                await edge_tts.Communicate(text, voice_id, rate="+5%").save(path)
                return
            except Exception as e:  # network hiccup: back off and retry
                await asyncio.sleep(1.5 * (attempt + 1))
        print("FAILED", voice_id, text[:40])


async def main():
    sem = asyncio.Semaphore(8)
    jobs = []
    for vname, vid in VOICES.items():
        os.makedirs(os.path.join(out, vname), exist_ok=True)
        for t in texts:
            path = os.path.join(out, vname, key(t) + ".mp3")
            if not os.path.exists(path) or os.path.getsize(path) == 0:
                jobs.append(render(sem, vid, t, path))
    print(f"{len(texts)} texts, {len(jobs)} files to record")
    await asyncio.gather(*jobs)
    manifest = {"voices": list(VOICES), "texts": {t: key(t) for t in sorted(texts)}}
    with open(os.path.join(out, "manifest.json"), "w", encoding="utf8") as f:
        json.dump(manifest, f, ensure_ascii=False, separators=(",", ":"))
    print("manifest written:", len(texts))


asyncio.run(main())
