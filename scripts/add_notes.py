"""Writes the one-line notes for the stretches of a day that are not played as scenes.

    python scripts/add_notes.py        # puts `note` on the episodes the record does not play

The exhibition plays two or three scenes of a day; the rest of the day passes over the map. So a
visitor is not left to guess what happened in between, the first episode of each skipped stretch carries
one sentence of what the record says it was ("09:30~09:40 · ..."). The sentence is the stored facts
(the episode's lines and its Task's panel) said plainly; nothing is added. The screen shows it large over
the map for a few seconds (scene/reel.ts, ObserveScreen). Episodes whose story is told by another line of
the same stretch carry no note.
"""
import json
import sqlite3
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
DB = Path(__file__).resolve().parents[1] / "local-data" / "runs" / "sim.sqlite3"

clock = lambda ms: "%02d:%02d" % divmod(ms // 60000, 60)


def spoken_by(episode):
    return {l["speaker"] for b in episode["beats"] for l in b["lines"] if l["kind"] == "say"}


def note_for(episode, group):
    """The sentence for a skipped episode, or None when another note already tells it."""
    rid, t = episode["requestId"], clock(episode["startMs"])
    if rid == "w1":
        span = clock(group[0]["startMs"]) if len(group) == 1 else "%s~%s" % (clock(group[0]["startMs"]), clock(group[-1]["startMs"]))
        return "%s · 안내 시계로 한상덕 어르신을 불렀지만 응답이 없었습니다" % span
    if rid == "w2":
        if "이웃" in episode["title"]:
            return "%s · 이웃 세 분께 한상덕 어르신 확인을 부탁했지만, 두 분은 자리를 뜰 수 없었고 한 분은 전화를 받지 않았습니다" % t
        return "%s · 이장 남기웅 씨께 한상덕 어르신 집에 가 확인해 달라고 부탁했습니다" % t
    if rid == "t1":
        return "%s · 임태식 어르신이 오늘 08:00 읍내 의원 진료가 있는데 운전을 못 해, 태워 줄 사람을 요청했습니다" % t
    if rid == "t3":
        return "%s · 돌아오는 길은 유병찬 어르신이 의원 앞에서 임태식 어르신을 태워 주기로 했습니다" % t if "P3" in spoken_by(episode) and "MEDial" in spoken_by(episode) else None
    if rid == "a1":
        return "%s · 항구에서 고성재 어르신이 형 고성진에게 아침부터 가슴이 답답하다고 말했습니다" % t
    if rid == "m1":
        return "%s · 조기범 어르신이 허리가 아픈데 먹던 약이 떨어졌고, 식당을 비울 수 없다고 했습니다" % t
    if rid == "m2":
        who = spoken_by(episode)
        if "P12" in who and "P11" in who:
            return "%s · 남대현 어르신이 읍내 약국에서 진통제와 파스를 가져다 드렸습니다" % t
        if "P6" in who and "P11" in who:
            return "%s · 이장 남기웅 씨가 읍내 약국에서 약과 파스를 가져다 드렸습니다" % t
        return None
    if rid == "e1":
        return "%s · 고성재 어르신 집 안내 시계가 이상을 감지했고, 가까이 사는 형 고성진 씨께 가 보라고 요청했습니다" % t
    if rid == "e3":
        return "%s · 구급대가 도착해 고성재 어르신을 인계했고, MEDial이 이장에게 알렸습니다" % t
    return None


def main():
    conn = sqlite3.connect(DB)
    for attempt_id, raw in conn.execute("select id, scenes_json from attempts").fetchall():
        scenes = json.loads(raw)
        played = set(scenes.get("featured") or [])
        eps = scenes["episodes"]
        for e in eps:
            e.pop("noteAfter", None)
            # What a played scene leaves open: the health centre takes the case, and the day never says how it ended.
            if "HC_NURSE" in spoken_by(e) and "%s@%d" % (e["requestId"], e["startMs"] // 60000) in played:
                e["noteAfter"] = "%s · 보건소가 접수했습니다. 한상덕 어르신이 어떻게 됐는지는 이 하루의 기록에 나오지 않습니다" % clock(e["endMs"])
            e.pop("note", None)
            e.pop("noteTitle", None)
        i = 0
        while i < len(eps):
            e = eps[i]
            if "%s@%d" % (e["requestId"], e["startMs"] // 60000) in played:
                i += 1
                continue
            group = [e]
            while e["requestId"] == "w1" and i + len(group) < len(eps) and eps[i + len(group)]["requestId"] == "w1" \
                    and "w1@%d" % (eps[i + len(group)]["startMs"] // 60000) not in played:
                group.append(eps[i + len(group)])
            note = note_for(e, group)
            if note:
                e["note"] = note
                # A later stretch of a request that already has its row (the medicine arriving) gets a row of its own.
                if e["requestId"] == "m2":
                    e["noteTitle"] = "약이 도착했다"
            i += len(group)
        conn.execute("update attempts set scenes_json=? where id=?", (json.dumps(scenes, ensure_ascii=False), attempt_id))
        print(attempt_id, [e["note"][:12] for e in eps if e.get("note")])
    conn.commit()


if __name__ == "__main__":
    main()
