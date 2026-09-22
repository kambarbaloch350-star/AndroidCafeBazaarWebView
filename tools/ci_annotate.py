#!/usr/bin/env python3
"""Turn a Gradle/Kotlin build log into GitHub *annotations*.

Why this exists
---------------
Downloading a job log from the CLI is not always possible (proxy restrictions,
expired presigned URLs, …) while the **annotations** of a check run are always
available through the REST API. This script extracts the interesting lines of a
build log and re-emits them as `::error file=…,line=…::message`, so a failing
build tells you *what* broke in the GitHub UI – and through
`GET /repos/{owner}/{repo}/commits/{ref}/check-runs` – without the raw log.

Usage
-----
    ./gradlew testDebugUnitTest 2>&1 | tee build.log
    python3 tools/ci_annotate.py build.log

Exits 0 even when problems were found (the failing step already fails the job),
and silently ignores log files that contain no diagnostics.
"""
from __future__ import annotations

import os
import re
import sys

# `e: file:///home/runner/work/repo/repo/app/src/main/java/x/Y.kt:117:40 Unresolved reference: safe`
KOTLIN_ERROR = re.compile(
    r"^e: file://[^ ]*?/(?P<path>[^:]+):(?P<line>\d+):(?P<col>\d+) (?P<msg>.*)$"
)
# `..:123: error: unresolved reference: safe`  (kotlinc / javac style)
PLAIN_ERROR = re.compile(
    r"^(?P<path>[\w./-]+\.(?:kt|java|xml)):(?P<line>\d+): (?P<kind>error|warning): (?P<msg>.*)$"
)
GRADLE_TASK_FAILURE = re.compile(r"^> Task (?P<task>[\w:]+) FAILED$")
WHAT_WENT_WRONG = re.compile(r"^\* What went wrong:$")
TEST_FAILED = re.compile(r"^(?P<path>\S+\.\w+) > (?P<test>.+) FAILED$")

MAX_ANNOTATIONS = 12
MAX_MESSAGE = 300


def _clip(text: str, limit: int = MAX_MESSAGE) -> str:
    text = text.replace("\r", " ").strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _escape_property(value: str) -> str:
    """Escape the characters GitHub treats as separators inside properties."""
    return value.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A").replace(",", "%2C")


def _escape_data(value: str) -> str:
    return value.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def annotations(log_text: str):
    """Yield GitHub workflow command strings for the diagnostics in `log_text`."""
    emitted = 0
    follow_up = False

    for raw in log_text.splitlines():
        if emitted >= MAX_ANNOTATIONS:
            break
        line = raw.rstrip()

        match = KOTLIN_ERROR.match(line) or PLAIN_ERROR.match(line)
        if match:
            kind = match.groupdict().get("kind") or "error"
            command = "warning" if kind == "warning" else "error"
            props = "file=%s,line=%s" % (
                _escape_property(match.group("path")),
                match.group("line"),
            )
            if "col" in match.groupdict():
                props += ",col=%s" % match.group("col")
            yield "::%s %s::%s" % (command, props, _escape_data(_clip(match.group("msg"))))
            emitted += 1
            continue

        if GRADLE_TASK_FAILURE.match(line):
            yield "::error::%s" % _escape_data(_clip(line))
            emitted += 1
            follow_up = True
            continue

        if WHAT_WENT_WRONG.match(line):
            follow_up = True
            continue

        if follow_up and line.startswith(("> ", "Caused by:", "Execution failed")):
            yield "::error::%s" % _escape_data(_clip(line))
            emitted += 1
            follow_up = False
            continue

        if TEST_FAILED.match(line):
            yield "::error::%s" % _escape_data(_clip(line))
            emitted += 1

    if emitted >= MAX_ANNOTATIONS:
        yield "::warning::build log truncated – showing the first %d diagnostics" % MAX_ANNOTATIONS


def main(argv: list[str]) -> int:
    paths = [a for a in argv[1:] if not a.startswith("-")] or ["build.log"]
    text = ""
    for path in paths:
        if os.path.isfile(path):
            with open(path, "r", errors="replace") as handle:
                text += handle.read() + "\n"
    if not text.strip():
        print("ci_annotate: no log content to inspect", file=sys.stderr)
        return 0
    for command in annotations(text):
        print(command)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
