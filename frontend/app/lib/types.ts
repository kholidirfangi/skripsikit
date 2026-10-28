export type SectionPoint = {
  index: number;
  text: string;
  type: "BAB" | "BACK_MATTER";
  confidence: "tinggi" | "sedang" | "RENDAH" | "manual";
};

export type DocumentParagraph = {
  index: number;
  text: string;
  style: string;
};

export type DetectResponse = {
  file_id: string;
  section_points: SectionPoint[];
  available_paragraphs?: DocumentParagraph[];
};

export type SummaryItem = {
  label: string;
  format: string;
};

export type Step = "upload" | "review" | "done";

export type TransferFile = {
  name: string;
  bytes: Uint8Array;
  pages: number;
};
