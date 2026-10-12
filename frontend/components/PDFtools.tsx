"use client";

import { useState } from "react";
import PDFsplit from "./PDFsplit";
import PDFMerge from "./PDFmerge";
import type { TransferFile } from "../app/lib/types";

export default function PDFTools() {
  const [tab, setTab] = useState<"split" | "merge">("split");
  const [incoming, setIncoming] = useState<TransferFile[] | null>(null);

  const tabClass = (active: boolean) =>
    `px-4 py-1.5 text-sm rounded-md transition-colors ${
      active ? "bg-gray-950 text-white" : "text-gray-600 hover:bg-slate-100"
    }`;

  return (
    <div>
      <div className="flex justify-center gap-2 my-6">
        <button className={tabClass(tab === "split")} onClick={() => setTab("split")}>
          Split
        </button>
        <button className={tabClass(tab === "merge")} onClick={() => setTab("merge")}>
          Merge
        </button>
      </div>

      <div className={tab === "split" ? "" : "hidden"}>
        <PDFsplit
          onSendToMerge={(files) => {
            setIncoming(files);
            setTab("merge");
          }}
        />
      </div>
      <div className={tab === "merge" ? "" : "hidden"}>
        <PDFMerge incoming={incoming} onConsumed={() => setIncoming(null)} />
      </div>
    </div>
  );
}