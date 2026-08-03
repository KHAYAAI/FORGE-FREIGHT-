#!/usr/bin/env python3
"""Assemble the console into one self-contained file.

Fonts are inlined as data URIs: the published page runs under a strict
content-security policy that blocks every external host, so a linked webfont
would fail silently and leave somebody else's system font on the screen.

Paths resolve relative to this file, so it runs from anywhere.
"""
import pathlib

here = pathlib.Path(__file__).resolve().parent
out = pathlib.Path.cwd() / "forge-freight-console.html"

read = lambda n: (here / n).read_text()

html = [
    "<title>FORGE Freight OS — Console</title>\n\n<style>\n",
    read("../demo/fonts.css"),
    read("_tokens.css"),
    read("shell.css"),
    read("_primitives.css"),
    "\n</style>\n\n",
    read("skeleton.html"),
    "\n<script>\n",
    *[read(f) + "\n" for f in ("domain.js", "store.js", "actions.js", "ui.js",
                              "screens.js", "screens2.js", "boot.js")],
    "</script>\n",
]

out.write_text("".join(html))
print(f"{out} — {out.stat().st_size / 1024:.0f} KB")
