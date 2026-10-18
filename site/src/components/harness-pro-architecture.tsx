type NodeProps = {
  x: number
  y: number
  width: number
  height: number
  label: string
  title: string
  lines: string[]
  accent?: "blue" | "green" | "violet"
}

function Node({ x, y, width, height, label, title, lines, accent = "blue" }: NodeProps) {
  const colors = {
    blue: { stroke: "#6d9cff", label: "#a5c6ff", fill: "#17243b" },
    green: { stroke: "#53d9b0", label: "#8bf0cc", fill: "#102b31" },
    violet: { stroke: "#c8a4ff", label: "#dec8ff", fill: "#272039" },
  }[accent]

  return <g>
    <rect x={x} y={y} width={width} height={height} rx="12" fill={colors.fill} stroke={colors.stroke} strokeWidth="1.5" />
    <rect x={x + 18} y={y + 18} width="28" height="3" rx="1.5" fill={colors.stroke} />
    <text x={x + 18} y={y + 44} fill={colors.label} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="11" fontWeight="700" letterSpacing="1.3">{label}</text>
    <text x={x + 18} y={y + 73} fill="#ffffff" fontFamily="Montserrat, Arial, sans-serif" fontSize="17" fontWeight="700">{title}</text>
    <text x={x + 18} y={y + 100} fill="#dce5f5" fontFamily="Lato, Arial, sans-serif" fontSize="13">
      {lines.map((line, index) => <tspan key={line} x={x + 18} dy={index === 0 ? 0 : 20}>{line}</tspan>)}
    </text>
  </g>
}

const mobileStages = [
  { number: "01", label: "VERSIONED INPUT", title: "Agent manifest", body: "Select the model, mounted paths, capabilities, behavior, and run limits.", accent: "border-[#6d9cff] bg-[#17243b]" },
  { number: "02", label: "SIDE-EFFECT-FREE", title: "Validate and compile", body: "Reject invalid fields and produce a deterministic runtime contract. No workspace access or provider call.", accent: "border-[#6d9cff] bg-[#17243b]" },
  { number: "03", label: "RUNTIME CONTRACT", title: "Inspect the configuration", body: "See the compiled prompt, mounts, registered tool schemas, and limits.", accent: "border-[#6d9cff] bg-[#17243b]" },
  { number: "04", label: "EXPLICIT LOCAL RUN", title: "Run one agent", body: "Resolve credentials, use the selected provider and registered tools, and enforce limits.", accent: "border-[#53d9b0] bg-[#102b31]" },
  { number: "05", label: "REVIEWABLE OUTPUT", title: "Result and trace", body: "Read the final assistant text and a JSONL record of model and tool activity.", accent: "border-[#c8a4ff] bg-[#272039]" },
]

