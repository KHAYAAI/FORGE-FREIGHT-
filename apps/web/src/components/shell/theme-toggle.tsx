"use client";

import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const stored = window.localStorage.getItem("ff-theme");
    const initial = stored === "light" || stored === "dark" ? stored : "dark";
    // Reading localStorage is impossible during the server render, so the
    // client must sync this state once on mount — the canonical exception
    // to "don't setState in an effect."
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(initial);
    document.documentElement.setAttribute("data-theme", initial);
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    window.localStorage.setItem("ff-theme", next);
  }

  return (
    <button
      onClick={toggle}
      className="flex h-7 items-center gap-1.5 rounded-sm border border-strong bg-raised px-2.5 text-[11px] font-medium text-secondary hover:text-primary"
      aria-label="Toggle theme"
    >
      {theme === "dark" ? "Dark" : "Light"}
    </button>
  );
}
