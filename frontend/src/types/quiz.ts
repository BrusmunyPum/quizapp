export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

export interface Option {
  id: string;
  content: string;
  colorCode?: string;
  isCorrect?: boolean;
}

export interface Question {
  id: string;
  prompt: string;
  questionType?: string;
  timeLimitSeconds: number;
  points: number;
  mediaUrl?: string;
  options: Option[];
  questionNumber?: number;
  totalQuestions?: number;
  endsAt?: number;
}

export interface Quiz {
  id: string;
  creatorId?: string;
  creatorName?: string;
  title: string;
  description: string;
  coverImageUrl?: string;
  isPublic?: boolean;
  questions: Question[];
}

export interface Player {
  nickname: string;
  score: number;
  connected?: boolean;
}

export interface LeaderboardEntry {
  rank: number;
  nickname: string;
  score: number;
  streak?: number;
  lastPointsEarned?: number;
}

export interface PodiumEntry {
  rank: number;
  nickname: string;
  score: number;
}

export interface AnswerResult {
  isCorrect: boolean;
  points: number;
  totalScore?: number;
  streak?: number;
  rank?: number;
  timedOut?: boolean;
}
