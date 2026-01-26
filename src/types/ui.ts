export type ViewMode = "live" | "room" | "finder" | "reservations";

import type { ReactNode } from "react";

export type TopBarContext = {
  title: ReactNode;
  subtitle?: ReactNode;
  subtitleOptions?: { value: string; label: string }[];
  onSubtitleChange?: (value: string) => void;
  navLabel?: string;
  onPrev?: () => void;
  onNext?: () => void;
  controls?: ReactNode;
};
export type SemesterKey = "A" | "B";
