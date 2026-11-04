export type Emotion = "neutral" | "excited" | "calm" | "serious" | "encouraging" | "friendly" | "curious";
export type Gesture = "none" | "point" | "open" | "nod" | "think" | "emphasis";

export type BoardAction =
  | { type: "heading" | "text"; text: string; color?: string }
  | { type: "formula"; text: string; hl?: string }
  | { type: "definition"; text: string; parts?: string[] }
  | { type: "dots"; groups: number[]; op: string; result: number | null }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "code"; lang: string; lines: string[]; hl?: number | null }
  | { type: "flow"; nodes: string[] }
  | { type: "compare"; left: { title: string; items: string[] }; right: { title: string; items: string[] } }
  | { type: "shape"; shape: "circle" | "rect" | "arrow"; label: string }
  | { type: "output"; lines: string[] }
  | { type: "clear" | "newpage" };

export type BeatKind = "intro" | "definition" | "parts" | "connect" | "meaning" | "terms" | "example" | "technical" | "practical" | "recap" | "check" | "read";
export interface Beat { say: string; emotion: Emotion; gesture: Gesture; board: BoardAction[]; kind?: BeatKind; src?: "book" | "extra"; speech?: string }
export interface Script { beats: Beat[]; source: "document" | "general" | "mixed"; check: string; check_speech?: string; mode?: "teach" | "read"; recap?: string }

export interface Prefs {
  onboarded: boolean; teacher: "aira" | "nex"; teacher_name: string; wake_word: string;
  voice: string; voice_rate: number; voice_pitch: number; voice_energy: number; voice_accent?: string; voice_style?: string;
  avatar: "animated" | "robot" | "cartoon" | "minimal" | "realistic3d";
  avatar_look: { skin: string; hair: string; outfit: string; bg: string; hairstyle?: string; casual?: boolean };
  language: string; level: string; personality: string; memes: boolean;
  theme: { preset: string; mode: "dark" | "light" | "amoled"; radius: "round" | "sharp"; font: number; board: string; accent?: string; accent2?: string };
  low_power: boolean; listen_wake: boolean; pron_accent?: string;
  style_profile: { name: string; prompt: string; voice_rate: number } | null;
}
export interface User { id: number; email: string; name: string; verified: boolean; is_guest: boolean; streak: number; prefs: Prefs }

export interface Concept { term: string; kind: "definition" | "term" | "formula"; importance: "high" | "medium"; evidence?: string }
export interface Topic { id: string; title: string; page: number; summary: string; formulas: string[]; definitions: string[]; kind?: "topic" | "question"; marks?: number | null; concepts?: Concept[] }
export interface DocAnalysis { doc_type: "notes" | "exam_paper" | "slides"; ignored: string[]; difficult: string[]; warnings: string[] }
export interface DocDetail { id: number; title: string; pages: string[]; roadmap: Topic[]; progress: Record<string, { completed: boolean; beat: number }>; analysis?: DocAnalysis }

export interface BoardItem {
  id: number; kind: "action" | "stroke"; action?: BoardAction; y: number; h: number;
  points?: [number, number][]; color?: string; width?: number; hl?: boolean;
}
/** Free-text lesson modes, appended to the teacher prompt server-side. */
export const MODES: Record<string, { label: string; icon: string; desc: string }> = {
  classroom: { label: "Classroom", icon: "🏫", desc: "Continuous teaching like a real class" },
  doubt: { label: "Doubt", icon: "🙋", desc: "Ask questions any time" },
  revision: { label: "Revision", icon: "🔁", desc: "Quickly revise completed topics" },
  exam: { label: "Exam prep", icon: "📝", desc: "Important points & how to write answers" },
  practical: { label: "Practical", icon: "💻", desc: "Step-by-step technical practice" },
  quick: { label: "Quick learn", icon: "⚡", desc: "Short, crisp explanation" },
  interview: { label: "Interview", icon: "🎤", desc: "Mock interview, one question at a time" },
  board: { label: "Board teaching", icon: "🧑‍🏫", desc: "Diagrams and step-by-step on the board" },
};
export interface BoardPage { items: BoardItem[]; cursor: number }

