"use client";

import VoiceAgent from "@/components/VoiceAgent";

export default function AgentPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Voice Agent</h1>
        <p className="mt-1 text-sm text-muted">
          Speak or type commands to search jobs, apply, and email recruiters.
        </p>
      </div>

      <VoiceAgent />
    </div>
  );
}
