type FlowNodeProps = {
  x: number
  y: number
  width: number
  label: string
  title: string
  detail: string
  tone: "blue" | "green" | "violet"
}

function FlowNode({ x, y, width, label, title, detail, tone }: FlowNodeProps) {
  const colors = {
    blue: { fill: "#20395e", stroke: "#6d9cff", label: "#a5c6ff" },
    green: { fill: "#173d3e", stroke: "#53d9b0", label: "#8bf0cc" },
    violet: { fill: "#302941", stroke: "#c8a4ff", label: "#dec8ff" },
  }[tone]

  return <g>
    <rect x={x} y={y} width={width} height="112" rx="10" fill={colors.fill} stroke={colors.stroke} strokeWidth="1.5" />
    <text x={x + 16} y={y + 29} fill={colors.label} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="11" fontWeight="700" letterSpacing="1.2">{label}</text>
    <text x={x + 16} y={y + 61} fill="#ffffff" fontFamily="Montserrat, Arial, sans-serif" fontSize="16" fontWeight="700">{title}</text>
    <text x={x + 16} y={y + 87} fill="#dce5f5" fontFamily="Lato, Arial, sans-serif" fontSize="13">{detail}</text>
  </g>
}

const mobileSteps = [
  { owner: "CODEMONKEY", title: "Receive the request", detail: "A manual task or repository event enters the queue.", tone: "blue" },
  { owner: "CODEMONKEY", title: "Dispatch the worker", detail: "CodeMonkey passes task context and a checkout to the worker.", tone: "blue" },
  { owner: "HARNESS PRO", title: "Compile the contract", detail: "The manifest defines the model, mounts, tools, and limits.", tone: "green" },
  { owner: "HARNESS PRO", title: "Run the agent", detail: "The runtime uses registered tools and emits a result and trace.", tone: "green" },
  { owner: "CODEMONKEY", title: "Track the outcome", detail: "Run status and worker artifacts remain visible.", tone: "blue" },
  { owner: "HUMAN REVIEW", title: "Decide what ships", detail: "A person inspects the evidence and accepts or revises.", tone: "violet" },
] as const

export function CombinedWorkflow() {
  return <div className="overflow-hidden rounded-2xl border border-[#405371] bg-[#0b1425] text-white shadow-[0_25px_60px_rgba(3,10,24,.18)]">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#33435d] px-6 py-5 sm:px-8">
      <div><p className="font-mono text-xs font-bold tracking-[0.15em] text-[#a5c6ff]">CODEMONKEY × HARNESS PRO</p><h3 className="mt-2 font-heading text-xl font-bold">The handoff from task to decision</h3></div>
      <span className="rounded-full border border-[#5279bc] bg-[#17243b] px-3 py-1 font-mono text-xs font-bold text-[#dce5f5]">DEPLOYED FLOW</span>
    </div>
    <ol className="space-y-3 px-5 py-6 lg:hidden">
      {mobileSteps.map((step, index) => <li key={step.title}>
        <div className={"rounded-lg border p-5 " + (step.tone === "green" ? "border-[#53d9b0] bg-[#102b31]" : step.tone === "violet" ? "border-[#c8a4ff] bg-[#272039]" : "border-[#6d9cff] bg-[#17243b]")}>
          <p className="font-mono text-xs font-bold tracking-[0.12em] text-[#a5c6ff]">{String(index + 1).padStart(2, "0")} / {step.owner}</p>
          <h4 className="mt-2 font-heading text-lg font-bold">{step.title}</h4>
          <p className="mt-2 text-sm leading-6 text-[#dce5f5]">{step.detail}</p>
        </div>
        {index < mobileSteps.length - 1 && <p aria-hidden="true" className="pt-3 text-center text-2xl text-[#8bb5ff]">↓</p>}
      </li>)}
    </ol>
    <div className="hidden overflow-x-auto lg:block">
      <svg className="block h-auto min-w-[1080px] w-full" viewBox="0 0 1200 610" role="img" aria-labelledby="combined-flow-title combined-flow-description">
        <title id="combined-flow-title">How CodeMonkey and Harness Pro work together</title>
        <desc id="combined-flow-description">In the deployed integration, CodeMonkey receives and queues a task, then dispatches a worker. Harness Pro compiles the manifest and runs the agent, producing a result and JSONL trace. CodeMonkey tracks the worker outcome and artifacts for human review.</desc>
        <defs><marker id="combined-flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#a5c6ff" /></marker></defs>
        <rect x="30" y="70" width="1140" height="200" rx="14" fill="#14253f" stroke="#405f91" strokeWidth="1.5" />
        <rect x="30" y="330" width="1140" height="200" rx="14" fill="#122c33" stroke="#3e8a79" strokeWidth="1.5" />
        <text x="50" y="105" fill="#a5c6ff" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="12" fontWeight="700" letterSpacing="1.4">CODEMONKEY / ORCHESTRATION</text>
        <text x="50" y="365" fill="#8bf0cc" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="12" fontWeight="700" letterSpacing="1.4">HARNESS PRO / EXECUTION</text>
        <g fill="none" stroke="#a5c6ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" markerEnd="url(#combined-flow-arrow)">
          <path d="M 255 201 H 310" />
          <path d="M 420 258 V 390" />
          <path d="M 530 446 H 565" />
          <path d="M 755 446 H 790" />
          <path d="M 882 390 V 258" />
          <path d="M 970 201 H 1005" />
        </g>
        <text x="447" y="306" fill="#a5c6ff" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="11" fontWeight="700" letterSpacing="1.1">WORKER HANDOFF ↓</text>
        <text x="900" y="306" fill="#a5c6ff" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="11" fontWeight="700" letterSpacing="1.1">↑ RUN OUTCOME</text>
        <FlowNode x={50} y={145} width={205} label="01 / INTAKE" title="Request arrives" detail="Manual or repository event" tone="blue" />
        <FlowNode x={310} y={145} width={220} label="02 / DISPATCH" title="Queue + worker" detail="Task context and checkout" tone="blue" />
        <FlowNode x={790} y={145} width={180} label="05 / VISIBILITY" title="Track outcome" detail="Status and artifacts" tone="blue" />
        <FlowNode x={1005} y={145} width={160} label="06 / DECISION" title="Human review" detail="Accept or revise" tone="violet" />
        <FlowNode x={310} y={390} width={220} label="03 / CONTRACT" title="Compile manifest" detail="Model, mounts, tools, limits" tone="green" />
        <FlowNode x={565} y={390} width={190} label="04 / EXECUTION" title="Run the agent" detail="Registered tools" tone="green" />
        <FlowNode x={790} y={390} width={180} label="RUN EVIDENCE" title="Result + trace" detail="Final text and JSONL" tone="green" />
        <text x="50" y="570" fill="#a8b9d2" fontFamily="Lato, Arial, sans-serif" fontSize="15">CodeMonkey owns task state, worker dispatch, and review.</text>
        <text x="650" y="570" fill="#a8b9d2" fontFamily="Lato, Arial, sans-serif" fontSize="15">Harness Pro owns the agent contract and run.</text>
      </svg>
    </div>
  </div>
}
