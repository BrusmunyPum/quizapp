import * as crypto from 'crypto';
import type { PrismaClient } from '@prisma/client';

export interface SeedOption {
  id: string;
  content: string;
  isCorrect: boolean;
  colorCode: string;
}

export interface SeedQuestion {
  id: string;
  prompt: string;
  questionType: string;
  timeLimitSeconds: number;
  points: number;
  mediaUrl?: string;
  options: SeedOption[];
}

export interface SeedQuiz {
  id: string;
  title: string;
  description: string;
  coverImageUrl?: string;
  questions: SeedQuestion[];
}

export const STARTER_QUIZZES: SeedQuiz[] = [
  {
    id: 'quiz-web-dev',
    title: 'Web Dev Mastery 🚀',
    description: 'Test your knowledge on Vue.js, NestJS, and Modern Web Tech!',
    coverImageUrl:
      'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=600&auto=format&fit=crop&q=80',
    questions: [
      {
        id: 'q1',
        prompt: 'What is the primary reactivity system used in Vue 3?',
        questionType: 'MULTIPLE_CHOICE',
        timeLimitSeconds: 20,
        points: 1000,
        options: [
          { id: 'opt1', content: 'ES6 Proxies', isCorrect: true, colorCode: '#ef4444' },
          { id: 'opt2', content: 'Object.defineProperty', isCorrect: false, colorCode: '#3b82f6' },
          { id: 'opt3', content: 'Virtual DOM Diffing only', isCorrect: false, colorCode: '#f59e0b' },
          { id: 'opt4', content: 'Zone.js Change Detection', isCorrect: false, colorCode: '#10b981' },
        ],
      },
      {
        id: 'q2',
        prompt:
          'In NestJS, which decorator injects the connected Socket instance in a WebSocket Gateway?',
        questionType: 'MULTIPLE_CHOICE',
        timeLimitSeconds: 20,
        points: 1000,
        options: [
          { id: 'opt5', content: '@Req()', isCorrect: false, colorCode: '#ef4444' },
          { id: 'opt6', content: '@ConnectedSocket()', isCorrect: true, colorCode: '#3b82f6' },
          { id: 'opt7', content: '@InjectClient()', isCorrect: false, colorCode: '#f59e0b' },
          { id: 'opt8', content: '@WebSocketClient()', isCorrect: false, colorCode: '#10b981' },
        ],
      },
      {
        id: 'q3',
        prompt:
          'Which CSS property is the foundation of the modern "Glassmorphism" frosted glass effect?',
        questionType: 'MULTIPLE_CHOICE',
        timeLimitSeconds: 15,
        points: 1000,
        options: [
          { id: 'opt9', content: 'filter: blur()', isCorrect: false, colorCode: '#ef4444' },
          { id: 'opt10', content: 'box-shadow: inset', isCorrect: false, colorCode: '#3b82f6' },
          { id: 'opt11', content: 'backdrop-filter: blur()', isCorrect: true, colorCode: '#f59e0b' },
          { id: 'opt12', content: 'mix-blend-mode: overlay', isCorrect: false, colorCode: '#10b981' },
        ],
      },
      {
        id: 'q4',
        prompt:
          'Which Redis data structure is best for real-time live leaderboards with O(log N) sorting?',
        questionType: 'MULTIPLE_CHOICE',
        timeLimitSeconds: 20,
        points: 1000,
        options: [
          { id: 'opt13', content: 'Redis Hashes (HSET)', isCorrect: false, colorCode: '#ef4444' },
          { id: 'opt14', content: 'Redis Lists (LPUSH)', isCorrect: false, colorCode: '#3b82f6' },
          { id: 'opt15', content: 'Redis Sorted Sets (ZADD)', isCorrect: true, colorCode: '#f59e0b' },
          { id: 'opt16', content: 'Redis Bitmaps', isCorrect: false, colorCode: '#10b981' },
        ],
      },
    ],
  },
  {
    id: 'quiz-general-tech',
    title: 'General Tech Trivia 💡',
    description: 'Fun questions about programming languages and internet history.',
    coverImageUrl:
      'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=600&auto=format&fit=crop&q=80',
    questions: [
      {
        id: 'gt1',
        prompt: 'In what year was the first version of JavaScript created?',
        questionType: 'MULTIPLE_CHOICE',
        timeLimitSeconds: 15,
        points: 1000,
        options: [
          { id: 'gt_opt1', content: '1991', isCorrect: false, colorCode: '#ef4444' },
          { id: 'gt_opt2', content: '1995', isCorrect: true, colorCode: '#3b82f6' },
          { id: 'gt_opt3', content: '1999', isCorrect: false, colorCode: '#f59e0b' },
          { id: 'gt_opt4', content: '2001', isCorrect: false, colorCode: '#10b981' },
        ],
      },
      {
        id: 'gt2',
        prompt: 'Who created the Linux operating system kernel?',
        questionType: 'MULTIPLE_CHOICE',
        timeLimitSeconds: 15,
        points: 1000,
        options: [
          { id: 'gt_opt5', content: 'Linus Torvalds', isCorrect: true, colorCode: '#ef4444' },
          { id: 'gt_opt6', content: 'Richard Stallman', isCorrect: false, colorCode: '#3b82f6' },
          { id: 'gt_opt7', content: 'Ken Thompson', isCorrect: false, colorCode: '#f59e0b' },
          { id: 'gt_opt8', content: 'Dennis Ritchie', isCorrect: false, colorCode: '#10b981' },
        ],
      },
    ],
  },
];

/**
 * Seeds starter quizzes only if the database currently has zero quizzes.
 */
export async function seedStarterQuizzesIfEmpty(
  prisma: PrismaClient,
): Promise<boolean> {
  const existingCount = await prisma.quiz.count();
  if (existingCount > 0) {
    return false;
  }

  let systemUser = await prisma.user.findUnique({
    where: { email: 'system@glassquiz.local' },
  });

  if (!systemUser) {
    const salt = crypto.randomBytes(16).toString('hex');
    const lockHash = crypto
      .scryptSync(crypto.randomBytes(32).toString('hex'), salt, 64)
      .toString('hex');

    systemUser = await prisma.user.create({
      data: {
        email: 'system@glassquiz.local',
        passwordHash: `${salt}:${lockHash}`,
        displayName: 'GlassQuiz Library',
      },
    });
  }

  for (const quiz of STARTER_QUIZZES) {
    await prisma.quiz.create({
      data: {
        creatorId: systemUser.id,
        title: quiz.title,
        description: quiz.description,
        coverImageUrl: quiz.coverImageUrl,
        isPublic: true,
        questions: {
          create: quiz.questions.map((q, qIdx) => ({
            prompt: q.prompt,
            questionType: q.questionType,
            timeLimitSeconds: q.timeLimitSeconds,
            points: q.points,
            orderIndex: qIdx,
            mediaUrl: q.mediaUrl,
            options: {
              create: q.options.map((opt, oIdx) => ({
                content: opt.content,
                isCorrect: opt.isCorrect,
                orderIndex: oIdx,
                colorCode: opt.colorCode,
              })),
            },
          })),
        },
      },
    });
  }

  return true;
}
