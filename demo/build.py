#!/usr/bin/env python3
"""Assemble the investor demo into one self-contained file.

Fonts and map geometry are inlined at build time rather than fetched: the
published page runs under a strict content-security policy that blocks every
external host, so a CDN font or a remote GeoJSON would not load at all — and
would fail silently, leaving someone else's system font on the screen.

Paths resolve relative to this file, so it runs from anywhere.
"""
import pathlib

here = pathlib.Path(__file__).resolve().parent
out = pathlib.Path.cwd() / "forge-freight-investor-demo.html"

p1 = (here / "part1.html").read_text()
p2 = (here / "part2.html").read_text()
p3 = (here / "part3.html").read_text()

p1 = p1.replace("/* ===== FONTS_PLACEHOLDER ===== */", (here / "fonts.css").read_text())
p3 = p3.replace("/* ===== ASSETS_PLACEHOLDER ===== */", (here / "assets.js").read_text())

out.write_text(p1 + p2 + p3)
print(f"{out} — {out.stat().st_size / 1024:.0f} KB")
