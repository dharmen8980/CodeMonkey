import type { ReactNode } from "react"
import { ArrowDown, ArrowUpRight, Braces, GitPullRequestArrow, ScanEye, Terminal } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { CodeBlock, SiteHeader } from "@/components/site-actions"

const codeMonkeyUrl = "https://github.com/dharmen8980/CodeMonkey"
const harnessProUrl = "https://github.com/dharmen8980/Harness-Pro"

const products = [
  {
    number: "01 / ORCHESTRATION",
    name: "CodeMonkey",
    tagline: "The workspace that moves work forward.",
    body: "Receive tasks and GitLab events, run Docker-based workers, and follow each run through a dashboard with artifacts, chat, and a human review path.",
    features: ["Task and merge request intake", "Worker dispatch and run history", "Dashboard, chat, and acceptance board"],
    icon: Terminal,
    tinted: false,
  },
  {
    number: "02 / EXECUTION",
    name: "Harness Pro",
    tagline: "A runtime defined before it runs.",
    body: "Describe one agent in a versioned JSON manifest: provider, model, workspace mounts, tools, MCP schemas, limits, and behavior. Compile it, then run it locally with a trace.",
    features: ["Explicit capabilities and workspace mounts", "Anthropic, Bedrock, and OpenAI-compatible providers", "Deterministic compile and JSONL run traces"],
    icon: Braces,
    tinted: true,
  },
]

const steps = [
  { number: "01", icon: GitPullRequestArrow, title: "Capture the request", body: "CodeMonkey accepts a task, ticket, or GitLab review event and places it in a visible queue.", owner: "CODEMONKEY" },
  { number: "02", icon: Braces, title: "Set the agent contract", body: "Harness Pro's manifest names the provider, model, mounted workspace, available capabilities, and run limits.", owner: "HARNESS PRO" },
  { number: "03", icon: Terminal, title: "Run with a record", body: "In the integrated deployment, CodeMonkey records worker artifacts while Harness Pro emits the agent trace.", owner: "BOTH TOOLS" },
  { number: "04", icon: ScanEye, title: "Review the outcome", body: "Inspect changes, evidence, and the human acceptance decision before calling work done.", owner: "HUMAN REVIEW" },
]

function SectionHeading({ label, title, secondLine, intro, id }: { label: string; title: string; secondLine: string; intro: string; id: string }) {
  return <div className="mb-12 grid items-end gap-8 lg:grid-cols-[1fr_390px] lg:gap-16"><div><p className="mb-6 font-mono text-[11px] font-bold tracking-[0.18em] text-[#1d4ed8]">{label}</p><h2 id={id} className="text-[clamp(2.8rem,4.5vw,4.4rem)] leading-[1.12] font-semibold tracking-[-0.065em]">{title}<br /><span className="text-[#8391a7]">{secondLine}</span></h2></div><p className="max-w-[570px] text-base leading-7 text-[#4e5f79]">{intro}</p></div>
}

function TextLink({ href, children, external = false }: { href: string; children: ReactNode; external?: boolean }) {
  return <a className="group inline-flex w-fit items-center gap-2 border-b border-[#a5b2c7] pb-1.5 text-sm font-semibold transition-colors hover:border-[#17243b]" href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{children}<ArrowUpRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" /></a>
}

