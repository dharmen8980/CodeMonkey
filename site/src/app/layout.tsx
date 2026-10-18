import type { Metadata } from "next"
import type { ReactNode } from "react"
import "./globals.css"

export const metadata: Metadata = {
  title: "CodeMonkey + Harness Pro — Agent work, made deliberate",
  description: "Meet CodeMonkey and Harness Pro: a task orchestrator and a manifest-driven agent runtime built for deliberate, reviewable automation.",
  openGraph: {
    title: "CodeMonkey + Harness Pro",
    description: "Orchestrate work. Define the agent. Review the result.",
    type: "website",
  },
  icons: { icon: "/favicon.svg" },
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="en"><body className="font-sans antialiased">{children}</body></html>
}
