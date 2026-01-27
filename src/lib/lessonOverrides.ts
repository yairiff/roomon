import type { Lesson } from "../types/schedule";
import type { LessonOverride } from "../types/admin";

export function applyLessonOverrides(
  baseLessons: Lesson[],
  overrides: LessonOverride[],
  dayKey?: Lesson["day"]
): Lesson[] {
  let next = [...baseLessons];

  overrides
    .filter((override) => (dayKey ? (override.lesson?.day || dayKey) === dayKey : true))
    .forEach((override) => {
      if (override.action === "delete" && override.targetLessonId) {
        next = next.filter((lesson) => lesson.id !== override.targetLessonId);
        return;
      }

      if ((override.action === "update" || override.action === "add") && override.lesson) {
        const targetId = override.targetLessonId || override.lesson.id || `override-${override.id}`;
        const updatedLesson: Lesson = { ...override.lesson, id: targetId };
        if (override.action === "update") {
          const index = next.findIndex((lesson) => lesson.id === targetId);
          if (index !== -1) {
            next[index] = updatedLesson;
            return;
          }
        }
        next.push(updatedLesson);
      }
    });

  return next;
}
