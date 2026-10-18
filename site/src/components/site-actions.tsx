"use client"

import { useEffect, useState } from "react"
import { ArrowUpRight, Check, Copy, Menu, X } from "lucide-react"
import { Button } from "@/components/ui/button"

const sections = [
  { id: "overview", label: "Overview" },
  { id: "codemonkey", label: "CodeMonkey" },
  { id: "harness", label: "Harness Pro" },
  { id: "workflow", label: "Workflow" },
  { id: "start", label: "Get started" },
]

const repositories = [
  { href: "https://github.com/dharmen8980/CodeMonkey", label: "CodeMonkey GitHub" },
  { href: "https://github.com/dharmen8980/Harness-Pro", label: "Harness Pro GitHub" },
]

export function SiteHeader() {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState("overview")

  useEffect(() => {
    let frame = 0
    const update = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        const marker = window.scrollY + 160
        let current = sections[0].id
        for (const section of sections) {
          const element = document.getElementById(section.id)
          if (element && element.getBoundingClientRect().top + window.scrollY <= marker) current = section.id
        }
        setActive(current)
        frame = 0
      })
    }
    update()
    window.addEventListener("scroll", update, { passive: true })
    window.addEventListener("resize", update)
    return () => {
      window.removeEventListener("scroll", update)
      window.removeEventListener("resize", update)
      window.cancelAnimationFrame(frame)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [open])

  return (
    <header className="sticky top-0 z-50 border-b border-[#33435d] bg-[#0b1425]/95 text-white shadow-[0_8px_24px_rgba(3,10,24,.18)] backdrop-blur-md">
      <div className="page-container flex h-20 items-center justify-between gap-5">
        <a href="#overview" className="flex shrink-0 items-center gap-3 font-heading text-sm font-bold tracking-[-0.035em] sm:text-base" aria-label="CodeMonkey and Harness Pro home" onClick={() => setOpen(false)}>
          <span className="grid size-9 place-items-center rounded-md bg-[#2563eb] font-mono text-xs font-bold text-white">CM</span>
          <span>CodeMonkey <span className="text-[#a5c6ff]">/</span> Harness Pro</span>
        </a>
        <nav className="hidden items-center gap-1 xl:flex" aria-label="Primary navigation">
          {sections.map(section => <a key={section.id} href={"#" + section.id} aria-current={active === section.id ? "location" : undefined} className={"rounded-md px-3 py-2 text-sm font-bold transition-colors " + (active === section.id ? "bg-[#2563eb] text-white" : "text-[#dce5f5] hover:bg-white/10 hover:text-white")}>{section.label}</a>)}
        </nav>
        <div className="hidden items-center gap-4 border-l border-[#52627e] pl-5 xl:flex">
          {repositories.map(repository => <a key={repository.href} href={repository.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-bold text-[#dce5f5] transition-colors hover:text-white">{repository.label}<ArrowUpRight className="size-4" aria-hidden="true" /></a>)}
        </div>
        <Button variant="outline" size="icon-lg" className="border-[#71839e] bg-transparent text-white hover:border-white hover:bg-white/10 hover:text-white xl:hidden" aria-label={open ? "Close navigation" : "Open navigation"} aria-controls="mobile-nav" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X className="size-5" /> : <Menu className="size-5" />}</Button>
      </div>
      {open && <nav id="mobile-nav" className="absolute inset-x-0 top-full max-h-[calc(100dvh-5rem)] overflow-y-auto border-b border-[#52627e] bg-[#101a2d] px-5 py-4 shadow-2xl xl:hidden" aria-label="Mobile navigation">
        {sections.map(section => <a key={section.id} href={"#" + section.id} aria-current={active === section.id ? "location" : undefined} className={"block rounded-md px-4 py-3 text-base font-bold " + (active === section.id ? "bg-[#2563eb] text-white" : "text-[#dce5f5] hover:bg-white/10")} onClick={() => { setActive(section.id); setOpen(false) }}>{section.label}</a>)}
        <div className="mt-3 border-t border-[#405371] pt-3">{repositories.map(repository => <a key={repository.href} href={repository.href} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-md px-4 py-3 text-base font-bold text-[#dce5f5] hover:bg-white/10" onClick={() => setOpen(false)}>{repository.label}<ArrowUpRight className="size-4" aria-hidden="true" /></a>)}</div>
      </nav>}
    </header>
  )
}

export function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="my-7 overflow-hidden rounded-lg border border-[#33435d] bg-[#101a2d] text-white">
      <div className="flex items-center justify-between border-b border-[#405371] px-4 py-2.5"><span className="font-mono text-xs font-bold tracking-[0.12em] text-[#a5c6ff]">TERMINAL</span><Button variant="ghost" size="sm" className="h-8 gap-2 px-2 font-mono text-xs font-bold text-white hover:bg-[#33435d] hover:text-white" onClick={copy} aria-label={copied ? "Commands copied" : "Copy commands"}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />}{copied ? "Copied" : "Copy"}</Button></div>
      <pre className="overflow-x-auto px-4 py-5 font-mono text-sm leading-7 text-[#e6efff]"><code>{code}</code></pre>
    </div>
  )
}
