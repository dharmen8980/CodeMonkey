import { ArrowDown, ArrowRight, ArrowUpRight, Braces, GitPullRequestArrow, ScanEye, Terminal } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { CodeBlock, SiteHeader } from "@/components/site-actions"

const codeMonkeyUrl = "https://github.com/dharmen8980/CodeMonkey"
const harnessProUrl = "https://github.com/dharmen8980/Harness-Pro"

const codeMonkeyFeatures = [
  { number: "01", title: "Bring work in", body: "Receive direct tasks and GitLab merge request events, then keep each request in a visible queue." },
  { number: "02", title: "Run the right worker", body: "Launch a dedicated Docker worker with a repository checkout, role instructions, and configured credentials." },
  { number: "03", title: "Keep the evidence", body: "Follow runs in the dashboard, inspect artifacts and chat, and use the optional acceptance pipeline for build, test, SonarQube, and human review." },
]

const harnessFeatures = [
  { number: "01", title: "Declare the contract", body: "A versioned JSON manifest chooses the provider, model, mounted paths, capabilities, MCP servers, behavior, and limits." },
  { number: "02", title: "Compile before execution", body: "Validate the manifest and inspect its runtime configuration without reading mounts or contacting a provider." },
  { number: "03", title: "Run with a trace", body: "Start one headless run with registered tools and record model and tool activity in a JSONL trace." },
]

const workflow = [
  { number: "01", owner: "CODEMONKEY", title: "A request arrives", body: "A task or GitLab event enters the queue with its context and status.", icon: GitPullRequestArrow },
  { number: "02", owner: "HARNESS PRO", title: "The agent is defined", body: "A manifest sets the model, workspace access, tools, and run limits.", icon: Braces },
  { number: "03", owner: "BOTH TOOLS", title: "The worker runs", body: "CodeMonkey tracks the run while Harness Pro records its agent trace.", icon: Terminal },
  { number: "04", owner: "HUMAN", title: "The result is reviewed", body: "Changes and evidence stay available for an explicit acceptance decision.", icon: ScanEye },
]

function Eyebrow({ number, children, light = false }: { number: string; children: string; light?: boolean }) {
  return <p className={"flex items-center gap-3 font-mono text-xs font-bold tracking-[0.16em] " + (light ? "text-[#a5c6ff]" : "text-[#1d4ed8]")}><span className={"grid size-8 place-items-center rounded-md border " + (light ? "border-[#6688c6] text-white" : "border-[#b9d1ff] text-[#1d4ed8]")}>{number}</span>{children}</p>
}

function RepositoryLink({ href, label, light = false }: { href: string; label: string; light?: boolean }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className={"inline-flex w-fit items-center gap-2 border-b pb-1.5 text-base font-bold transition-colors " + (light ? "border-[#8bb5ff] text-white hover:text-[#a5c6ff]" : "border-[#2563eb] text-[#17243b] hover:text-[#1d4ed8]")}>{label}<ArrowUpRight className="size-4" aria-hidden="true" /></a>
}

