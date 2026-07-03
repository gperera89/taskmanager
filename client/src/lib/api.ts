import "server-only";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

export type Task = {
  id: string;
  title: string;
  category: string;
  dueDate: string | null;
  isCompleted: boolean;
  createdAt: string;
  projectId: string | null;
};

export type Habit = {
  id: string;
  title: string;
  currentStreak: number;
  longestStreak: number;
  daysSinceLastDone: number;
  lastCompletedDate: string | null;
};

export type Project = {
  id: string;
  name: string;
  description: string | null;
};

export type Routine = {
  id: string;
  title: string;
  reminderTime: string;
  isActive: boolean;
};

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${path}: ${res.status}`);
  }
  return res.json();
}

export const getTasks = () => get<Task[]>("/tasks");
export const getHabits = () => get<Habit[]>("/habits");
export const getProjects = () => get<Project[]>("/projects");
export const getRoutines = () => get<Routine[]>("/routines");
