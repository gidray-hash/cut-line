"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { registerDeskWorker } from "@/lib/desk-api"

type InstallPrompt = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

function installedNow() {
  const ios = "standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  return ios || window.matchMedia("(display-mode: standalone)").matches
}

function subscribeInstalled(onChange: () => void) {
  const media = window.matchMedia("(display-mode: standalone)")
  media.addEventListener("change", onChange)
  window.addEventListener("appinstalled", onChange)
  return () => {
    media.removeEventListener("change", onChange)
    window.removeEventListener("appinstalled", onChange)
  }
}

export function InstallHint() {
  const installed = useSyncExternalStore(subscribeInstalled, installedNow, () => false)
  const [promptEvent, setPromptEvent] = useState<InstallPrompt | null>(null)

  useEffect(() => {
    registerDeskWorker()
    const onPrompt = (event: Event) => {
      event.preventDefault()
      setPromptEvent(event as InstallPrompt)
    }
    window.addEventListener("beforeinstallprompt", onPrompt)
    return () => window.removeEventListener("beforeinstallprompt", onPrompt)
  }, [])

  if (installed) return null

  return (
    <section>
      <h2 className="ios-section">Add to your phone</h2>
      <div className="ios-group">
        <p className="ios-copy">iPhone: tap Share, then Add to Home Screen. Android: tap Install, or open the browser menu and choose Add to Home screen.</p>
        {promptEvent ? (
          <button
            type="button"
            className="ios-action"
            onClick={() => {
              void promptEvent.prompt().then(() => setPromptEvent(null))
            }}
          >
            Install
          </button>
        ) : null}
      </div>
    </section>
  )
}
