"""Tolerant parser for the JavaScript object/array literals in the source simulator HTML.

The source files are research artefacts, not JSON: they use unquoted keys, // and
/* */ comments, trailing commas and single quotes.  We parse them with an explicit
recursive-descent reader instead of regex-to-JSON rewriting so that the result is
deterministic and a malformed input fails loudly rather than silently truncating.
"""
from __future__ import annotations

from typing import Any

_WS = " \t\r\n"
_ID_START = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$")
_ID_REST = _ID_START | set("0123456789")

_ESCAPES = {
    "n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f",
    "\\": "\\", "/": "/", "'": "'", '"': '"',
}


class JsParseError(ValueError):
    pass


class _Reader:
    def __init__(self, text: str, pos: int = 0) -> None:
        self.s = text
        self.i = pos

    # -- low level -------------------------------------------------------
    def error(self, msg: str) -> JsParseError:
        near = self.s[max(0, self.i - 40) : self.i + 40].replace("\n", " ")
        return JsParseError(f"{msg} at offset {self.i}: ...{near}...")

    def skip(self) -> None:
        while self.i < len(self.s):
            c = self.s[self.i]
            if c in _WS:
                self.i += 1
            elif self.s.startswith("//", self.i):
                nl = self.s.find("\n", self.i)
                self.i = len(self.s) if nl < 0 else nl + 1
            elif self.s.startswith("/*", self.i):
                end = self.s.find("*/", self.i + 2)
                if end < 0:
                    raise self.error("unterminated block comment")
                self.i = end + 2
            else:
                return

    def peek(self) -> str:
        self.skip()
        if self.i >= len(self.s):
            raise self.error("unexpected end of input")
        return self.s[self.i]

    def take(self, ch: str) -> None:
        if self.peek() != ch:
            raise self.error(f"expected {ch!r}")
        self.i += 1

    # -- values ----------------------------------------------------------
    def value(self) -> Any:
        c = self.peek()
        if c == "{":
            return self.obj()
        if c == "[":
            return self.arr()
        if c in "\"'":
            return self.string()
        if c == "-" or c.isdigit():
            return self.number()
        for word, val in (("true", True), ("false", False), ("null", None)):
            if self.s.startswith(word, self.i):
                self.i += len(word)
                return val
        raise self.error("unexpected token")

    def obj(self) -> dict:
        self.take("{")
        out: dict = {}
        while True:
            if self.peek() == "}":
                self.i += 1
                return out
            key = self.key()
            self.take(":")
            out[key] = self.value()
            if self.peek() == ",":
                self.i += 1
            elif self.peek() != "}":
                raise self.error("expected , or }")

    def arr(self) -> list:
        self.take("[")
        out: list = []
        while True:
            if self.peek() == "]":
                self.i += 1
                return out
            out.append(self.value())
            if self.peek() == ",":
                self.i += 1
            elif self.peek() != "]":
                raise self.error("expected , or ]")

    def key(self) -> str:
        c = self.peek()
        if c in "\"'":
            return self.string()
        if c not in _ID_START:
            raise self.error("bad object key")
        start = self.i
        while self.i < len(self.s) and self.s[self.i] in _ID_REST:
            self.i += 1
        return self.s[start : self.i]

    def string(self) -> str:
        quote = self.s[self.i]
        self.i += 1
        out: list[str] = []
        while True:
            if self.i >= len(self.s):
                raise self.error("unterminated string")
            c = self.s[self.i]
            if c == "\\":
                nxt = self.s[self.i + 1]
                if nxt == "u":
                    out.append(chr(int(self.s[self.i + 2 : self.i + 6], 16)))
                    self.i += 6
                    continue
                if nxt not in _ESCAPES:
                    raise self.error(f"unsupported escape sequence for {nxt!r}")
                out.append(_ESCAPES[nxt])
                self.i += 2
                continue
            if c == quote:
                self.i += 1
                return "".join(out)
            out.append(c)
            self.i += 1

    def number(self) -> float | int:
        start = self.i
        if self.s[self.i] == "-":
            self.i += 1
        while self.i < len(self.s) and self.s[self.i] in "0123456789.eE+-":
            # stop at a '+'/'-' that is not part of an exponent
            if self.s[self.i] in "+-" and self.s[self.i - 1] not in "eE":
                break
            self.i += 1
        raw = self.s[start : self.i]
        if any(ch in raw for ch in ".eE"):
            return float(raw)
        return int(raw)


def parse_declaration(text: str, name: str) -> Any:
    """Parse `const <name> = <literal>` out of a JS source blob.

    The name must be followed by a non-identifier character, so that looking up
    ``P`` does not accidentally bind to ``PATROL``.
    """
    needle = "const " + name
    cursor = 0
    while True:
        idx = text.find(needle, cursor)
        if idx < 0:
            raise JsParseError("declaration " + repr(name) + " not found")
        after = idx + len(needle)
        tail = text[after:]
        if tail[:1] not in _ID_REST:
            stripped = tail.lstrip(_WS)
            if stripped.startswith("="):
                eq = after + (len(tail) - len(stripped))
                return _Reader(text, eq + 1).value()
        cursor = idx + 1
