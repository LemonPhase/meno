"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import TopicEntry from "@/components/session/TopicEntry";

export default function NewSessionPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <TopicEntry onDone={() => router.push("/")} onError={setError} />
      {error && (
        <div className="toast err on" role="alert">
          <span>{error}</span>
          <button className="act sc" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}