export function HarnessProArchitecture() {
  return <div className="overflow-hidden rounded-2xl border border-[#33435d] bg-[#0b1425] text-white shadow-[0_25px_60px_rgba(13,27,50,.2)]">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#33435d] px-6 py-5 sm:px-8">
      <div><p className="font-mono text-xs font-bold tracking-[0.15em] text-[#a5c6ff]">HARNESS PRO / SYSTEM MAP</p><h3 className="mt-2 font-heading text-xl font-bold">From manifest to a traceable run</h3></div>
      <span className="rounded-full border border-[#5279bc] bg-[#17243b] px-3 py-1 font-mono text-xs font-bold text-[#dce5f5]">ONE AGENT / ONE RUN</span>
    </div>
    <ol className="space-y-3 px-5 py-6 lg:hidden">
      {mobileStages.map((stage, index) => <li key={stage.number}>
        <div className={"rounded-lg border p-5 " + stage.accent}><p className="font-mono text-xs font-bold tracking-[0.12em] text-[#a5c6ff]">{stage.number} / {stage.label}</p><h4 className="mt-2 font-heading text-lg font-bold">{stage.title}</h4><p className="mt-2 text-sm leading-6 text-[#dce5f5]">{stage.body}</p></div>
        {index < mobileStages.length - 1 && <p aria-hidden="true" className="pt-3 text-center text-2xl text-[#8bb5ff]">↓</p>}
      </li>)}
    </ol>
    <div className="hidden overflow-x-auto lg:block">
      <svg className="block h-auto min-w-[1080px] w-full" viewBox="0 0 1200 620" role="img" aria-labelledby="harness-architecture-title harness-architecture-description">
        <title id="harness-architecture-title">Harness Pro manifest, compile, run, and trace flow</title>
        <desc id="harness-architecture-description">A versioned JSON manifest selects a model, mounts, tools, behavior, and limits. The compiler validates it without side effects and emits a runtime contract. An explicit local run resolves credentials, uses the selected provider and registered tools, and produces final text and a JSONL trace.</desc>
        <defs><marker id="harness-flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#8bb5ff" /></marker></defs>
        <g fill="#a5c6ff" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="11" fontWeight="700" letterSpacing="1.1">
          <text x="45" y="105">01 / DECLARE</text>
          <text x="285" y="105">02 / COMPILE</text>
          <text x="525" y="105">03 / INSPECT</text>
          <text x="765" y="105">04 / RUN</text>
          <text x="1005" y="105">05 / REVIEW</text>
        </g>
        <g fill="none" stroke="#8bb5ff" strokeWidth="2" strokeLinecap="round" markerEnd="url(#harness-flow-arrow)">
          <path d="M 245 285 H 285" />
          <path d="M 485 285 H 525" />
          <path d="M 725 285 H 765" />
          <path d="M 965 285 H 1005" />
        </g>
        <g>
          <rect x="45" y="155" width="200" height="260" rx="12" fill="#17243b" stroke="#6d9cff" strokeWidth="1.5" />
          <rect x="63" y="173" width="28" height="3" rx="1.5" fill="#6d9cff" />
          <text x="63" y="199" fill="#a5c6ff" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="11" fontWeight="700" letterSpacing="1.3">VERSIONED JSON</text>
          <text x="63" y="228" fill="#ffffff" fontFamily="Montserrat, Arial, sans-serif" fontSize="17" fontWeight="700">Agent manifest</text>
          <g fill="#e6efff" fontFamily="Lato, Arial, sans-serif" fontSize="13" fontWeight="700">
            <rect x="63" y="253" width="164" height="39" rx="6" fill="#20395e" /><text x="76" y="278">Provider + model</text>
            <rect x="63" y="301" width="164" height="39" rx="6" fill="#20395e" /><text x="76" y="326">Mounts + tools</text>
            <rect x="63" y="349" width="164" height="39" rx="6" fill="#20395e" /><text x="76" y="374">Behavior + limits</text>
          </g>
        </g>
        <Node x={285} y={180} width={200} height={210} label="PURE COMPILER" title="Validate & compile" lines={["Reject invalid fields", "Check paths and limits", "Generate configuration"]} />
        <Node x={525} y={180} width={200} height={210} label="COMPILED OUTPUT" title="Runtime contract" lines={["Prompt and mounts", "Registered tool schemas", "Provider configuration"]} />
        <Node x={765} y={155} width={200} height={260} label="EXPLICIT LOCAL RUN" title="Agent runtime" lines={["Resolve credentials", "Talk to selected model", "Dispatch registered tools", "Enforce run limits"]} accent="green" />
        <g>
          <rect x="1005" y="180" width="165" height="210" rx="12" fill="#272039" stroke="#c8a4ff" strokeWidth="1.5" />
          <rect x="1023" y="198" width="28" height="3" rx="1.5" fill="#c8a4ff" />
          <text x="1023" y="224" fill="#dec8ff" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="11" fontWeight="700" letterSpacing="1.3">RUN OUTPUTS</text>
          <text x="1023" y="253" fill="#ffffff" fontFamily="Montserrat, Arial, sans-serif" fontSize="17" fontWeight="700">Result + trace</text>
          <rect x="1023" y="275" width="129" height="40" rx="6" fill="#382d50" /><text x="1035" y="300" fill="#ffffff" fontFamily="Lato, Arial, sans-serif" fontSize="13" fontWeight="700">Final text</text>
          <rect x="1023" y="327" width="129" height="40" rx="6" fill="#382d50" /><text x="1035" y="352" fill="#ffffff" fontFamily="Lato, Arial, sans-serif" fontSize="13" fontWeight="700">JSONL trace</text>
        </g>
        <g>
          <rect x="285" y="475" width="440" height="92" rx="10" fill="#17243b" stroke="#5279bc" strokeWidth="1.5" />
          <text x="305" y="504" fill="#a5c6ff" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="11" fontWeight="700" letterSpacing="1.2">COMPILE / NO SIDE EFFECTS</text>
          <text x="305" y="530" fill="#ffffff" fontFamily="Lato, Arial, sans-serif" fontSize="14" fontWeight="700">No mount reads, credential lookup,</text>
          <text x="305" y="550" fill="#ffffff" fontFamily="Lato, Arial, sans-serif" fontSize="14" fontWeight="700">provider calls, or MCP connections.</text>
          <rect x="765" y="475" width="405" height="92" rx="10" fill="#102b31" stroke="#53d9b0" strokeWidth="1.5" />
          <text x="785" y="504" fill="#8bf0cc" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="11" fontWeight="700" letterSpacing="1.2">RUN / EFFECTS HAPPEN HERE</text>
          <text x="785" y="530" fill="#ffffff" fontFamily="Lato, Arial, sans-serif" fontSize="14" fontWeight="700">Access mounts, call the provider, use</text>
          <text x="785" y="550" fill="#ffffff" fontFamily="Lato, Arial, sans-serif" fontSize="14" fontWeight="700">registered tools, and write the trace.</text>
        </g>
      </svg>
    </div>
  </div>
}
