"use client"

import { useState } from "react"
import { ArrowUpRight, Check, Copy, Menu, X } from "lucide-react"
import { Button } from "@/components/ui/button"

const links = [
  { href: "#platform", label: "Overview" },
  { href: "#details", label: "What they do" },
  { href: "#workflow", label: "Workflow" },
  { href: "#getting-started", label: "Get started" },
]

export function SiteHeader() {
  const [open, setOpen] = useState(false)
  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[#101a2d]/95 shadow-[0_8px_24px_rgba(11,20,37,.18)] backdrop-blur-md">
      <div className="page-container flex h-[78px] items-center justify-between gap-6 lg:h-[88px]">
        <a href="#top" className="flex items-center gap-3 text-sm font-bold tracking-[-0.055em] text-white sm:text-base" aria-label="CodeMonkey and Harness Pro home">
          <span className="grid size-9 place-items-center rounded-lg border border-[#8bb5ff]/50 font-mono text-[13px] text-[#8bb5ff]">{"</>"}</span>
          <span>code<span className="text-[#8bb5ff]">monkey</span><span className="font-normal text-[#a8b9d2]"> + </span>harness<span className="text-[#8bb5ff]">pro</span></span>
        </a>
        <nav className="hidden items-center gap-6 text-[13px] font-medium text-[#dce5f5] xl:flex" aria-label="Primary navigation">
          {links.map(link => <a key={link.href} className="transition-colors hover:text-[#8bb5ff]" href={link.href}>{link.label}</a>)}
          <a className="inline-flex items-center gap-2 rounded-md border border-white/25 px-4 py-2.5 text-white transition-colors hover:border-[#8bb5ff] hover:text-[#8bb5ff]" href="https://github.com/dharmen8980/CodeMonkey" target="_blank" rel="noopener noreferrer">CodeMonkey GitHub <ArrowUpRight className="size-4" aria-hidden="true" /></a>
          <a className="inline-flex items-center gap-2 rounded-md border border-white/25 px-4 py-2.5 text-white transition-colors hover:border-[#8bb5ff] hover:text-[#8bb5ff]" href="https://github.com/dharmen8980/Harness-Pro" target="_blank" rel="noopener noreferrer">Harness Pro GitHub <ArrowUpRight className="size-4" aria-hidden="true" /></a>
        </nav>
        <Button variant="outline" size="icon-lg" className="border-white/30 bg-transparent text-white hover:border-[#8bb5ff] hover:bg-white/10 hover:text-white xl:hidden" aria-label={open ? "Close navigation" : "Open navigation"} aria-controls="mobile-nav" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X className="size-5" /> : <Menu className="size-5" />}</Button>
      </div>
      {open && <nav id="mobile-nav" className="absolute inset-x-0 top-full grid gap-1 border-b border-[#33435d] bg-[#17243b] px-6 py-4 shadow-2xl xl:hidden" aria-label="Mobile navigation">{links.map(link => <a key={link.href} className="rounded-md px-2 py-3 text-sm text-white hover:bg-white/10" href={link.href} onClick={() => setOpen(false)}>{link.label}</a>)}<a className="mt-2 inline-flex items-center gap-2 rounded-md border border-white/20 px-4 py-3 text-sm text-white" href="https://github.com/dharmen8980/CodeMonkey" target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>CodeMonkey GitHub <ArrowUpRight className="size-4" /></a><a className="mt-2 inline-flex items-center gap-2 rounded-md border border-white/20 px-4 py-3 text-sm text-white" href="https://github.com/dharmen8980/Harness-Pro" target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>Harness Pro GitHub <ArrowUpRight className="size-4" /></a></nav>}
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
    <div className="my-7 overflow-hidden rounded-lg bg-[#101a2d] text-[#dce5f5]">
      <div className="flex items-center justify-between border-b border-[#33435d] px-4 py-2.5 font-mono text-[10px] font-bold tracking-widest text-[#a8b9d2]"><span>TERMINAL</span><Button variant="ghost" size="sm" className="h-7 px-2 font-mono text-[10px] tracking-normal text-[#8bb5ff] hover:bg-white/10 hover:text-white" onClick={copy} aria-label={copied ? "Commands copied" : "Copy commands"}>{copied ? <Check className="size-3" /> : <Copy className="size-3" />}{copied ? "Copied" : "Copy"}</Button></div>
      <pre className="overflow-x-auto px-4 py-5 font-mono text-[11px] leading-6"><code>{code}</code></pre>
    </div>
  )
}