export default function Home() {
  return <>
    <a className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[60] focus:rounded-md focus:bg-white focus:px-4 focus:py-3 focus:text-[#101a2d]" href="#main">Skip to content</a>
    <SiteHeader />
    <main id="main">
      <section id="overview" className="relative scroll-mt-20 overflow-hidden bg-[#101a2d] text-white" aria-labelledby="hero-title">
        <div className="hero-grid pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="pointer-events-none absolute -right-24 -top-28 size-[380px] rounded-full bg-[#2563eb]/15 blur-3xl" aria-hidden="true" />
        <div className="page-container relative grid min-h-[750px] grid-cols-[minmax(0,1fr)] items-center gap-14 py-20 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,.95fr)] lg:gap-16 lg:py-28">
          <div className="min-w-0">
            <Eyebrow number="01" light>OPEN SOURCE / AGENT WORK</Eyebrow>
            <h1 id="hero-title" className="mt-9 max-w-[670px] text-5xl font-bold leading-[1.08] tracking-[-0.055em] sm:text-6xl lg:text-[68px]">Make agent work <span className="text-[#a5c6ff]">observable.</span></h1>
            <p className="mt-7 max-w-[570px] text-lg leading-8 text-[#dce5f5]">CodeMonkey coordinates requests and reviews. Harness Pro defines and runs the agent. Together, they turn a task into work you can follow and inspect.</p>
            <div className="mt-9 flex flex-wrap gap-3">
              <a href="#codemonkey" className="inline-flex min-h-12 items-center justify-center gap-3 rounded-md bg-[#2563eb] px-6 text-base font-bold text-white transition-colors hover:bg-[#1d4ed8]">Explore the tools <ArrowRight className="size-5" aria-hidden="true" /></a>
              <a href="#workflow" className="inline-flex min-h-12 items-center justify-center gap-3 rounded-md border border-[#91a3bf] px-6 text-base font-bold text-white transition-colors hover:border-white hover:bg-white/10">See the workflow <ArrowDown className="size-5" aria-hidden="true" /></a>
            </div>
            <p className="mt-12 flex items-center gap-3 text-sm font-bold text-[#a8b9d2]"><span className="h-px w-8 bg-[#8bb5ff]" />Already paired in a deployed CodeMonkey setup.</p>
          </div>
          <div className="relative mx-auto w-full max-w-[520px] min-w-0 lg:ml-auto">
            <div className="absolute -bottom-5 -right-5 top-5 left-5 rounded-xl border border-[#8bb5ff]/40" aria-hidden="true" />
            <Card className="relative gap-0 overflow-hidden rounded-xl border border-[#6680a8] bg-[#17243b] py-0 text-white shadow-[0_32px_70px_rgba(3,10,24,.4)] ring-0">
              <div className="flex items-center justify-between border-b border-[#405371] px-6 py-4">
                <p className="font-mono text-xs font-bold tracking-[0.12em] text-[#dce5f5]">EXAMPLE RUN / 042</p>
                <Badge className="border border-[#8bb5ff] bg-[#203c6f] px-3 py-1 font-mono text-[10px] font-bold text-white">REVIEW READY</Badge>
              </div>
              <CardContent className="px-6 py-7 sm:px-8">
                <p className="text-2xl font-semibold leading-snug tracking-[-0.035em]">From request to evidence</p>
                <ol className="mt-7 border-l-2 border-[#5279bc]">
                  {[
                    { label: "REQUEST", title: "Review feedback received", detail: "CodeMonkey queues the task" },
                    { label: "CONTRACT", title: "Agent scope compiled", detail: "Harness Pro sets model, tools, limits" },
                    { label: "RUN", title: "Worker completes", detail: "Artifacts and trace are recorded" },
                    { label: "REVIEW", title: "A person decides", detail: "Evidence is ready to inspect" },
                  ].map((item, index) => <li key={item.label} className="relative pb-6 pl-7 last:pb-0"><span className={"absolute -left-[7px] top-1 size-3 rounded-full border-2 border-[#17243b] " + (index === 3 ? "bg-[#a5c6ff]" : "bg-[#6d9cff]")} /><p className="font-mono text-[11px] font-bold tracking-[0.12em] text-[#a5c6ff]">{item.label}</p><p className="mt-1 text-base font-bold text-white">{item.title}</p><p className="mt-1 text-sm text-[#bdcce3]">{item.detail}</p></li>)}
                </ol>
              </CardContent>
              <div className="flex items-center justify-between border-t border-[#405371] bg-[#1e3152] px-6 py-4 text-sm text-[#dce5f5] sm:px-8"><span>Every step has an owner.</span><span className="font-mono font-bold text-[#a5c6ff]">CM × HP</span></div>
            </Card>
          </div>
        </div>
      </section>

      <div className="bg-[#2563eb] text-white"><div className="page-container flex flex-col gap-3 py-7 md:flex-row md:items-center md:justify-between"><p className="font-mono text-xs font-bold tracking-[0.16em]">ONE WORKFLOW / TWO RESPONSIBILITIES</p><p className="text-lg font-bold">Coordinate the work. Define the run. Review the result.</p></div></div>

      <section id="codemonkey" className="scroll-mt-20 bg-white py-24 lg:py-32" aria-labelledby="codemonkey-title">
        <div className="page-container grid gap-14 lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)] lg:gap-20">
          <div>
            <Eyebrow number="02">CODEMONKEY / ORCHESTRATION</Eyebrow>
            <h2 id="codemonkey-title" className="mt-8 max-w-[530px] text-4xl font-bold leading-[1.14] tracking-[-0.05em] text-[#17243b] md:text-5xl">A control room for every agent task.</h2>
            <p className="mt-7 max-w-[510px] text-lg leading-8 text-[#34445f]">CodeMonkey is a self-hosted GitLab task orchestrator. It brings requests into one place, launches dedicated Docker workers, and makes progress and results visible to the people responsible for delivery.</p>
            <div className="mt-8"><RepositoryLink href={codeMonkeyUrl} label="Explore CodeMonkey on GitHub" /></div>
          </div>
          <div className="border-t-2 border-[#2563eb]">
            {codeMonkeyFeatures.map(feature => <div key={feature.number} className="grid grid-cols-[52px_1fr] gap-5 border-b border-[#dce3ee] py-7"><span className="font-mono text-sm font-bold text-[#1d4ed8]">{feature.number}</span><div><h3 className="text-2xl font-semibold tracking-[-0.04em] text-[#17243b]">{feature.title}</h3><p className="mt-3 text-base leading-7 text-[#34445f]">{feature.body}</p></div></div>)}
          </div>
        </div>
      </section>

      <section id="harness" className="scroll-mt-20 bg-[#eaf0fa] py-24 lg:py-32" aria-labelledby="harness-title">
        <div className="page-container grid gap-14 lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)] lg:items-center lg:gap-20">
          <div className="lg:order-2">
            <Eyebrow number="03">HARNESS PRO / EXECUTION</Eyebrow>
            <h2 id="harness-title" className="mt-8 max-w-[560px] text-4xl font-bold leading-[1.14] tracking-[-0.05em] text-[#17243b] md:text-5xl">Define the agent before it runs.</h2>
            <p className="mt-7 max-w-[560px] text-lg leading-8 text-[#34445f]">Harness Pro is a provider-agnostic runtime for one headless agent run. Its versioned manifest spells out what the agent can access, which tools it can use, and when the run must stop.</p>
            <div className="mt-8"><RepositoryLink href={harnessProUrl} label="Explore Harness Pro on GitHub" /></div>
          </div>
          <div className="lg:order-1">
            <Card className="gap-0 overflow-hidden rounded-xl border border-[#33435d] bg-[#101a2d] py-0 text-white shadow-[0_25px_55px_rgba(23,36,59,.16)] ring-0">
              <div className="flex items-center justify-between border-b border-[#33435d] px-6 py-4 font-mono text-xs font-bold tracking-[0.12em] text-[#a5c6ff]"><span>MANIFEST EXCERPT</span><Braces className="size-5" aria-hidden="true" /></div>
              <CardContent className="px-6 py-7">
                <pre className="overflow-x-auto font-mono text-sm leading-8 text-[#e6efff]"><code>{[
                  "{",
                  '  "provider": "anthropic",',
                  '  "model": "your-model",',
                  '  "capabilities": ["repo_read"],',
                  '  "turn_limit": 12',
                  "}",
                ].join("\n")}</code></pre>
                <Separator className="my-6 bg-[#33435d]" />
                <div className="grid gap-4 sm:grid-cols-3">{["01  DECLARE", "02  COMPILE", "03  RUN + TRACE"].map(item => <p key={item} className="rounded-md border border-[#405371] bg-[#17243b] px-3 py-3 font-mono text-xs font-bold text-[#dce5f5]">{item}</p>)}</div>
              </CardContent>
            </Card>
            <p className="mt-5 text-sm leading-6 text-[#4e5f79]">Compilation validates the contract without accessing the workspace or calling a provider.</p>
          </div>
        </div>
        <div className="page-container mt-14 grid gap-4 md:grid-cols-3">
          {harnessFeatures.map(feature => <div key={feature.number} className="border-t-2 border-[#2563eb] bg-white px-6 py-7"><span className="font-mono text-sm font-bold text-[#1d4ed8]">{feature.number}</span><h3 className="mt-5 text-xl font-semibold tracking-[-0.035em] text-[#17243b]">{feature.title}</h3><p className="mt-3 text-base leading-7 text-[#34445f]">{feature.body}</p></div>)}
        </div>
      </section>

      <section id="workflow" className="scroll-mt-20 bg-[#101a2d] py-24 text-white lg:py-32" aria-labelledby="workflow-title">
        <div className="page-container">
          <Eyebrow number="04" light>HOW THEY WORK TOGETHER</Eyebrow>
          <div className="mt-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between"><h2 id="workflow-title" className="max-w-[720px] text-4xl font-bold leading-[1.14] tracking-[-0.05em] md:text-5xl">One request. Four visible steps.</h2><p className="max-w-[360px] text-lg leading-8 text-[#dce5f5]">The handoff from orchestration to execution is explicit, and the outcome stays reviewable.</p></div>
          <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {workflow.map(step => <Card key={step.number} className="gap-0 border border-[#405371] bg-[#17243b] py-0 text-white ring-0"><CardContent className="flex h-full flex-col px-6 py-7"><div className="flex items-center justify-between"><span className="font-mono text-sm font-bold text-[#a5c6ff]">{step.number}</span><step.icon className="size-6 text-[#a5c6ff]" aria-hidden="true" /></div><h3 className="mt-12 text-xl font-semibold leading-snug tracking-[-0.035em]">{step.title}</h3><p className="mt-3 flex-1 text-base leading-7 text-[#dce5f5]">{step.body}</p><p className="mt-8 border-t border-[#405371] pt-4 font-mono text-xs font-bold tracking-[0.12em] text-[#a5c6ff]">{step.owner}</p></CardContent></Card>)}
          </div>
          <div className="mt-8 border-l-4 border-[#8bb5ff] bg-[#1e3152] px-6 py-5 text-base leading-7 text-[#e6efff]"><strong className="text-white">In use today:</strong> A deployed CodeMonkey setup already runs workers through Harness Pro. The public CodeMonkey checkout currently ships the Claude Code worker path; its Harness Pro adapter has not been published here.</div>
        </div>
      </section>

      <section id="start" className="scroll-mt-20 bg-[#f5f7fb] py-24 lg:py-32" aria-labelledby="start-title">
        <div className="page-container">
          <Eyebrow number="05">GET STARTED</Eyebrow>
          <div className="mt-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><h2 id="start-title" className="max-w-[700px] text-4xl font-bold leading-[1.14] tracking-[-0.05em] text-[#17243b] md:text-5xl">Pick the part you need.</h2><p className="max-w-[380px] text-lg leading-8 text-[#34445f]">Run either project on its own. Their repositories have the full setup guides.</p></div>
          <div className="mt-12 grid gap-5 lg:grid-cols-2">
            <Card className="gap-0 rounded-xl border border-[#cbd7e8] bg-white py-0 ring-0"><CardContent className="flex h-full flex-col p-7 sm:p-9"><div className="flex items-center gap-4"><span className="grid size-12 place-items-center rounded-lg bg-[#101a2d] text-[#a5c6ff]"><Terminal className="size-6" aria-hidden="true" /></span><h3 className="text-2xl font-semibold tracking-[-0.04em] text-[#17243b]">Start CodeMonkey</h3></div><p className="mt-6 text-base leading-7 text-[#34445f]">Configure a target repository, GitLab access, and model credentials, then start the local dashboard.</p><CodeBlock code={["cp .env.example .env", "./start.sh"].join("\n")} /><div className="mt-auto"><RepositoryLink href={codeMonkeyUrl + "#setup"} label="Read the CodeMonkey setup guide" /></div></CardContent></Card>
            <Card className="gap-0 rounded-xl border border-[#cbd7e8] bg-white py-0 ring-0"><CardContent className="flex h-full flex-col p-7 sm:p-9"><div className="flex items-center gap-4"><span className="grid size-12 place-items-center rounded-lg bg-[#dbeafe] text-[#1d4ed8]"><Braces className="size-6" aria-hidden="true" /></span><h3 className="text-2xl font-semibold tracking-[-0.04em] text-[#17243b]">Start Harness Pro</h3></div><p className="mt-6 text-base leading-7 text-[#34445f]">Install the Python package, copy an example manifest, inspect the compiled contract, and run an agent.</p><CodeBlock code={["python -m pip install -e .", "cp examples/standalone-anthropic.json my-agent.json", "harness compile --manifest my-agent.json -o runtime.json", "harness run --manifest my-agent.json --prompt \"Review the repo\" --trace-file trace.jsonl"].join("\n")} /><div className="mt-auto"><RepositoryLink href={harnessProUrl + "#quick-start"} label="Read the Harness Pro quick start" /></div></CardContent></Card>
          </div>
        </div>
      </section>
    </main>
    <footer className="bg-[#0b1425] text-[#dce5f5]"><div className="page-container flex flex-col gap-6 py-9 sm:flex-row sm:items-center sm:justify-between"><p className="font-heading text-base font-bold">CodeMonkey <span className="text-[#8bb5ff]">×</span> Harness Pro</p><div className="flex flex-wrap items-center gap-6 text-sm font-bold"><RepositoryLink href={codeMonkeyUrl} label="CodeMonkey" light /><RepositoryLink href={harnessProUrl} label="Harness Pro" light /><a href="#overview" className="text-[#dce5f5] hover:text-white">Back to top ↑</a></div></div></footer>
  </>
}
