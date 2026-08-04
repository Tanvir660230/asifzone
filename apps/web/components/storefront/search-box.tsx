"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export function SearchBox({ initialValue = "" }: { initialValue?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    router.push(value.trim() ? `/search?q=${encodeURIComponent(value.trim())}` : "/search");
  }

  return (
    <form onSubmit={handleSubmit} className="relative mx-auto max-w-xl">
      <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search products…"
        className="h-12 pl-10"
        autoFocus
      />
    </form>
  );
}
