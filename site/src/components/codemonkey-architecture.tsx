type DiagramNodeProps = {
  x: number
  y: number
  width: number
  height: number
  label: string
  title: string
  lines: string[]
  accent?: "blue" | "green" | "violet"
}

function DiagramNode({ x, y, width, height, label, title, lines, accent = "blue" }: DiagramNodeProps) {
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
    <text x={x + 18} y={y + 99} fill="#dce5f5" fontFamily="Lato, Arial, sans-serif" fontSize="13">
      {lines.map((line, index) => <tspan key={line} x={x + 18} dy={index === 0 ? 0 : 19}>{line}</tspan>)}
    </text>
  </g>
}

export function CodeMonkeyArchitecture() {
  return <div className="overflow-hidden rounded-2xl border border-[#33435d] bg-[#0b1425] text-white shadow-[0_25px_60px_rgba(13,27,50,.2)]">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#33435d] px-6 py-5 sm:px-8">
      <div><p className="font-mono text-xs font-bold tracking-[0.15em] text-[#a5c6ff]">CODEMONKEY / SYSTEM MAP</p><h3 className="mt-2 font-heading text-xl font-bold">From request to a reviewable result</h3></div>
      <span className="rounded-full border border-[#5279bc] bg-[#17243b] px-3 py-1 font-mono text-xs font-bold text-[#dce5f5]">CONCEPTUAL FLOW</span>
    </div>
    <div className="space-y-4 px-5 py-6 lg:hidden">
      <div className="rounded-lg border border-[#6d9cff] bg-[#17243b] p-5"><p className="font-mono text-xs font-bold tracking-[0.12em] text-[#a5c6ff]">01 / INTAKE</p><h4 className="mt-2 font-heading text-lg font-bold">Work comes in</h4><p className="mt-2 text-sm leading-6 text-[#dce5f5]">Manual tasks and repository review events enter one queue.</p></div>
      <p aria-hidden="true" className="text-center text-2xl text-[#8bb5ff]">↓</p>
      <div className="rounded-lg border border-[#6d9cff] bg-[#17243b] p-5"><p className="font-mono text-xs font-bold tracking-[0.12em] text-[#a5c6ff]">02 / TRUST BOUNDARY</p><h4 className="mt-2 font-heading text-lg font-bold">Validate the request</h4><p className="mt-2 text-sm leading-6 text-[#dce5f5]">Authenticate its source and check permissions.</p></div>
      <p aria-hidden="true" className="text-center text-2xl text-[#8bb5ff]">↓</p>
      <div className="rounded-lg border border-[#6d9cff] bg-[#17243b] p-5"><p className="font-mono text-xs font-bold tracking-[0.12em] text-[#a5c6ff]">03 / CONTROL PLANE</p><h4 className="mt-2 font-heading text-lg font-bold">CodeMonkey routes the work</h4><p className="mt-2 text-sm leading-6 text-[#dce5f5]">Track the task, choose the action, and dispatch an isolated worker.</p></div>
      <p aria-hidden="true" className="text-center text-2xl text-[#8bb5ff]">↓</p>
      <div className="grid gap-3">
        <p className="font-mono text-xs font-bold tracking-[0.12em] text-[#a5c6ff]">04 / EXECUTION → 05 / OUTPUT</p>
        {[["Agent worker", "Run artifacts", "blue"], ["Pipeline driver", "Review gate", "green"], ["Chat worker", "Dashboard", "violet"]].map(([path, output, color]) => <div key={path} className={"flex items-center justify-between gap-3 rounded-lg border p-4 text-sm font-bold " + (color === "green" ? "border-[#53d9b0] bg-[#102b31]" : color === "violet" ? "border-[#c8a4ff] bg-[#272039]" : "border-[#6d9cff] bg-[#17243b]")}><span>{path}</span><span className="shrink-0 text-[#a5c6ff]">→</span><span className="text-right">{output}</span></div>)}
      </div>
      <div className="rounded-lg border border-[#5279bc] bg-[#17243b] p-5"><p className="font-mono text-xs font-bold tracking-[0.12em] text-[#a5c6ff]">PERSISTENT STATE</p><p className="mt-2 text-sm leading-6 text-white">Task records, pipeline state, and run history stay available.</p></div>
    </div>
    <div className="hidden overflow-x-auto lg:block">
      <svg className="block h-auto min-w-[1080px] w-full" viewBox="0 0 1200 650" role="img" aria-labelledby="architecture-title architecture-description">
        <title id="architecture-title">CodeMonkey orchestration architecture</title>
        <desc id="architecture-description">Manual tasks and repository events pass through a shared validation gate into the orchestrator. It dispatches task workers, an acceptance pipeline, and chat workers. Their outputs are artifacts, review decisions, and a dashboard. Task and pipeline state is persisted.</desc>
        <defs>
          <marker id="flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#8bb5ff" /></marker>
        </defs>
        <g fill="none" stroke="#8bb5ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" markerEnd="url(#flow-arrow)">
          <path d="M 235 277 H 270" />
          <path d="M 460 277 H 495" />
          <path d="M 705 235 H 725 V 167 H 745" />
          <path d="M 705 285 H 745" />
          <path d="M 705 335 H 725 V 447 H 745" />
          <path d="M 950 167 H 985" />
          <path d="M 950 307 H 985" />
          <path d="M 950 447 H 985" />
          <path d="M 600 387 V 552" />
        </g>
        <g fill="#a5c6ff" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="11" fontWeight="700" letterSpacing="1.1">
          <text x="46" y="111">01 / INTAKE</text>
          <text x="270" y="111">02 / TRUST BOUNDARY</text>
          <text x="495" y="111">03 / CONTROL PLANE</text>
          <text x="745" y="75">04 / EXECUTION PATHS</text>
          <text x="985" y="75">05 / VISIBLE OUTPUTS</text>
        </g>
        <g>
          <rect x="45" y="165" width="190" height="225" rx="12" fill="#17243b" stroke="#6d9cff" strokeWidth="1.5" />
          <rect x="63" y="184" width="28" height="3" rx="1.5" fill="#6d9cff" />
          <text x="63" y="211" fill="#a5c6ff" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="11" fontWeight="700" letterSpacing="1.3">REQUESTS</text>
          <text x="63" y="241" fill="#ffffff" fontFamily="Montserrat, Arial, sans-serif" fontSize="17" fontWeight="700">Work comes in</text>
          <rect x="63" y="262" width="154" height="46" rx="6" fill="#20395e" />
          <text x="77" y="290" fill="#e6efff" fontFamily="Lato, Arial, sans-serif" fontSize="14" fontWeight="700">Manual task</text>
          <rect x="63" y="319" width="154" height="52" rx="6" fill="#20395e" />
          <text x="77" y="341" fill="#e6efff" fontFamily="Lato, Arial, sans-serif" fontSize="14" fontWeight="700">Repository event</text>
          <text x="77" y="359" fill="#bdcce3" fontFamily="Lato, Arial, sans-serif" fontSize="12">review or comment</text>
        </g>
        <DiagramNode x={270} y={205} width={190} height={145} label="SHARED GATE" title="Validate request" lines={["Authenticate source", "and check permissions"]} />
        <DiagramNode x={495} y={185} width={210} height={202} label="ORCHESTRATOR" title="Route the work" lines={["Queue and track tasks", "Choose the next action", "Dispatch isolated workers"]} />
        <DiagramNode x={745} y={110} width={205} height={115} label="TASK PATH" title="Agent worker" lines={["Implement or respond"]} />
        <DiagramNode x={745} y={250} width={205} height={115} label="QUALITY PATH" title="Pipeline driver" lines={["Build, test, scan, review"]} accent="green" />
        <DiagramNode x={745} y={390} width={205} height={115} label="CONVERSATION" title="Chat worker" lines={["Answer in context"]} accent="violet" />
        <DiagramNode x={985} y={110} width={170} height={115} label="EVIDENCE" title="Run artifacts" lines={["Changes and logs"]} />
        <DiagramNode x={985} y={250} width={170} height={115} label="DECISION" title="Review gate" lines={["Human acceptance"]} accent="green" />
        <DiagramNode x={985} y={390} width={170} height={115} label="VISIBILITY" title="Dashboard" lines={["Status and chat"]} accent="violet" />
        <g>
          <rect x="495" y="552" width="460" height="72" rx="10" fill="#17243b" stroke="#5279bc" strokeWidth="1.5" />
          <text x="515" y="580" fill="#a5c6ff" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="11" fontWeight="700" letterSpacing="1.2">PERSISTENT STATE</text>
          <text x="515" y="604" fill="#ffffff" fontFamily="Lato, Arial, sans-serif" fontSize="15" fontWeight="700">Task records · pipeline state · run history</text>
        </g>
      </svg>
    </div>
  </div>
}