export default function Home() {
  return <>
    <a className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-[#8bb5ff] focus:px-4 focus:py-3 focus:text-[#101a2d]" href="#main">Skip to content</a>
    <SiteHeader />
    <main id="main">
    <div id="top" className="relative overflow-hidden bg-[#101a2d] text-white">
      <div className="hero-grid pointer-events-none absolute inset-0 opacity-25" aria-hidden="true" />
        <section className="page-container relative grid min-h-[730px] grid-cols-[minmax(0,1fr)] items-center gap-14 pt-30 pb-23 lg:grid-cols-[minmax(0,1.1fr)_minmax(400px,.9fr)] lg:gap-16 lg:pt-37 lg:pb-27" aria-labelledby="hero-title">
          <div className="min-w-0 max-w-[660px]">
            <p className="mb-8 flex items-center gap-3 font-mono text-[11px] font-bold tracking-[0.18em] text-[#8bb5ff]"><span className="size-2 rounded-full bg-[#8bb5ff] shadow-[0_0_0_5px_rgba(139,181,255,.18)]" />BUILT FOR REAL AGENT WORK</p>
            <h1 id="hero-title" className="text-[clamp(3.15rem,5.1vw,5rem)] leading-[1.08] font-semibold tracking-[-0.075em]">Give every agent a job.<br /><em className="font-serif font-normal tracking-[-0.055em] text-[#8bb5ff]">Keep every decision visible.</em></h1>
            <p className="mt-7 max-w-[560px] text-base leading-8 text-[#a8b9d2] sm:text-lg">CodeMonkey coordinates the work. Harness Pro defines and runs the agent. They already work together in a deployed setup, taking requests through to results you can inspect.</p>
            <div className="mt-10 flex flex-wrap gap-3"><a className="hero-button bg-[#2563eb] text-white hover:bg-[#1d4ed8]" href="#platform">Meet the tools <ArrowUpRight className="size-4" aria-hidden="true" /></a><a className="hero-button border border-[#516480] text-white hover:border-[#8bb5ff]" href="#workflow">See how they fit <ArrowDown className="size-4" aria-hidden="true" /></a></div>
            <p className="mt-14 flex items-center gap-3 text-xs text-[#a8b9d2]"><span className="h-px w-7 bg-[#8bb5ff]" />Two focused projects. One practical workflow.</p>
          </div>
          <div className="relative mx-auto min-w-0 w-full max-w-[510px] lg:ml-auto" aria-label="Task flow through CodeMonkey and Harness Pro">
            <div className="pointer-events-none absolute top-5 right-[-20px] bottom-[-20px] left-5 rotate-2 rounded-2xl border border-[#7ba9ff]/20" aria-hidden="true" />
            <Card className="relative gap-0 border border-[#33435d] bg-[linear-gradient(145deg,#17243b,#101a2d_82%)] py-0 text-white shadow-[0_35px_80px_rgba(0,0,0,.25)] ring-0">
              <div className="flex items-center justify-between border-b border-[#33435d] px-5 py-4 font-mono text-[9px] tracking-widest text-[#a8b9d2]"><span className="flex gap-1.5"><i className="size-1.5 rounded-full bg-[#8bb5ff]" /><i className="size-1.5 rounded-full bg-[#7083a0]" /><i className="size-1.5 rounded-full bg-[#7083a0]" /></span><span className="hidden sm:inline">AGENT WORKSPACE / OVERVIEW</span><span>01 — 03</span></div>
              <CardHeader className="px-7 pt-8 pb-3"><p className="font-mono text-[10px] font-bold tracking-widest text-[#8bb5ff]">THE CONTROL PLANE</p><CardTitle className="text-2xl font-medium tracking-[-0.05em] text-white">From intent to evidence</CardTitle></CardHeader>
              <CardContent className="grid gap-3 px-6 pt-3 pb-7">{[
                { n: "01", label: "INPUT", title: "A request arrives", detail: "Task, ticket, or review feedback", style: "border-[#33435d] bg-white/[.03]" },
                { n: "02", label: "CODEMONKEY", title: "Coordinate the work", detail: "Dispatch · track · review", style: "border-[#8bb5ff]/60 bg-[#8bb5ff]/[.07]" },
                { n: "03", label: "HARNESS PRO", title: "Define the runtime", detail: "Model · tools · limits · traces", style: "border-[#7ba9ff] bg-white/[.03]" },
              ].map(item => <div key={item.n} className={`grid min-h-22 grid-cols-[26px_1fr_16px] items-start gap-3 rounded-lg border px-4 py-4 ${item.style}`}><span className="pt-0.5 font-mono text-[11px] text-[#a8b9d2]">{item.n}</span><div><span className={`font-mono text-[9px] font-bold tracking-widest ${item.n === "02" ? "text-[#8bb5ff]" : item.n === "03" ? "text-[#a5c6ff]" : "text-[#a8b9d2]"}`}>{item.label}</span><strong className="mt-1 block text-sm font-semibold">{item.title}</strong><p className="mt-1 text-[11px] text-[#a8b9d2]">{item.detail}</p></div><ArrowDown className="mt-1 size-4 text-[#8bb5ff]" aria-hidden="true" /></div>)}</CardContent>
              <div className="flex items-center gap-2 border-t border-[#33435d] px-6 py-4 font-mono text-[10px] text-[#a8b9d2]"><span className="size-1.5 rounded-full bg-[#8bb5ff]" />Designed for an inspectable handoff <span className="ml-auto text-white">CM <span className="text-[#8bb5ff]">×</span> HP</span></div>
            </Card>
          </div>
        </section>
      <div className="page-container relative flex items-center gap-3 pb-7 font-mono text-[9px] font-bold tracking-widest text-[#91a3bf]"><span>SCROLL TO EXPLORE</span><span className="h-px w-12 bg-[#91a3bf]" /><span className="ml-auto">01 / INTRODUCTION</span></div>
    </div>

    <div className="bg-[#eff5ff] text-[#17243b]"><div className="page-container grid md:grid-cols-3">{["A place for work to arrive", "A clear contract for each agent", "A record of what happened"].map((item, index) => <p key={item} className="flex min-h-16 items-center gap-4 border-b border-[#b9d1ff] py-3 text-[13px] font-semibold last:border-b-0 md:min-h-21 md:border-r md:border-b-0 md:px-6 md:first:pl-0 md:last:border-r-0"><span className="font-mono text-[11px] text-[#1d4ed8]">0{index + 1}</span>{item}</p>)}</div></div>

    <section id="platform" className="scroll-mt-12 bg-[#f5f7fb] py-24 lg:py-36" aria-labelledby="platform-title"><div className="page-container"><SectionHeading label="THE PLATFORM / 01" title="Different jobs." secondLine="Better together." intro="Orchestration and execution are separate concerns. Each tool owns a clear part of the journey, making the whole system easier to understand and evolve." id="platform-title" /><div className="grid gap-5 lg:grid-cols-2">{products.map(product => <Card key={product.name} className={`min-h-[565px] gap-0 border py-0 shadow-[0_15px_40px_rgba(21,38,73,.05)] ring-0 ${product.tinted ? "border-[#cbdcf7] bg-[#eff5ff]" : "border-[#dce3ee] bg-white"}`}><CardHeader className="flex flex-row items-start justify-between gap-4 px-8 pt-9 pb-12 sm:px-11 sm:pt-11"><span className={`grid size-13 place-items-center rounded-xl ${product.tinted ? "bg-[#dbeafe] text-[#17243b]" : "bg-[#101a2d] text-[#8bb5ff]"}`}><product.icon className="size-6" aria-hidden="true" /></span><Badge variant="outline" className="border-0 px-0 font-mono text-[10px] tracking-widest text-[#5e6c82]">{product.number}</Badge></CardHeader><CardContent className="flex flex-1 flex-col px-8 pb-9 sm:px-11 sm:pb-11"><h3 className="text-[40px] font-semibold tracking-[-0.06em]">{product.name}</h3><p className="mt-1 text-[17px] font-medium">{product.tagline}</p><p className="mt-5 max-w-[470px] text-sm leading-7 text-[#4e5f79]">{product.body}</p><ul className="mt-7 grid gap-3 text-[13px] text-[#33435d]">{product.features.map(feature => <li key={feature} className="flex gap-3"><ArrowUpRight className="size-4 shrink-0 text-[#2563eb]" aria-hidden="true" />{feature}</li>)}</ul><div className="mt-auto pt-10">{product.tinted ? <TextLink href={harnessProUrl} external>Explore Harness Pro</TextLink> : <TextLink href={codeMonkeyUrl} external>Explore CodeMonkey</TextLink>}</div></CardContent></Card>)}</div></div></section>

    <section id="workflow" className="scroll-mt-12 bg-[#eaf0fa] py-24 lg:py-36" aria-labelledby="workflow-title"><div className="page-container"><SectionHeading label="THE WORKFLOW / 02" title="From request" secondLine="to review." intro="One system decides what needs doing. The other specifies what an agent can use. The result is work you can trace back to its inputs and tools." id="workflow-title" /><Separator className="bg-[#cbd7e8]" /><ol>{steps.map(step => <li key={step.number} className="grid grid-cols-[26px_44px_1fr] items-start gap-4 border-b border-[#cbd7e8] py-7 sm:grid-cols-[48px_58px_1fr] sm:gap-6 lg:grid-cols-[70px_58px_1fr_150px] lg:items-center"><span className="pt-2 font-mono text-[11px] text-[#8b9bb3]">{step.number}</span><span className="grid size-11 place-items-center rounded-lg border border-[#b9d1ff] text-[#1d4ed8] sm:size-14"><step.icon className="size-5" aria-hidden="true" /></span><div><h3 className="text-xl font-semibold tracking-[-0.04em]">{step.title}</h3><p className="mt-2 max-w-[630px] text-sm leading-6 text-[#4e5f79]">{step.body}</p><span className="mt-3 block font-mono text-[9px] font-bold tracking-widest text-[#1d4ed8] lg:hidden">{step.owner}</span></div><span className="hidden justify-self-end font-mono text-[10px] font-bold tracking-widest text-[#1d4ed8] lg:block">{step.owner}</span></li>)}</ol><div className="mt-9 flex max-w-[900px] items-start gap-4 border-l-[3px] border-[#7ba9ff] bg-white/55 px-6 py-5"><span className="grid size-6 shrink-0 place-items-center rounded-full border border-[#2563eb] font-serif text-sm font-bold text-[#1d4ed8]">i</span><p className="text-[13px] leading-6 text-[#4e5f79]"><strong className="text-[#17243b]">Current state:</strong> A deployed CodeMonkey setup already uses Harness Pro for worker runs. The public CodeMonkey checkout currently includes the Claude Code worker path; its Harness Pro adapter has not been published here.</p></div></div></section>

    <section id="getting-started" className="scroll-mt-12 bg-white py-24 lg:py-36" aria-labelledby="start-title"><div className="page-container"><SectionHeading label="GET STARTED / 03" title="Start with one." secondLine="Build toward both." intro="Each project stands on its own. Explore the orchestrator, then use the runtime when you want an explicit, repeatable agent contract." id="start-title" /><div className="grid gap-5 lg:grid-cols-2"><Card className="gap-0 border border-[#dce3ee] bg-[#f8faff] py-0 ring-0"><CardHeader className="flex flex-row items-center gap-4 px-8 pt-9 sm:px-10"><span className="grid size-11 place-items-center rounded-lg bg-[#101a2d] font-mono font-bold text-[#8bb5ff]">A</span><div><p className="font-mono text-[9px] font-bold tracking-widest text-[#5e78a0]">ORCHESTRATOR</p><CardTitle className="mt-1 text-2xl font-semibold tracking-[-0.045em]">Run CodeMonkey</CardTitle></div></CardHeader><CardContent className="flex flex-1 flex-col px-8 pb-9 sm:px-10"><p className="mt-6 min-h-15 text-sm leading-6 text-[#4e5f79]">Configure your repository, GitLab access, and model credentials. Start the local server and open the dashboard.</p><CodeBlock code={`cp .env.example .env\n./start.sh`} /><div className="mt-auto"><TextLink href={`${codeMonkeyUrl}#setup`} external>Read setup guide</TextLink></div></CardContent></Card><Card id="harness-start" className="gap-0 border border-[#dce3ee] bg-[#f8faff] py-0 ring-0"><CardHeader className="flex flex-row items-center gap-4 px-8 pt-9 sm:px-10"><span className="grid size-11 place-items-center rounded-lg bg-[#dbeafe] font-mono font-bold text-[#17243b]">B</span><div><p className="font-mono text-[9px] font-bold tracking-widest text-[#5e78a0]">RUNTIME</p><CardTitle className="mt-1 text-2xl font-semibold tracking-[-0.045em]">Run Harness Pro</CardTitle></div></CardHeader><CardContent className="flex flex-1 flex-col px-8 pb-9 sm:px-10"><p className="mt-6 min-h-15 text-sm leading-6 text-[#4e5f79]">Install the Python package, choose an example manifest, inspect its compiled contract, then start a headless run.</p><CodeBlock code={`python -m pip install -e .\ncp examples/standalone-anthropic.json my-agent.json\nharness compile --manifest my-agent.json -o runtime.json\nharness run --manifest my-agent.json --prompt "Review the repo" --trace-file trace.jsonl`} /><div className="mt-auto"><TextLink href={`${harnessProUrl}#quick-start`} external>Read Harness Pro quick start</TextLink></div></CardContent></Card></div></div></section>

    <section className="relative overflow-hidden bg-[#101a2d] text-white" aria-labelledby="closing-title"><div className="pointer-events-none absolute -top-18 -right-8 rotate-[-12deg] font-mono text-[300px] font-bold tracking-[-0.2em] text-[#8bb5ff]/5" aria-hidden="true">{"</>"}</div><div className="page-container relative flex min-h-[430px] flex-col justify-center gap-9 py-20 lg:flex-row lg:items-end lg:justify-between"><div><p className="mb-6 font-mono text-[11px] font-bold tracking-[0.18em] text-[#8bb5ff]">BUILD WITH INTENT</p><h2 id="closing-title" className="text-[clamp(2.8rem,4.5vw,4.4rem)] leading-[1.12] font-semibold tracking-[-0.065em]">Better agent work starts<br />with <em className="font-serif font-normal text-[#8bb5ff]">clear boundaries.</em></h2><p className="mt-6 text-sm text-[#a8b9d2]">Explore the code, understand the contract, and decide where agents fit in your workflow.</p></div><a className="hero-button shrink-0 bg-[#2563eb] text-white hover:bg-[#1d4ed8]" href={codeMonkeyUrl} target="_blank" rel="noopener noreferrer">View CodeMonkey on GitHub <ArrowUpRight className="size-4" aria-hidden="true" /></a></div></section>

    </main>
    <footer className="bg-[#0b1425] text-[#a8b9d2]"><div className="page-container flex min-h-23 flex-wrap items-center justify-between gap-4 py-6 text-xs"><a className="font-mono text-[#8bb5ff]" href="#top">{"</>"} <strong className="text-white">CodeMonkey</strong> <span className="text-[#a8b9d2]">+ Harness Pro</span></a><p className="order-3 w-full sm:order-none sm:w-auto">Orchestrate thoughtfully. Run deliberately.</p><a className="hover:text-[#8bb5ff]" href="#top">Back to top ↑</a></div></footer>
  </>
}
