export type SectionPoint = {
  index: number;
  text: string;
  type: 'BAB' | 'BACK_MATTER';
  confidence: 'tinggi' | 'sedang' | 'RENDAH' | 'manual';
};

export type DetectResponse = {
  file_id: string;
  safe_path: string;
  section_points: SectionPoint[];
};

export type SummaryItem = {
  label: string;
  format: string;
};

export type Step = 'upload' | 'review' | 'done';