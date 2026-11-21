"use client";
// Home: the landing page first, then the app.
// "Start talking" adds #app to the address, so a reload goes straight to the app and the
// browser's Back button returns to the landing page. Coming back from Google sign-in
// (?gmail=... or ?auth=...) also skips the landing page.
import { useEffect, useState } from "react";
import CofounderApp from "@/components/CofounderApp";
import LandingPage from "@/components/LandingPage";

export default function Home() {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const sync = () =>
      setEntered(
        window.location.hash === "#app" ||
          // back from Gmail connect, or from sign-in (Google / email link → ?auth=callback)
          ["gmail", "auth"].some((k) => new URLSearchParams(window.location.search).has(k))
      );
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  function enter() {
    window.history.pushState(null, "", `${window.location.pathname}${window.location.search}#app`);
    setEntered(true);
  }

  return entered ? <CofounderApp /> : <LandingPage onEnter={enter} />;
}
